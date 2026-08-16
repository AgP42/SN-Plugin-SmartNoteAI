// The session failure ledger (lot 4a) — shape, caps, and the sweep's
// path-safety (fix-verify 2026-08-16 #3: '#' is legal in Android filenames,
// so the page separator must be a character no path can contain).
import {
  noteFailure,
  clearFailure,
  clearFailuresFor,
  failCount,
  failCapped,
  failCap,
  __resetFailLedgerForTests,
} from './failLedger';

beforeEach(() => __resetFailLedgerForTests());

it('counts, caps and clears per (kind, path, page)', () => {
  expect(noteFailure('vision', '/a.pdf', 1)).toBe(1);
  expect(noteFailure('vision', '/a.pdf', 1)).toBe(2);
  expect(failCapped('vision', '/a.pdf', 1)).toBe(false);
  noteFailure('vision', '/a.pdf', 1);
  expect(failCapped('vision', '/a.pdf', 1)).toBe(true);
  expect(failCap('vision')).toBe(3);
  // kinds and pages are independent
  expect(failCount('read', '/a.pdf', 1)).toBe(0);
  expect(failCount('vision', '/a.pdf', 2)).toBe(0);
  clearFailure('vision', '/a.pdf', 1);
  expect(failCount('vision', '/a.pdf', 1)).toBe(0);
});

it('clearFailuresFor sweeps one doc, all pages + the doc-level key', () => {
  noteFailure('vision', '/d.pdf', 0);
  noteFailure('vision', '/d.pdf', 7);
  noteFailure('vision', '/d.pdf');
  noteFailure('doc', '/d.pdf');
  clearFailuresFor('vision', '/d.pdf');
  expect(failCount('vision', '/d.pdf', 0)).toBe(0);
  expect(failCount('vision', '/d.pdf', 7)).toBe(0);
  expect(failCount('vision', '/d.pdf')).toBe(0);
  expect(failCount('doc', '/d.pdf')).toBe(1); // other kind untouched
});

it("a '#' in a filename can never make one doc's sweep hit another", () => {
  const a = '/Document/a.pdf';
  const b = '/Document/a.pdf#old.pdf'; // legal Android filename
  noteFailure('vision', b, 3);
  clearFailuresFor('vision', a);
  expect(failCount('vision', b, 3)).toBe(1); // untouched
});
