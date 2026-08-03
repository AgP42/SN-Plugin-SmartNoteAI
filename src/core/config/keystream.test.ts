import {xorBytes, parseSecretFile} from './keystream';

describe('xorBytes', () => {
  it('round-trips (XOR is its own inverse)', () => {
    const data = new Uint8Array([1, 2, 3, 250, 0, 77]);
    const stream = new Uint8Array([9, 8, 7, 6, 5, 4]);
    expect(Array.from(xorBytes(xorBytes(data, stream), stream))).toEqual(
      Array.from(data),
    );
  });
  it('cycles a short keystream over longer data', () => {
    const data = new Uint8Array([1, 1, 1, 1, 1]);
    const stream = new Uint8Array([0xff, 0x00]);
    expect(Array.from(xorBytes(data, stream))).toEqual([
      0xfe, 1, 0xfe, 1, 0xfe,
    ]);
  });
});

describe('parseSecretFile', () => {
  it('accepts a valid v1 frame', () => {
    const f = parseSecretFile('{"v":1,"saltB64":"AA==","dataB64":"BB=="}');
    expect(f?.saltB64).toBe('AA==');
  });
  it('rejects null, garbage and wrong versions', () => {
    expect(parseSecretFile(null)).toBeNull();
    expect(parseSecretFile('')).toBeNull();
    expect(parseSecretFile('nope')).toBeNull();
    expect(parseSecretFile('{"v":2,"saltB64":"a","dataB64":"b"}')).toBeNull();
    expect(parseSecretFile('{"v":1,"saltB64":3,"dataB64":"b"}')).toBeNull();
  });
});
