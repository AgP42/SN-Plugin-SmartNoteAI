import {parseKeyFile, DEFAULT_MODEL} from './keyFile';

describe('parseKeyFile (legacy migration source: key only, v0.36)', () => {
  it('extracts the key and ignores the dead model/max_tokens knobs', () => {
    const r = parseKeyFile('key=sk-x\nmodel=pixtral-12b-2409\nmax_tokens=2048\n');
    expect(r).toEqual({ok: true, apiKey: 'sk-x'});
  });

  it('skips comments and blank lines', () => {
    const r = parseKeyFile('# comment\n\nkey=sk-y\n');
    expect(r).toEqual({ok: true, apiKey: 'sk-y'});
  });

  it('fails cleanly when there is no key at all', () => {
    const r = parseKeyFile('model=mistral-small-latest\n');
    expect(r.ok).toBe(false);
  });

  it('v0.76.1: accepts a BARE key (no "key=" prefix)', () => {
    const r = parseKeyFile('vYN93CjuIlXLuB8DdHjgxc2qv8C0Cg9k\n');
    expect(r).toEqual({ok: true, apiKey: 'vYN93CjuIlXLuB8DdHjgxc2qv8C0Cg9k'});
  });

  it('v0.76.1: a bare key wins even after comments/blank lines', () => {
    const r = parseKeyFile('# my key\n\n  sk-abcdef0123456789  \n');
    expect(r.ok).toBe(true);
    expect(r.ok && r.apiKey).toBe('sk-abcdef0123456789');
  });

  it('key= still takes priority over a bare line', () => {
    const r = parseKeyFile('bareLooksLikeAKey123\nkey=sk-real\n');
    expect(r.ok && r.apiKey).toBe('sk-real');
  });

  it('still exports the default model id (used by the settings layer)', () => {
    expect(DEFAULT_MODEL).toBe('mistral-small-latest');
  });
});
