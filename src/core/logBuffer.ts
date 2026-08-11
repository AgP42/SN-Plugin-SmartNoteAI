// The in-memory diagnostic ring (2026-08-11, user need: once the plugin is
// public, a user who hits a bug has no adb and no way to tell us anything
// beyond "it doesn't work" — so the plugin has to keep its own log and be
// able to hand it over as a file).
//
// Capture is ALWAYS on. A toggle defaulting to off would be useless here:
// the bug happens first, and by the time anyone thinks to enable logging
// the evidence is gone. This is why it is a bounded RING — it costs a few
// hundred KB of memory, never grows, and never needs a decision.
//
// Pure: no clock, no IO. The caller formats a line and pushes it.

export const MAX_LINES = 1500;
export const MAX_BYTES = 256 * 1024;

const lines: string[] = [];
let bytes = 0;

// One very long line (a stack, a serialized payload) must not blow the
// budget on its own.
const CLAMP = 4000;

export const pushLine = (line: string): void => {
  const s = line.length > CLAMP ? `${line.slice(0, CLAMP)}… [+${line.length - CLAMP}]` : line;
  lines.push(s);
  bytes += s.length;
  while (lines.length > MAX_LINES || bytes > MAX_BYTES) {
    const drop = lines.shift();
    if (drop === undefined) {
      break;
    }
    bytes -= drop.length;
  }
};

export const snapshotLines = (): string[] => [...lines];

export const bufferStats = (): {lines: number; bytes: number} => ({
  lines: lines.length,
  bytes,
});

export const clearBuffer = (): void => {
  lines.length = 0;
  bytes = 0;
};
