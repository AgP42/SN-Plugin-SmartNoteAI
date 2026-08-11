import {
  pushLine,
  snapshotLines,
  clearBuffer,
  bufferStats,
  MAX_LINES,
} from './logBuffer';

beforeEach(() => clearBuffer());

describe('logBuffer (bounded ring)', () => {
  it('keeps lines in order and reports its size', () => {
    pushLine('a');
    pushLine('b');
    expect(snapshotLines()).toEqual(['a', 'b']);
    expect(bufferStats()).toEqual({lines: 2, bytes: 2});
  });

  it('drops the OLDEST lines past the line cap — the tail is what matters', () => {
    for (let i = 0; i < MAX_LINES + 50; i++) {
      pushLine(`line ${i}`);
    }
    const out = snapshotLines();
    expect(out.length).toBe(MAX_LINES);
    expect(out[out.length - 1]).toBe(`line ${MAX_LINES + 49}`);
    expect(out[0]).toBe('line 50'); // the first 50 fell off
  });

  it('clamps a single huge line instead of letting it eat the budget', () => {
    pushLine('x'.repeat(10000));
    const out = snapshotLines()[0];
    expect(out.length).toBeLessThan(4100);
    expect(out).toContain('[+6000]');
  });

  it('enforces the byte cap even when the line count is low', () => {
    for (let i = 0; i < 200; i++) {
      pushLine('y'.repeat(3900)); // ~780 KB pushed, cap is 256 KB
    }
    expect(bufferStats().bytes).toBeLessThanOrEqual(256 * 1024);
    expect(snapshotLines().length).toBeLessThan(200);
  });

  it('a snapshot is a COPY — a later push never mutates it', () => {
    pushLine('a');
    const snap = snapshotLines();
    pushLine('b');
    expect(snap).toEqual(['a']);
  });
});
