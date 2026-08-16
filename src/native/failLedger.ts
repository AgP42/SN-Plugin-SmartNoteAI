// Session-scoped FAILURE LEDGER (lot 4a, 2026-08-16). pageFails, visionFails
// and pdfFails were three same-shaped maps at three granularities, each with
// its own cap constant, increment sites and clear rules — and every new paid
// path had to remember to plug into the right one. The resume path forgot
// (fix-audit D14: bleed-gate rejections re-billed on every chat send, capped
// nowhere) — the exact defect class ONE ledger makes structurally impossible:
// a path that pays declares which kind of attempt it is, and the cap follows.
//
// Kinds (all capped per SESSION — module state dies with the JS runtime, so
// a restart re-arms every counter by design, same as the maps it replaces):
//   'read'    a page's PAID read attempt failed (blank render that billed,
//             non-network API error) — skip the page after the cap
//   'vision'  the page's VISION leg failed or came back empty — the drain
//             stops re-billing it after the cap (render failures are FREE
//             and never counted)
//   'doc'     a whole-document attempt failed (PDF /v1/ocr) — park the doc
//             after the cap; an explicit Sync clears it (a tap is proof the
//             user wants to spend again)
export type FailKind = 'read' | 'vision' | 'doc';

const CAPS: Record<FailKind, number> = {read: 3, vision: 3, doc: 3};

const fails = new Map<string, number>();

const keyOf = (kind: FailKind, path: string, page?: number): string =>
  page === undefined ? `${kind}:${path}` : `${kind}:${path}#${page}`;

// Record one failed attempt; returns the new count (for logs).
export const noteFailure = (
  kind: FailKind,
  path: string,
  page?: number,
): number => {
  const k = keyOf(kind, path, page);
  const n = (fails.get(k) ?? 0) + 1;
  fails.set(k, n);
  return n;
};

// Progress (or an explicit user retry) clears the backoff.
export const clearFailure = (
  kind: FailKind,
  path: string,
  page?: number,
): void => {
  fails.delete(keyOf(kind, path, page));
};

export const failCount = (
  kind: FailKind,
  path: string,
  page?: number,
): number => fails.get(keyOf(kind, path, page)) ?? 0;

// The ONE question every payer asks before retrying.
export const failCapped = (
  kind: FailKind,
  path: string,
  page?: number,
): boolean => failCount(kind, path, page) >= CAPS[kind];

export const failCap = (kind: FailKind): number => CAPS[kind];

// Tests only: a fresh session.
export const __resetFailLedgerForTests = (): void => {
  fails.clear();
};
