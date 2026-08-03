// Heartbeat-backed sleep (audit 2026-07-30 C2). RN freezes JS timers while
// the plugin view is backgrounded, but NATIVE events still run JS — and the
// overlay module emits SmartNoteAiHeartbeat every 2.5 s on a main-looper
// Handler whenever the bubble/panel overlay is up. sleepHybrid resolves on
// whichever comes first: the plain timer (foreground) or the first
// heartbeat past the deadline (frozen-timer state). Worst case with the
// overlay up: ms + 2.5 s. With no overlay AND frozen timers the plugin is
// dormant anyway (nothing user-facing is awaiting).
import {DeviceEventEmitter} from 'react-native';
import {setSleepImpl} from '../core/model/sleepImpl';

export const sleepHybrid = (ms: number): Promise<void> =>
  new Promise<void>(resolve => {
    const deadline = Date.now() + ms;
    let done = false;
    let sub: {remove: () => void} | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      sub?.remove();
      if (timer !== null) {
        clearTimeout(timer);
      }
      resolve();
    };
    try {
      sub = DeviceEventEmitter.addListener('SmartNoteAiHeartbeat', () => {
        if (Date.now() >= deadline) {
          finish();
        }
      });
    } catch {
      sub = null; // no emitter (tests) — the timer alone carries it
    }
    timer = setTimeout(finish, ms);
  });

// Called once from index.js at plugin boot: every core wait (retry sleep,
// 429 pacing, request watchdog) becomes freeze-proof.
export const installHybridSleep = (): void => {
  setSleepImpl(sleepHybrid);
};

// A yield that survives the frozen-timer state: setImmediate is flushed at
// the end of the current JS batch (it is not a scheduled timer), so a long
// paid loop can let the UI breathe without waiting for a heartbeat.
export const yieldToJs = (): Promise<void> =>
  new Promise<void>(resolve => {
    const si = (globalThis as {setImmediate?: (fn: () => void) => void})
      .setImmediate;
    if (typeof si === 'function') {
      si(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
