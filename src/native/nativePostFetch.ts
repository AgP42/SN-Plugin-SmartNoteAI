// The LIVE-read twin of the batch pipeline (v0.67): a FetchFn whose body
// carries a __FILE_B64__ placeholder that Kotlin fills with the base64
// of a local file before POSTing — the 0.5-1 MB render PNG never crosses
// the JS thread. Injected into the SAME core layers (mistralRequest /
// ocrImageSmart / sendChat) as the normal fetchAdapter, so retries,
// error wording and response parsing are strictly identical.
//
// Caveats, on purpose:
// - AbortSignal is not forwarded (no native abort primitive) — callers
//   already re-check `aborted` between steps, a cancelled read just lets
//   the in-flight POST finish and drops the result.
// - The file is NOT deleted by the adapter (a mistralRequest retry must
//   re-read it) — the read loop deletes it after the page is done.
import {NativeModules} from 'react-native';
import type {FetchFn} from '../core/model/types';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    postJsonWithFile?: (
      url: string,
      bearer: string,
      template: string,
      dataFilePath: string,
      deleteAfter: boolean,
      timeoutMs: number,
    ) => Promise<{
      success?: boolean;
      status?: number;
      body?: string;
      message?: string;
    }>;
  };
};

export const nativePostAvailable = (): boolean =>
  typeof SmartNoteAiOverlay?.postJsonWithFile === 'function';

export const nativeFileFetch =
  (filePath: string): FetchFn =>
  async (url, init) => {
    const post = SmartNoteAiOverlay?.postJsonWithFile;
    if (post === undefined) {
      throw new Error('native post unavailable');
    }
    const bearer = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
        '',
    ).replace(/^Bearer\s+/i, '');
    const template = typeof init?.body === 'string' ? init.body : '';
    const r = await post(url, bearer, template, filePath, false, 120_000);
    if (r?.success !== true || typeof r.status !== 'number') {
      // mistralRequest wraps thrown messages as "Network error: …" and
      // marks them retryable — exactly the transport-failure contract.
      throw new Error(r?.message ?? 'native post failed');
    }
    const text = typeof r.body === 'string' ? r.body : '';
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  };
