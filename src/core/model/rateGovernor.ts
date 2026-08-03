// Adaptive rate governor (v0.78.6). Mistral's free tier caps throughput
// (~30 req/min); a big Auto/Sync burst blows past it and every call 429s, so
// whole notes "failed to read → will retry" and re-burst on the next pass —
// thrashing, and nothing drains. This paces ALL Mistral calls GLOBALLY: zero
// overhead while things are fine, but once a 429 is seen it spaces the
// following requests (leaky-bucket) and backs off harder on repeats; a run of
// clean calls speeds back up. There is NO free/paid mode — it simply adapts
// to whatever the key's real limit is, and to Mistral changing it later.
//
// Pure module: now()/sleep are injected so the ramp is unit-tested with fake
// time. State is process-global on purpose — the whole point is that one
// 429 slows every concurrent reader at once.

const BASE_PACE_MS = 2_500; // first 429 → ~24 starts/min
const MAX_PACE_MS = 30_000; // never slower than one call / 30 s
const DECAY_AFTER_OK = 8; // halve the pace after this many clean calls

let paceMs = 0; // current minimum gap between request STARTS (0 = off)
let nextSlot = 0; // earliest timestamp the next request may start
let okStreak = 0;

// Freeze-proof by default (audit 2026-07-30 C2): the pacing wait was the
// worst of the frozen sleeps — one background 429 turned pacing on, and the
// user's next chat send awaited a timer that never fired while floating.
import {sleepVia} from './sleepImpl';
const localSleep = (ms: number): Promise<void> => sleepVia(ms);

// Test/diagnostic hooks.
export const rateReset = (): void => {
  paceMs = 0;
  nextSlot = 0;
  okStreak = 0;
};
export const ratePaceMs = (): number => paceMs;

// Reserve the next send slot and resolve AFTER the wait, so callers are
// spaced by paceMs even when many run concurrently. The slot is reserved
// synchronously (no await between read and write of nextSlot), so concurrent
// acquirers queue deterministically on JS's single thread.
export const rateAcquire = async (
  now: number = Date.now(),
  sleepFn: (ms: number) => Promise<void> = localSleep,
): Promise<void> => {
  if (paceMs === 0) {
    return; // fast path — no throttling until a 429 turns it on
  }
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + paceMs;
  const wait = slot - now;
  if (wait > 0) {
    await sleepFn(wait);
  }
};

// Feed back the HTTP outcome. 429 → back off (double, capped, from BASE);
// a clean 2xx/3xx → decay after a streak; other errors are neutral (a 500
// or a 402 is not a throughput signal).
export const rateReport = (
  status: number | undefined,
  now: number = Date.now(),
): void => {
  if (status === 429) {
    okStreak = 0;
    paceMs =
      paceMs === 0 ? BASE_PACE_MS : Math.min(MAX_PACE_MS, paceMs * 2);
    nextSlot = Math.max(nextSlot, now + paceMs);
  } else if (status !== undefined && status >= 200 && status < 400) {
    if (paceMs > 0 && ++okStreak >= DECAY_AFTER_OK) {
      okStreak = 0;
      paceMs = paceMs <= BASE_PACE_MS ? 0 : Math.floor(paceMs / 2);
    }
  }
};
