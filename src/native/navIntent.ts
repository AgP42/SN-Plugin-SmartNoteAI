// One-shot navigation intent from the floating panel to the config
// (v0.64): the panel can't reach App's screen state directly (separate
// React roots, same JS runtime). The panel sets an intent, App consumes
// it via a cheap foreground poll (timers RUN while the config is the
// foreground activity; they are frozen only while it is backgrounded —
// exactly when nothing should navigate anyway).
let pending: string | null = null;
export const setNavIntent = (screen: string): void => {
  pending = screen;
};
export const consumeNavIntent = (): string | null => {
  const p = pending;
  pending = null;
  return p;
};
