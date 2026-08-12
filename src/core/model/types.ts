// Model layer types — provider-agnostic in shape, Mistral-first in
// practice. Pure data: no React Native, no SDK imports. The rest of
// the CORE and the UI depend on these, never on a concrete client.

// One turn of a conversation as the model sees it. `imageBase64` is a
// raw PNG (no data: prefix) — the client wraps it per the provider's
// wire format. Text-only turns omit it.
export type ChatTurn = {
  role: 'user' | 'assistant';
  text: string;
  // Raw PNGs (no data: prefix). One for a single page, several for a
  // page range / whole note. The client wraps each per the wire format.
  images?: string[];
  // The transcript block in `text` came from an Off file read under the
  // "read once, don't save" promise: it lives in memory for this
  // conversation but must be REDACTED when the conversation is persisted
  // (the auto-saved history was the one path that wrote it to disk —
  // audit 2026-07-18).
  ephemeral?: boolean;
  // A local "⚠ …" failure bubble (network error, Stopped) — shown in the
  // conversation and persisted, but NEVER sent to the model as a real
  // assistant turn (audit 2026-07-19 A4: the model was answering to its
  // own supposed error messages).
  error?: boolean;
  // v0.81: this stored (text-only) user turn was sent with lasso image(s)
  // attached — a light 🖼 marker in the bubble. The images live in the
  // conversation's ctxImages, not in the turn.
  hadImage?: boolean;
};

// What a send needs. `system` is the persona / steering; `history` is
// prior turns (oldest first) replayed for multi-turn context; the new
// user message is the last item OF history by convention, so callers
// build the full turn list and pass it whole.
// The user-facing "Answer style" (v0.49): maps to the sampling
// temperature without ever saying the word. 'balanced' sends NO value —
// each model's own default applies (0.3 for Small/Large, 1.0 for Medium,
// live API data 2026-07-18).
export type AnswerStyle = 'precise' | 'balanced' | 'creative';

export const styleTemperature = (s: AnswerStyle): number | undefined =>
  s === 'precise' ? 0.2 : s === 'creative' ? 0.9 : undefined;

export type ChatRequest = {
  system: string;
  turns: ChatTurn[];
  maxTokens: number;
  // Sampling temperature; absent = the model's own default.
  temperature?: number;
  // Stable per-conversation id → Mistral prompt caching. Requests that
  // share it and a common prefix bill the cached prefix at 10%.
  cacheKey?: string;
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  // Of inputTokens, how many were served from cache (billed at 10%).
  cachedTokens: number;
};

export type ChatResult =
  | {
      ok: true;
      text: string;
      usage: ChatUsage;
      modelId: string;
      latencyMs: number;
      // The model stopped because it hit the token ceiling, not because it
      // had finished: the text is CUT (device report 2026-08-12 — a dense
      // page came back half-transcribed and nothing noticed, so it was
      // stored as complete and never re-read).
      truncated?: boolean;
    }
  | {ok: false; reason: string; status?: number};

// Credentials + model selection, parsed from the key file.
export type ModelConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
};

// Injected so the client is testable with a fake and carries no
// global `fetch` assumption (RN provides one at runtime).
export type FetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string; // absent on GET
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

// One default for the chat maxTokens, shared by the config app and the
// floating panel (two private copies drifted apart risk — audit 2026-07-20).
export const DEFAULT_CHAT_MAX_TOKENS = 2048;
