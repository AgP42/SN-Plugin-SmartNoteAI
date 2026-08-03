// Reads the REAL-TIME-RECOGNITION transcripts stored inside a .note
// file — the user's find (2026-07-10): when a notebook has real-time
// recognition ON, the firmware keeps a per-page transcript in the file
// itself, far better and ~instant compared to an on-demand
// recognizeElements run (measured 6-30 s/page, and it returned empty on
// the very notes whose stored transcript is perfect).
//
// Format (validated on-device against firmware `noteSN_FILE_VER_20260016`,
// matches the community-documented supernote-tool layout):
//   • The file is APPEND-ONLY; stale blocks linger. The AUTHORITATIVE
//     entry point is the tail: the last 4 bytes (LE u32) are the address
//     of the footer block.
//   • A block at address A = 4-byte LE length + that many content bytes.
//   • The footer is a keyword string: …<PAGE1:addr><PAGE2:addr>…
//   • Each PAGE block is a keyword string with <RECOGNSTATUS:n> and
//     <RECOGNTEXT:addr> (addr 0 = no transcript).
//   • The RECOGNTEXT block is base64 → UTF-8 JSON:
//     {elements: [{label: "<page text>", words: [...]}, …]}
//
// Pure module: bytes in, Map out. No RN, no fetch — the caller reads
// the file (src/native/noteTranscripts.ts) and hands us the bytes.

import {base64ToBytes, utf8FromBytes} from '../util/base64';

const u32 = (b: Uint8Array, off: number): number =>
  (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;

// Content bytes of the block at `addr`, or null when out of bounds /
// absurdly large (corrupt address — this is an append-only format full
// of stale offsets, so validate everything).
const blockAt = (b: Uint8Array, addr: number): Uint8Array | null => {
  if (addr <= 0 || addr + 4 > b.length) {
    return null;
  }
  const len = u32(b, addr);
  if (len === 0 || addr + 4 + len > b.length) {
    return null;
  }
  return b.subarray(addr + 4, addr + 4 + len);
};

// Keyword blocks (footer, page info) are ASCII/latin1 and small.
export const asLatin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += String.fromCharCode(b[i]);
  }
  return s;
};

// Join every element's label — a page usually has one Text element but
// the format allows several.
export const textFromRecognJson = (jsonBytes: Uint8Array): string => {
  const obj = JSON.parse(utf8FromBytes(jsonBytes)) as {
    elements?: Array<{label?: unknown}>;
  };
  const labels = (obj.elements ?? [])
    .map(e => (typeof e.label === 'string' ? e.label.trim() : ''))
    .filter(l => l.length > 0);
  return labels.join('\n');
};

// Extract every page's stored transcript. Keys are 0-INDEXED page
// numbers (matching getCurrentPageNum / getElements); pages without a
// usable transcript are simply absent. Never throws — a malformed file
// yields an empty map, a malformed page is skipped.
// Every page block also carries <PAGEID:P…> — a globally unique,
// creation-stamped id that FOLLOWS the page through deletions,
// insertions and reordering (verified on-device 2026-07-11). The
// TranscriptStore keys page entries on it so a deleted page never
// forces re-reading the pages after it — they just remap.
export const parsePageIds = (bytes: Uint8Array): Map<number, string> => {
  const out = new Map<number, string>();
  try {
    if (bytes.length < 32 || asLatin1(bytes.subarray(0, 6)) !== 'noteSN') {
      return out;
    }
    const footerBytes = blockAt(bytes, u32(bytes, bytes.length - 4));
    if (footerBytes === null) {
      return out;
    }
    const footer = asLatin1(footerBytes);
    const pageRe = /<PAGE(\d+):(\d+)>/g;
    let m: RegExpExecArray | null;
    while ((m = pageRe.exec(footer)) !== null) {
      try {
        const pageNum = parseInt(m[1], 10); // 1-indexed in the footer
        const pageBytes = blockAt(bytes, parseInt(m[2], 10));
        if (pageNum < 1 || pageBytes === null) {
          continue;
        }
        const id = /<PAGEID:([^>]+)>/.exec(asLatin1(pageBytes));
        if (id !== null && id[1].length > 0) {
          out.set(pageNum - 1, id[1]);
        }
      } catch {
        // skip this page, keep the others
      }
    }
    return out;
  } catch {
    return out;
  }
};

export const parseRecognTexts = (bytes: Uint8Array): Map<number, string> => {
  const out = new Map<number, string>();
  try {
    // Signature 'noteSN_FILE_VER_…' — anything else is not a .note.
    if (bytes.length < 32 || asLatin1(bytes.subarray(0, 6)) !== 'noteSN') {
      return out;
    }
    const footerBytes = blockAt(bytes, u32(bytes, bytes.length - 4));
    if (footerBytes === null) {
      return out;
    }
    const footer = asLatin1(footerBytes);
    const pageRe = /<PAGE(\d+):(\d+)>/g;
    let m: RegExpExecArray | null;
    while ((m = pageRe.exec(footer)) !== null) {
      try {
        const pageNum = parseInt(m[1], 10); // 1-indexed in the footer
        const pageBytes = blockAt(bytes, parseInt(m[2], 10));
        if (pageNum < 1 || pageBytes === null) {
          continue;
        }
        const info = asLatin1(pageBytes);
        const rt = /<RECOGNTEXT:(\d+)>/.exec(info);
        const recognBytes = rt ? blockAt(bytes, parseInt(rt[1], 10)) : null;
        if (recognBytes === null) {
          continue;
        }
        const text = textFromRecognJson(base64ToBytes(asLatin1(recognBytes)));
        if (text.length > 0) {
          out.set(pageNum - 1, text);
        }
      } catch {
        // skip this page, keep the others
      }
    }
    return out;
  } catch {
    return out;
  }
};
