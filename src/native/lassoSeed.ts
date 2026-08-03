// Lasso → chat seed (v0.73; v0.81 image-only): the lasso toolbar button
// captures the selection as a PNG and stashes it here; the chat (ChatPanel,
// a separate React root in the same JS runtime) consumes it when it opens —
// or, if already open, via the subscription (a lasso can be fired while the
// panel is up). One-shot: consuming clears it so the image isn't re-added
// on the next render. The image becomes a PERSISTENT context chip.
// `note`: the file the selection was taken from. REQUIRED for the Off gate
// (full review 2026-08-02 #2: a lasso on an Off note was sent and persisted
// with no consent, because the gate only looked at the page context).
export type LassoSeed = {image: string; note?: string};

let seed: LassoSeed | null = null;
const subs = new Set<() => void>();

export const setLassoSeed = (s: LassoSeed): void => {
  seed = s;
  for (const fn of subs) {
    try {
      fn();
    } catch {
      // a listener must not break the capture path
    }
  }
};

export const consumeLassoSeed = (): LassoSeed | null => {
  const s = seed;
  seed = null;
  return s;
};

export const subscribeLassoSeed = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
