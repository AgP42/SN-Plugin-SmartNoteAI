import {parseRecognTexts} from './recognText';
import {bytesToBase64, utf8ToBytes} from '../util/base64';

// Build a minimal synthetic .note: signature, blocks, footer, tail addr.
const ascii = (s: string): number[] => Array.from(s, c => c.charCodeAt(0));
const u32le = (n: number): number[] => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >> 24) & 0xff,
];

class NoteBuilder {
  bytes: number[] = ascii('noteSN_FILE_VER_20260016');
  addBlock(content: number[]): number {
    const addr = this.bytes.length;
    this.bytes.push(...u32le(content.length), ...content);
    return addr;
  }
  finish(footerAddr: number): Uint8Array {
    this.bytes.push(...u32le(footerAddr));
    return new Uint8Array(this.bytes);
  }
}

const recognBlock = (labels: string[]): number[] =>
  ascii(
    bytesToBase64(
      utf8ToBytes(JSON.stringify({elements: labels.map(l => ({label: l}))})),
    ),
  );

describe('parseRecognTexts', () => {
  it('extracts per-page transcripts via the tail footer (0-indexed)', () => {
    const nb = new NoteBuilder();
    const rt1 = nb.addBlock(recognBlock(['- Faire un bilan\nassurances']));
    const rt3 = nb.addBlock(recognBlock(['Data Hub', 'PSM actives']));
    const p1 = nb.addBlock(
      ascii(`<PAGESTYLE:x><RECOGNSTATUS:1><RECOGNTEXT:${rt1}><PAGEID:a>`),
    );
    const p2 = nb.addBlock(
      ascii('<PAGESTYLE:x><RECOGNSTATUS:0><RECOGNTEXT:0><PAGEID:b>'),
    );
    const p3 = nb.addBlock(
      ascii(`<PAGESTYLE:x><RECOGNSTATUS:1><RECOGNTEXT:${rt3}><PAGEID:c>`),
    );
    const footer = nb.addBlock(
      ascii(`<PAGE1:${p1}><PAGE2:${p2}><PAGE3:${p3}><DIRTY:0>`),
    );
    const map = parseRecognTexts(nb.finish(footer));
    expect(map.get(0)).toBe('- Faire un bilan\nassurances');
    expect(map.has(1)).toBe(false); // RECOGNTEXT:0 → no transcript
    expect(map.get(2)).toBe('Data Hub\nPSM actives'); // labels joined
    expect(map.size).toBe(2);
  });

  it('survives corrupt addresses and bad JSON (skips those pages)', () => {
    const nb = new NoteBuilder();
    const badJson = nb.addBlock(ascii(bytesToBase64(utf8ToBytes('not json'))));
    const p1 = nb.addBlock(ascii(`<RECOGNTEXT:${badJson}>`));
    const p2 = nb.addBlock(ascii('<RECOGNTEXT:99999999>')); // out of bounds
    const footer = nb.addBlock(ascii(`<PAGE1:${p1}><PAGE2:${p2}>`));
    expect(parseRecognTexts(nb.finish(footer)).size).toBe(0);
  });

  it('returns empty for non-.note bytes', () => {
    expect(parseRecognTexts(new Uint8Array([1, 2, 3])).size).toBe(0);
    expect(
      parseRecognTexts(new Uint8Array(ascii('PDF-1.4 whatever padding....')))
        .size,
    ).toBe(0);
  });
});

describe('parsePageIds', () => {
  it('maps 0-indexed pages to their stable PAGEID', () => {
    const nb = new NoteBuilder();
    const p1 = nb.addBlock(
      ascii('<PAGESTYLE:x><PAGEID:P20260419091359339992ljJtwnvoS28E>'),
    );
    const p2 = nb.addBlock(ascii('<PAGESTYLE:x>')); // no PAGEID → absent
    const p3 = nb.addBlock(
      ascii('<RECOGNTEXT:0><PAGEID:P20260419092433373629FgXAxqhwOGo1>'),
    );
    const footer = nb.addBlock(ascii(`<PAGE1:${p1}><PAGE2:${p2}><PAGE3:${p3}>`));
    const {parsePageIds} = require('./recognText');
    const ids = parsePageIds(nb.finish(footer));
    expect(ids.get(0)).toBe('P20260419091359339992ljJtwnvoS28E');
    expect(ids.has(1)).toBe(false);
    expect(ids.get(2)).toBe('P20260419092433373629FgXAxqhwOGo1');
  });

  it('returns an empty map for non-note bytes', () => {
    const {parsePageIds} = require('./recognText');
    expect(parsePageIds(new Uint8Array([1, 2, 3])).size).toBe(0);
  });
});
