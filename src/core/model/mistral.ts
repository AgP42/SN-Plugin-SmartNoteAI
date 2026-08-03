// Mistral chat client. Mistral's API is OpenAI-compatible
// (POST /v1/chat/completions, Bearer auth), so the wire shape is the
// familiar `messages: [{role, content}]` with `content` being either
// a string or an array of parts for vision.
//
// Pure module: `fetch` is injected (see FetchFn) so this is unit-
// tested with a fake, no network and no RN bridge. The only side
// effect is the HTTP call the injected fetch makes.

import type {
  ChatRequest,
  ChatResult,
  ChatTurn,
  FetchFn,
  ModelConfig,
} from './types';
import {mistralRequest} from './http';

// A content part in the OpenAI/Mistral vision format.
type ContentPart =
  | {type: 'text'; text: string}
  | {type: 'image_url'; image_url: {url: string}};

// Build one wire message from a ChatTurn. When the turn carries an
// image we send an array of parts (text + image); otherwise a plain
// string keeps the body minimal for text-only turns. Exported so the
// Conversations path (tools: web/code) attaches images too — else a
// lasso image was dropped whenever web/code was armed (device 2026-07-21).
export const wireContent = (turn: ChatTurn): string | ContentPart[] => {
  const imgs = (turn.images ?? []).filter(i => i.length > 0);
  if (imgs.length === 0) {
    return turn.text;
  }
  const parts: ContentPart[] = [];
  if (turn.text.length > 0) {
    parts.push({type: 'text', text: turn.text});
  }
  for (const img of imgs) {
    parts.push({
      type: 'image_url',
      image_url: {url: `data:image/png;base64,${img}`},
    });
  }
  return parts;
};

// Assemble the full request body. Exported for tests so we can assert
// the wire shape without going through fetch.
// (v0.35: the old 8-image conversation budget — capImagesToBudget — is
// gone: the chat is text-only since v0.34, and the only image senders
// left are single-turn, single-image reader/escalation requests.)
export const buildBody = (
  req: ChatRequest,
  model: string,
): Record<string, unknown> => {
  const messages: Array<{role: string; content: string | ContentPart[]}> = [];
  if (req.system.trim().length > 0) {
    messages.push({role: 'system', content: req.system});
  }
  for (const turn of req.turns) {
    messages.push({role: turn.role, content: wireContent(turn)});
  }
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: req.maxTokens,
  };
  // Answer style (v0.49): only sent when the user picked a non-default
  // style — absent, each model's own default temperature applies.
  if (req.temperature !== undefined) {
    body.temperature = req.temperature;
  }
  // Enable Mistral prompt caching for this conversation: the shared
  // prefix (system + earlier turns incl. the page image) is billed at
  // 10% on repeat calls that pass the same key.
  if (req.cacheKey && req.cacheKey.length > 0) {
    body.prompt_cache_key = req.cacheKey;
  }
  return body;
};

const extractText = (data: unknown): string => {
  const choices = (data as {choices?: Array<{message?: {content?: unknown}}>})
    .choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
};

// The one call the rest of the app uses. Never throws for HTTP/network
// failures — returns {ok:false} with a reason so the UI can render it.
// Transport (headers, error hints, one network retry) lives in http.ts.
export const sendChat = async (
  fetchFn: FetchFn,
  config: ModelConfig,
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResult> => {
  const start = Date.now();
  const r = await mistralRequest(fetchFn, config.apiKey, '/v1/chat/completions', {
    body: buildBody(req, config.model),
    signal,
  });
  if (!r.ok) {
    return r;
  }
  const data = r.data as {
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: {cached_tokens?: number};
    };
  };
  return {
    ok: true,
    text: extractText(data),
    usage: {
      inputTokens: Number(data.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
      cachedTokens: Number(
        data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      ),
    },
    modelId: typeof data.model === 'string' ? data.model : config.model,
    latencyMs: Date.now() - start,
  };
};
