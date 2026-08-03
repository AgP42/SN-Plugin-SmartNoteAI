// Curated Mistral model shortlist for the CHAT picker. A convenience
// preset, NOT an allow-list — the config keeps a free-text field so any
// model id works immediately.
//
// v0.24 (bench 2026-07-12): only models that can drive the built-in
// TOOLS (web search / code interpreter) are preset here — the ministral
// family and nemo are great readers but Mistral rejects connectors on
// them (measured). Prices in €/M tokens (in · out), USD list ×0.875
// (verified 2026-07-12). Default = Small (open, tools, cheapest of the
// tool-capable models, benched on par with Large/Medium).

export type CatalogEntry = {
  id: string;
  label: string;
  note?: string;
  // Fixed description shown under the picker (user-authored, v0.49).
  desc?: string;
  // Numeric input price in €/M tokens (v0.55: feeds the AGENTS cost
  // estimate). Mirrors the human-readable `note` — the API publishes no
  // prices, so both are static "as of 07/2026".
  inEurPerM?: number;
};

// Input price of a model id for estimates; undefined for a custom id
// outside the presets (the UI then shows tokens only, "price unknown").
export const inputPriceEurPerM = (id: string): number | undefined =>
  MISTRAL_MODELS.find(m => m.id === id.trim())?.inEurPerM;

// Known-incapable of the built-in connectors (measured 2026-07-12:
// HTTP 400 "does not support builtin connectors"). Anything else is
// assumed tool-capable so a brand-new model isn't blocked; only these
// families get their Web search / Code toggles greyed out.
export const modelLacksTools = (id: string): boolean =>
  /^(ministral|open-mistral-nemo|mistral-tiny|pixtral|voxtral)/.test(
    id.toLowerCase().trim(),
  );

// Order = button order in the config. THREE presets since v0.49 (user
// decision after reading the live API data): the Magistral chips were a
// duplicate (magistral-small-latest IS mistral-small-2603) and a dying
// model (magistral-medium deprecated 2026-07-31). Note = openness +
// static prices (the API publishes none); desc = the user's fixed
// description shown under the picker. Medium 3.5 went OPEN WEIGHTS
// (Modified MIT) — the old "proprietary" tag was stale.
export const MISTRAL_MODELS: CatalogEntry[] = [
  {
    id: 'mistral-small-latest',
    label: 'Small',
    note: 'open weights · 0.13/0.53 €/M · default',
    inEurPerM: 0.13,
    desc:
      'Mistral Small 4\nOur powerful hybrid model unifying instruct, ' +
      'reasoning, and coding capabilities in a single model. 119B ' +
      'parameters with 6.5B active.',
  },
  {
    id: 'mistral-medium-latest',
    label: 'Medium',
    note: 'open weights (Modified MIT) · 1.31/6.56 €/M · priciest output',
    inEurPerM: 1.31,
    desc:
      'Mistral Medium 3.5\nOur frontier-class multimodal model optimized ' +
      'for agentic and coding use cases. Released as open weights under a ' +
      'Modified MIT license.',
  },
  {
    id: 'mistral-large-latest',
    label: 'Large',
    note: 'open weights · 0.44/1.31 €/M · top quality',
    inEurPerM: 0.44,
    desc:
      'Mistral Large 3\nMistral Large 3, is a state-of-the-art, ' +
      'open-weight, general-purpose multimodal model with a granular ' +
      'Mixture-of-Experts architecture. It features 41B active parameters ' +
      'and 675B total parameters.',
  },
];
