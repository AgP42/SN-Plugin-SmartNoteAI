import {footerSignature} from './footerSig';

describe('footerSignature', () => {
  it('is deterministic and page-ordered regardless of insertion order', () => {
    const a = new Map([
      [2, '900'],
      [0, '100'],
      [1, '500'],
    ]);
    const b = new Map([
      [0, '100'],
      [1, '500'],
      [2, '900'],
    ]);
    expect(footerSignature(a)).toBe('0:100;1:500;2:900');
    expect(footerSignature(a)).toBe(footerSignature(b));
  });

  it('changes when any page block address moves (an edit)', () => {
    const before = new Map([
      [0, '100'],
      [1, '500'],
    ]);
    const afterEdit = new Map([
      [0, '100'],
      [1, '740'], // page 1 rewritten at a new address
    ]);
    expect(footerSignature(before)).not.toBe(footerSignature(afterEdit));
  });

  it('changes when a page is added or removed', () => {
    const two = new Map([
      [0, '100'],
      [1, '500'],
    ]);
    const three = new Map([
      [0, '100'],
      [1, '500'],
      [2, '900'],
    ]);
    expect(footerSignature(two)).not.toBe(footerSignature(three));
  });

  it('empty map → empty signature (unreadable footer = never skip)', () => {
    expect(footerSignature(new Map())).toBe('');
  });
});
