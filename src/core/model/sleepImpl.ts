// The ONE sleep every core wait goes through (audit 2026-07-30 C2): plain
// setTimeout is FROZEN by React Native the moment the plugin view is
// backgrounded — the normal floating state — so the retry sleep, the 429
// pacing wait and the request watchdog all hung exactly when they were
// needed, wedging `busy`/`foregroundBusy` for good. Core stays PURE: the
// default is the plain timer (fine for tests and for foreground states);
// index.js installs the native heartbeat-backed hybrid at boot.
type SleepFn = (ms: number) => Promise<void>;

const timerSleep: SleepFn = ms => new Promise<void>(r => setTimeout(r, ms));

let impl: SleepFn = timerSleep;

// Installed once at plugin boot (src/native/nativeSleep.ts). Tests can
// inject a fake to pin pacing logic without real waits.
export const setSleepImpl = (fn: SleepFn | null): void => {
  impl = fn ?? timerSleep;
};

export const sleepVia: SleepFn = ms => impl(ms);
