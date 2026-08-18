// The ONE Mistral transport (refactor v0.36 §1.4). Every JSON call to
// api.mistral.ai goes through mistralRequest: shared auth headers, the
// abort→"timed out" mapping, the 401/403 ("check your key") and 404/422
// ("check the model id") hints, the error-body snippet, the malformed-JSON
// guard — and ONE retry with a short backoff on network errors and 5xx
// (decision 2026-07-17: removes the "1 page failed" noise on flaky wifi).
//
// Pure module like the clients: fetch is injected, tested with a fake.

import type {FetchFn} from './types';
import {rateAcquire, rateReport, ratePaceMs} from './rateGovernor';
import {sleepVia} from './sleepImpl';

// EU-ONLY MIGRATION (user decision 2026-08-18, after Mistral's regional
// inference launch): every call runs on the EU regional endpoint — data
// residency in Europe, 1.1x list pricing (the static price tables carry
// the multiplier). The ONE exception is the Web one-shot: Mistral blocks
// built-in connectors on regional inference (error 1915, measured
// 2026-08-18 — a web search leaves the region by nature), so the
// conversations call keeps the global endpoint and its button says so.
export const MISTRAL_API = 'https://api.eu.mistral.ai';
export const MISTRAL_API_GLOBAL = 'https://api.mistral.ai';

// One retry only — enough for a wifi hiccup, never a spend multiplier
// (a request that got THROUGH and failed 4xx is not retried).
export const RETRY_DELAY_MS = 700;

// Hard ceiling per request. A dead/stalled network must NEVER hang the caller
// forever (the "frozen plugin on low wifi" bug): every request is bounded by
// an internal AbortController, combined with the caller's own signal. 60 s is
// well above a slow vision/OCR response (~8-30 s) yet bounded.
export const REQUEST_TIMEOUT_MS = 60_000;

export type HttpResult =
  | {ok: true; data: unknown}
  | {ok: false; reason: string; status?: number};

// Turn a failed response into an actionable message. Mistral returns a
// JSON error body; a 401 means the key, a 404/422 usually the model id
// — the two config mistakes worth naming instead of a bare status.
const errorReason = (status: number, body: string): string => {
  if (status === 401 || status === 403) {
    return `HTTP ${status}: API key rejected. Check your Mistral key.`;
  }
  if (status === 404 || status === 422) {
    return `HTTP ${status}: model not found. Check the model id.`;
  }
  if (status === 429) {
    return 'HTTP 429: rate limit reached: the plugin is slowing down and will retry.';
  }
  const snippet = body.slice(0, 160);
  return `HTTP ${status}${snippet.length > 0 ? `: ${snippet}` : ''}`;
};

// Every transport wait rides sleepVia (audit 2026-07-30 C2): the default is
// a plain timer, but index.js installs a heartbeat-backed hybrid so these
// waits survive RN's frozen-timer state (the normal floating situation).
export const sleep = (ms: number): Promise<void> => sleepVia(ms);

type Attempt = HttpResult & {retryable?: boolean};

export const mistralRequest = async (
  fetchFn: FetchFn,
  apiKey: string,
  path: string,
  opts: {
    method?: 'POST' | 'GET';
    body?: Record<string, unknown>;
    signal?: AbortSignal;
    // Endpoint override — ONLY the Web one-shot passes the global host
    // (see MISTRAL_API_GLOBAL above); everything else runs EU.
    base?: string;
    // Wording of a user-initiated abort / our own timeout (the OCR path
    // says "OCR cancelled.", the chat says "Request timed out.").
    abortReason?: string;
  },
): Promise<HttpResult> => {
  const attempt = async (): Promise<Attempt> => {
    // Adaptive pacing: a no-op until a 429 turns it on, then it spaces every
    // Mistral call (OCR / vision / chat / batch-create all land here).
    await rateAcquire();
    // Bound this request: whichever fires first — the caller's Stop/abort or
    // our REQUEST_TIMEOUT_MS — aborts the fetch, so a stalled network can
    // never hang forever.
    const ctl = new AbortController();
    const onOuterAbort = () => ctl.abort();
    const outer = opts.signal;
    if (outer !== undefined) {
      if (outer.aborted) {
        ctl.abort();
      } else {
        outer.addEventListener?.('abort', onOuterAbort);
      }
    }
    let timedOut = false;
    // Watchdog through sleepVia, NOT a bare setTimeout: a frozen timer made
    // the 60 s bound a fiction in exactly the state it was built for (a
    // stalled fetch while the plugin floats hung the send forever).
    let watchdogDone = false;
    sleepVia(REQUEST_TIMEOUT_MS).then(() => {
      if (!watchdogDone) {
        timedOut = true;
        ctl.abort();
      }
    });
    let res;
    try {
      res = await fetchFn(`${opts.base ?? MISTRAL_API}${path}`, {
        method: opts.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        ...(opts.body !== undefined ? {body: JSON.stringify(opts.body)} : {}),
        signal: ctl.signal,
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/abort/i.test(msg)) {
        // The caller's Stop/signal fired → final cancel, never retried.
        if (outer?.aborted === true) {
          return {ok: false, reason: opts.abortReason ?? 'Request cancelled.'};
        }
        // OUR timeout fired → a transient stall, retry-eligible.
        if (timedOut) {
          return {
            ok: false,
            reason: 'Request timed out. Check your connection.',
            retryable: true,
          };
        }
        // A named abort with no signal = the caller's own cancellation.
        if (opts.abortReason !== undefined) {
          return {ok: false, reason: opts.abortReason};
        }
        // Spontaneous abort (OS/network) → treat as a transient timeout.
        return {
          ok: false,
          reason: 'Request timed out. Check your connection.',
          retryable: true,
        };
      }
      return {ok: false, reason: `Network error: ${msg}`, retryable: true};
    } finally {
      watchdogDone = true; // disarm — the sleep resolves as a no-op
      outer?.removeEventListener?.('abort', onOuterAbort);
    }
    if (!res.ok) {
      const wasPacing = ratePaceMs() > 0;
      rateReport(res.status); // 429 → back off, spreading the rest of the burst
      if (res.status === 429 && !wasPacing) {
        console.warn(
          '[SmartNoteAI.rate]',
          `429 rate limit — throttling Mistral calls to ~${Math.round(
            60000 / Math.max(ratePaceMs(), 1),
          )}/min`,
        );
      }
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        reason: errorReason(res.status, body),
        status: res.status,
        // 429 is retryable now: the retry re-acquires a paced slot, so it
        // fires AFTER the back-off instead of failing the whole page.
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    rateReport(res.status); // clean call → let the pace decay back down
    const data = await res.json().catch(() => null);
    return data === null
      ? {ok: false, reason: 'Malformed response from Mistral.'}
      : {ok: true, data};
  };

  // Function call so TS doesn't narrow `aborted` across the await below
  // (the flag CAN flip while we sleep).
  const aborted = () => opts.signal?.aborted === true;
  const strip = (a: Attempt): HttpResult => {
    delete a.retryable;
    return a;
  };
  const first = await attempt();
  if (first.ok || first.retryable !== true || aborted()) {
    return strip(first);
  }
  await sleep(RETRY_DELAY_MS);
  if (aborted()) {
    return strip(first);
  }
  return strip(await attempt());
};
