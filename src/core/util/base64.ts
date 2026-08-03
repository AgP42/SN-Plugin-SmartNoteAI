// Pure base64 encoder/decoder for binary bytes (PNG, .note blocks) —
// no Buffer (not in RN), no atob/btoa dependency.
const TABLE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse lookup: char code → 6-bit value (-1 = not a base64 char).
const REV: number[] = (() => {
  const r = new Array(128).fill(-1);
  for (let i = 0; i < TABLE.length; i++) {
    r[TABLE.charCodeAt(i)] = i;
  }
  return r;
})();

// Decode standard base64 (padding and embedded whitespace tolerated;
// any other foreign character is skipped). Used for the RECOGNTEXT
// blocks stored inside .note files.
export const base64ToBytes = (b64: string): Uint8Array => {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = b64.charCodeAt(i) < 128 ? REV[b64.charCodeAt(i)] : -1;
    if (v === -1) {
      continue; // '=', whitespace, or junk
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += TABLE[b0 >> 2];
    out += TABLE[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? TABLE[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? TABLE[b2 & 63] : '=';
  }
  return out;
};

// UTF-8 encode a JS string to bytes — no TextEncoder (not guaranteed in
// the PluginHost RN runtime). Handles the BMP + surrogate pairs so
// accents/emoji in a persona survive a round-trip through the native
// writeFileBase64 path.
export const utf8ToBytes = (str: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i++;
        continue;
      }
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(bytes);
};

export const utf8ToBase64 = (str: string): string =>
  bytesToBase64(utf8ToBytes(str));

// UTF-8 decode bytes to a JS string (skips a leading BOM). Needed for
// settings.json, which may hold a persona with accents/emoji — the
// key-file's byte-wise ASCII decode would mangle those.
export const utf8FromBytes = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  const n = bytes.length;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (i < n) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 < 0xe0) {
      const b1 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 < 0xf0) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      const b3 = bytes[i++] & 0x3f;
      const cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
};
