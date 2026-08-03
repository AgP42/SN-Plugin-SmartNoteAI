import {MISTRAL_MODELS} from './catalog';

describe('MISTRAL_MODELS', () => {
  it('has entries with unique non-empty ids', () => {
    expect(MISTRAL_MODELS.length).toBeGreaterThan(0);
    const ids = MISTRAL_MODELS.map(m => m.id);
    for (const m of MISTRAL_MODELS) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
