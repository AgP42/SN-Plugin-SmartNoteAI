// Anti-bleed writer gate (2026-08-16): the only rejections allowed are
// near-zero overlaps against a SUBSTANTIAL OCR baseline — everything weaker
// must pass, or the gate would block legitimate vision output.
import {visionMatchesOcr} from './visionOverlap';

// 16 distinct ≥4-char tokens — a substantial printed-page baseline.
const FITNESS_OCR =
  'transformation indice énergie régularité mental comportement semaine ' +
  'critère positif objectif balance centimètre évolution physique action hebdomadaire';

// The BUJO p9 incident shape: another document's content, zero shared vocabulary.
const WORK_BLEED =
  'réunion alstom siemens faiveley stadler locomotive retrofit planning ' +
  'contrat freight direction projet documents techniques sécurité valider';

describe('visionMatchesOcr', () => {
  it('rejects a transcription sharing nothing with a substantial baseline (the bleed)', () => {
    expect(visionMatchesOcr(FITNESS_OCR, WORK_BLEED)).toBe(false);
  });

  it('accepts a faithful transcription (reformatted, accents/case-folded)', () => {
    const vision =
      '# Mon Indice TRANSFORMATION\n\nLa transformation se mesure en énergie, ' +
      'régularité et état mental — un critère positif par semaine, un objectif ' +
      'physique, une action hebdomadaire.';
    expect(visionMatchesOcr(FITNESS_OCR, vision)).toBe(true);
  });

  it('never judges on a weak baseline (<15 distinct long tokens)', () => {
    expect(visionMatchesOcr('pdf ocr page', WORK_BLEED)).toBe(true);
    expect(visionMatchesOcr('', WORK_BLEED)).toBe(true);
  });

  it('a photo-description with partial vocabulary passes (annotations add words)', () => {
    const vision =
      'Semaine 3 — je note mon indice de transformation, mon énergie et mes ' +
      'objectifs physiques de la semaine, avec une action et un critère.';
    expect(visionMatchesOcr(FITNESS_OCR, vision)).toBe(true);
  });
});
