import {
  buildReaderRequest,
  buildImproveRequest,
  READER_MAX_TOKENS,
  reflowTranscript,
  stripWrappingFence,
} from './reader';

describe('buildReaderRequest', () => {
  it('carries the page image + the assembled system prompt verbatim', () => {
    const req = buildReaderRequest('PNGB64', 'SYSTEM PROMPT HERE');
    expect(req.system).toBe('SYSTEM PROMPT HERE');
    expect(req.turns).toHaveLength(1);
    expect(req.turns[0].images).toEqual(['PNGB64']);
    expect(req.maxTokens).toBe(READER_MAX_TOKENS);
    expect(req.cacheKey).toBeUndefined();
  });
});

describe('buildImproveRequest', () => {
  it('passes the system prompt and rides the previous transcript as a hint', () => {
    const req = buildImproveRequest('IMG', 'SYS', 'prior text');
    expect(req.system).toBe('SYS');
    expect(req.turns[0].images).toEqual(['IMG']);
    expect(req.turns[0].text).toContain('--- hint ---');
    expect(req.turns[0].text).toContain('prior text');
  });
});

describe('reflowTranscript (deterministic full-line reflow, 2026-07-13)', () => {
  it('joins hand-wrap continuation into the bullet/item line', () => {
    const t = '✓ Un new Smart DCA\nbased on Wave Rider\n\n- Un smart Grid, qui entre\navec déjà 50% de son capital\nqd sort vers le bas';
    const r = reflowTranscript(t);
    expect(r).toBe(
      '✓ Un new Smart DCA based on Wave Rider\n\n- Un smart Grid, qui entre avec déjà 50% de son capital qd sort vers le bas',
    );
  });
  it('keeps each bullet/number/heading on its own line', () => {
    const t = '- Eth long +15\n- SOL long +17\n1. first\n2. second';
    expect(reflowTranscript(t)).toBe(t);
  });
  it('de-hyphenates words split across a wrap', () => {
    expect(reflowTranscript('compres-\nsion done')).toBe('compression done');
  });
  it('preserves blank-line paragraph breaks', () => {
    expect(reflowTranscript('para one\nline two\n\npara two')).toBe(
      'para one line two\n\npara two',
    );
  });
});

describe('reflow vs horizontal rules (v0.65.1 — "--- une phrase" glued)', () => {
  it('a --- line never absorbs the next line', () => {
    expect(reflowTranscript('Section un\n---\nSection deux')).toBe(
      'Section un\n---\nSection deux',
    );
  });
  it('a line after *** stays separate too', () => {
    expect(reflowTranscript('***\nla suite')).toBe('***\nla suite');
  });
  it('normal wraps still join', () => {
    expect(reflowTranscript('une phrase cou-\npée en deux')).toBe(
      'une phrase coupée en deux',
    );
  });
});

describe('fences (device report 2026-07-20 — page rendered as raw code)', () => {
  it('strips a tagged ```markdown wrapper around the whole answer', () => {
    const raw = '```markdown\n# Titre\n\nDu texte.\n```';
    expect(stripWrappingFence(raw)).toBe('# Titre\n\nDu texte.');
  });

  it('strips a bare wrapper only when the inside reads as markdown', () => {
    const md = '```\n# Titre\n- un\n```';
    expect(stripWrappingFence(md)).toBe('# Titre\n- un');
    const code = '```\nadb logcat -d\nreboot\n```';
    expect(stripWrappingFence(code)).toBe(code);
  });

  it('keeps an inner fenced block verbatim through reflow', () => {
    const raw = 'Commande :\n```\nadb logcat -d\n\nadb reboot\n```\nPuis suite.';
    expect(reflowTranscript(raw)).toBe(raw);
  });

  it('a wrapped answer reflows to clean markdown, fence gone', () => {
    const raw =
      '```markdown\n# Plugin dev\n\nIdée : utiliser adb.\n\n- point un\n- point deux\n```';
    const stored = reflowTranscript(raw);
    expect(stored).not.toContain('```');
    expect(stored).toContain('# Plugin dev');
    expect(stored).toContain('- point deux');
  });
});
