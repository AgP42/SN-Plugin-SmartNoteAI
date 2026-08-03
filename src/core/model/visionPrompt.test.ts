import {
  assemblePdfVisionPrompt,
  PROMPT_BLOCKS,
  assembleVisionPrompt,
  isBlockCustom,
} from './visionPrompt';

describe('assembleVisionPrompt', () => {
  it('joins all default blocks (empty glossary dropped)', () => {
    const p = assembleVisionPrompt({});
    // role + fidelity + formatting + drawings + template + languages + money
    // = 7 non-empty default blocks (glossary default is empty → dropped).
    expect(p.split('\n\n')).toHaveLength(7);
    expect(p).toContain('transcribe');
    expect(p).toContain('euros');
    expect(p).not.toMatch(/\n\n\n/); // no empty block gaps
  });

  it('an override replaces exactly that block', () => {
    const p = assembleVisionPrompt({money: 'Amounts are in US dollars.'});
    expect(p).toContain('US dollars');
    expect(p).not.toContain('euros');
  });

  it('a filled glossary block is appended', () => {
    const p = assembleVisionPrompt({glossary: 'Names: Wolfgang, Cl66.'});
    expect(p).toContain('Wolfgang');
    expect(p.split('\n\n')).toHaveLength(8);
  });

  it('an empty override drops the block', () => {
    const p = assembleVisionPrompt({money: '   '});
    expect(p).not.toContain('euros');
    expect(p.split('\n\n')).toHaveLength(6);
  });
});

describe('PDF blocks are editable (v0.47)', () => {
  it('honors pdfRole/pdfFidelity overrides in the assembled PDF prompt', () => {
    const p = assemblePdfVisionPrompt({
      pdfRole: 'CUSTOM PDF ROLE',
      pdfFidelity: 'CUSTOM PDF FIDELITY',
    });
    expect(p.startsWith('CUSTOM PDF ROLE\n\nCUSTOM PDF FIDELITY')).toBe(true);
    // The .note-only role override must NOT leak into the PDF variant.
    const q = assemblePdfVisionPrompt({role: 'NOTE ROLE OVERRIDE'});
    expect(q).not.toContain('NOTE ROLE OVERRIDE');
  });
});

describe('assemblePdfVisionPrompt (PDF escalation variant)', () => {
  it('neutral document role — never claims handwritten notebook / e-ink', () => {
    const p = assemblePdfVisionPrompt();
    expect(p).toContain('PDF document');
    expect(p).not.toContain('handwritten notebook');
    expect(p).not.toContain('e-ink');
  });

  it('drops the notebook template block, keeps the content blocks', () => {
    const p = assemblePdfVisionPrompt();
    expect(p).not.toContain('printed template graphics');
    expect(p).toContain('light Markdown'); // formatting
    expect(p).toContain('French, English'); // languages
    expect(p).toContain('euros'); // money
  });

  it('applies the user overrides on the shared blocks', () => {
    const p = assemblePdfVisionPrompt({glossary: 'ACME, Dr Ramirez'});
    expect(p).toContain('ACME, Dr Ramirez');
    // …but a customised notebook role does NOT leak into the PDF prompt.
    const p2 = assemblePdfVisionPrompt({role: 'MY CUSTOM ROLE'});
    expect(p2).not.toContain('MY CUSTOM ROLE');
  });
});

describe('isBlockCustom', () => {
  const money = PROMPT_BLOCKS.find(b => b.id === 'money')!;
  it('false when absent or equal to default', () => {
    expect(isBlockCustom(money, {})).toBe(false);
    expect(isBlockCustom(money, {money: money.default})).toBe(false);
  });
  it('true when the override differs', () => {
    expect(isBlockCustom(money, {money: 'dollars'})).toBe(true);
  });
});
