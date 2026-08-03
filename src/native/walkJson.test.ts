// The native walk's JSON → NoteSnapshot parser. The Kotlin side is a
// port of readNoteViaRanges; this pins the JS half of the contract.
jest.mock('react-native', () => ({NativeModules: {}}));
import {snapshotFromWalkJson} from './noteTranscripts';

describe('snapshotFromWalkJson (v0.67 native walk)', () => {
  it('builds a full snapshot, sorted, 0-indexed', () => {
    const s = snapshotFromWalkJson(
      JSON.stringify({
        count: 3,
        pages: [
          {p: 2, rev: '900', id: 'P2', star: true, recogn: 'deux'},
          {p: 0, rev: '100', id: 'P0', landscape: true},
          {p: 1, rev: '500'},
        ],
        kws: [
          {p: 1, t: 'zebra'},
          {p: 1, t: 'alpha'},
          {p: 0, t: 'été'},
        ],
      }),
    );
    expect(s).not.toBeNull();
    expect(s?.count).toBe(3);
    expect(s?.ids.get(0)).toBe('P0');
    expect(s?.ids.get(2)).toBe('P2');
    expect(s?.ids.has(1)).toBe(false);
    expect(s?.revs.get(1)).toBe('500');
    expect(s?.recogn.get(2)).toBe('deux');
    expect(s?.stars).toEqual([2]);
    expect(s?.landscape).toEqual([0]);
    expect(s?.kws).toEqual([
      {p: 0, t: 'été'},
      {p: 1, t: 'alpha'},
      {p: 1, t: 'zebra'},
    ]);
  });

  it('drops malformed pages/keywords, keeps the rest', () => {
    const s = snapshotFromWalkJson(
      JSON.stringify({
        count: 2,
        pages: [{p: -1, rev: 'x'}, {p: 'nope'}, {p: 1, rev: '7', id: 'ok'}],
        kws: [{p: 'bad', t: 'x'}, {p: 0, t: ''}, {p: 0, t: 'kept'}],
      }),
    );
    expect(s?.ids.get(1)).toBe('ok');
    expect(s?.ids.size).toBe(1);
    expect(s?.kws).toEqual([{p: 0, t: 'kept'}]);
  });

  it('returns null on malformed documents (JS walk takes over)', () => {
    expect(snapshotFromWalkJson('not json')).toBeNull();
    expect(snapshotFromWalkJson('{"count":"x"}')).toBeNull();
    expect(snapshotFromWalkJson('{"count":1,"pages":{},"kws":[]}')).toBeNull();
  });
});
