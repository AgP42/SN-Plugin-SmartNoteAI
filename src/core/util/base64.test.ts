import {bytesToBase64, utf8ToBase64, utf8ToBytes} from './base64';

describe('bytesToBase64', () => {
  const enc = (s: string) =>
    bytesToBase64(new Uint8Array([...s].map(c => c.charCodeAt(0))));
  it('matches known vectors incl. padding', () => {
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });
  it('handles high bytes', () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0x00, 0x80]))).toBe('/wCA');
  });
});

describe('utf8ToBytes / utf8ToBase64', () => {
  it('encodes ASCII', () => {
    expect([...utf8ToBytes('hello')]).toEqual([104, 101, 108, 108, 111]);
    expect(utf8ToBase64('hello')).toBe('aGVsbG8=');
  });
  it('encodes 2-byte accents (é = C3 A9)', () => {
    expect([...utf8ToBytes('é')]).toEqual([0xc3, 0xa9]);
    expect(utf8ToBase64('é')).toBe('w6k=');
  });
  it('encodes 4-byte emoji via surrogate pair (😀 = F0 9F 98 80)', () => {
    expect([...utf8ToBytes('😀')]).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(utf8ToBase64('😀')).toBe('8J+YgA==');
  });
  it('round-trips a mixed persona string through JSON', () => {
    const persona = 'Tu es un assistant précis. Sois bref 🙂';
    const json = JSON.stringify({persona});
    // Decode the base64 back to bytes, then UTF-8 decode, and compare.
    const b64 = utf8ToBase64(json);
    const bin = Buffer.from(b64, 'base64');
    expect(bin.toString('utf8')).toBe(json);
  });
});

describe('utf8FromBytes', () => {
  const {utf8FromBytes} = require('./base64');
  it('inverts utf8ToBytes for accents + emoji', () => {
    for (const s of ['hello', 'é', '😀', 'Tu es précis 🙂 — bref!', '']) {
      expect(utf8FromBytes(utf8ToBytes(s))).toBe(s);
    }
  });
  it('skips a leading BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8ToBytes('hi')]);
    expect(utf8FromBytes(withBom)).toBe('hi');
  });
});
