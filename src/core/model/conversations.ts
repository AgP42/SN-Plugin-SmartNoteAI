// Mistral Conversations client (v0.21) — the endpoint that unlocks the
// built-in connectors (web_search, code_interpreter). Measured
// 2026-07-11: works INLINE (model + tools per request, no pre-created
// agent), `store:false` keeps Mistral stateless, and our client-managed
// history rides in `inputs` exactly like `messages` — so the cooling
// mechanic transfers unchanged.
//
// The chat panel uses this client only when at least one tool toggle is
// ON; otherwise the plain chat-completions client (mistral.ts) stays —
// it is cheaper (prompt caching) and battle-tested.

import type {ChatRequest, ChatUsage, FetchFn} from './types';
import {mistralRequest, MISTRAL_API_GLOBAL} from './http';
import {wireContent} from './mistral';

export type ConnectorTool = 'web_search' | 'code_interpreter';

export type SourceRef = {title: string; url: string};

// ChatResult plus the connector extras (citations, tool runs).
export type ConvResult =
  | {
      ok: true;
      text: string;
      usage: ChatUsage;
      modelId: string;
      latencyMs: number;
      sources: SourceRef[];
      toolsUsed: string[];
    }
  | {ok: false; reason: string; status?: number};

export const buildConversationBody = (
  req: ChatRequest,
  model: string,
  tools: ConnectorTool[],
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model,
    // wireContent, not t.text: a turn's image (lasso→chat) must ride in
    // `inputs` too, else it was dropped whenever web/code was armed.
    inputs: req.turns.map(t => ({role: t.role, content: wireContent(t)})),
    store: false,
    completion_args:
      req.temperature !== undefined
        ? {max_tokens: req.maxTokens, temperature: req.temperature}
        : {max_tokens: req.maxTokens},
  };
  if (req.system.trim().length > 0) {
    body.instructions = req.system;
  }
  if (tools.length > 0) {
    body.tools = tools.map(t => ({type: t}));
  }
  return body;
};

// Outputs come as entries; the answer is the message.output entry whose
// content interleaves text parts and tool_reference parts (citations).
export const parseConversationOutputs = (
  data: unknown,
): {text: string; sources: SourceRef[]; toolsUsed: string[]} => {
  const outputs = (data as {outputs?: unknown[]})?.outputs;
  let text = '';
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  const toolsUsed: string[] = [];
  if (!Array.isArray(outputs)) {
    return {text, sources, toolsUsed};
  }
  for (const raw of outputs) {
    const o = raw as {type?: string; name?: string; content?: unknown};
    if (o?.type === 'tool.execution' && typeof o.name === 'string') {
      toolsUsed.push(o.name);
      continue;
    }
    if (o?.type !== 'message.output') {
      continue;
    }
    if (typeof o.content === 'string') {
      text += o.content;
      continue;
    }
    if (Array.isArray(o.content)) {
      for (const part of o.content as Array<{
        type?: string;
        text?: string;
        title?: string;
        url?: string;
      }>) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          text += part.text;
        } else if (
          part?.type === 'tool_reference' &&
          typeof part.url === 'string' &&
          !seen.has(part.url)
        ) {
          seen.add(part.url);
          sources.push({title: part.title ?? part.url, url: part.url});
        }
      }
    }
  }
  return {text: text.trim(), sources, toolsUsed};
};

export const sendConversation = async (
  fetchFn: FetchFn,
  apiKey: string,
  model: string,
  tools: ConnectorTool[],
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ConvResult> => {
  const start = Date.now();
  const r = await mistralRequest(fetchFn, apiKey, '/v1/conversations', {
    // Web one-shot = the ONE global-endpoint call (see http.ts): the
    // conversations API does not exist regionally (404) and connectors
    // are refused there (error 1915) — the Web button says "non-EU".
    base: MISTRAL_API_GLOBAL,
    body: buildConversationBody(req, model, tools),
    signal,
  });
  if (!r.ok) {
    return r;
  }
  const data = r.data as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      connector_tokens?: number;
    };
  };
  const {text, sources, toolsUsed} = parseConversationOutputs(data);
  return {
    ok: true,
    text,
    usage: {
      // connector_tokens (search results injected into the context) are
      // billed as input — surface them in the same counter.
      inputTokens:
        Number(data.usage?.prompt_tokens ?? 0) +
        Number(data.usage?.connector_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
      cachedTokens: 0, // prompt caching is a chat-completions feature
    },
    modelId: model,
    latencyMs: Date.now() - start,
    sources,
    toolsUsed,
  };
};
