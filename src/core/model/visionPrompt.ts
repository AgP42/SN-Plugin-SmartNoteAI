// The full vision transcription prompt, exposed as EDITABLE BLOCKS
// (v0.38, user decision: "nothing hidden"). The system prompt sent to the
// vision model is just these blocks joined — the user can rewrite any of
// them, and the config shows the assembled result verbatim.
//
// Since v0.38 the transcript is rendered as Markdown (see src/core/text),
// so the formatting block now ASKS the model for light Markdown instead of
// fighting it.

export type PromptBlock = {
  id: string;
  label: string; // short UI label
  hint: string; // one-line help under the field
  default: string;
};

// Order = order in the assembled prompt. Keep each block self-contained so
// a user can rewrite one without breaking the others.
export const PROMPT_BLOCKS: PromptBlock[] = [
  {
    id: 'role',
    label: 'Role',
    hint: 'What the model is doing and what to output.',
    default:
      'You transcribe handwritten notebook pages from an e-ink tablet. ' +
      'Output ONLY the transcription itself, with no preamble and no commentary.',
  },
  {
    id: 'fidelity',
    label: 'Fidelity',
    hint: 'How faithful, and what to do with unreadable words.',
    default:
      'Transcribe the handwriting faithfully and completely, in reading ' +
      'order, in its original language, including small insertions and ' +
      'margin notes. Never invent text; mark an illegible word with <?>.',
  },
  {
    id: 'formatting',
    label: 'Formatting (Markdown)',
    hint: 'The plugin renders Markdown, so ask for it here.',
    default:
      'Format the transcription in light Markdown. Use # and ## for headings ' +
      'the page shows as titles, - for bullet lists, 1. for numbered lists, ' +
      '> for quotes, and **bold** ONLY where the writer clearly emphasised a ' +
      'word (underline, box, colour). Render a hand-drawn table as a Markdown ' +
      'table. Reflow narrow line-wraps into flowing sentences: keep a line ' +
      'break only for a real new paragraph, list item, heading or table row.',
  },
  {
    id: 'drawings',
    label: 'Drawings & diagrams',
    hint: 'What to do with schemas and sketches.',
    default:
      'If the page contains drawings, diagrams or schemas, describe each one ' +
      'briefly in place (what it depicts, its boxes and links).',
  },
  {
    id: 'template',
    label: 'Template vs content',
    hint: 'Ignore the printed background, keep real content.',
    default:
      'Ignore the blank printed template graphics (ruled lines, grids, ' +
      'margins). But you MUST transcribe any text written or printed inside a ' +
      'box, a shaded or coloured area, a title field or a header — that is ' +
      'content (e.g. the page title), not template.',
  },
  {
    id: 'languages',
    label: 'Languages',
    hint: 'Which languages your notes mix.',
    default:
      'The notes mix French, English and German, sometimes within one ' +
      'sentence. Keep each word in the language it is actually written in.',
  },
  {
    id: 'money',
    label: 'Money & units',
    hint: 'Currency and unit conventions.',
    default:
      'Financial amounts are almost always in euros: write € for euros, k€ ' +
      'for thousands, M€ for millions. A currency mark that looks like £ or $ ' +
      'next to a number is almost always € on these pages.',
  },
  {
    id: 'glossary',
    label: 'Glossary (your vocabulary)',
    hint: 'Names, acronyms and jargon you write often — the biggest quality lever.',
    default: '',
  },
];

export const MAX_BLOCK_CHARS = 4000;

// A doc's stored overrides: blockId -> text. Absent id = use the default.
export type PromptOverrides = Record<string, string>;

const blockText = (b: PromptBlock, overrides: PromptOverrides): string => {
  const v = overrides[b.id];
  return (typeof v === 'string' ? v : b.default).trim();
};

// The exact system prompt sent to the vision model. Blocks that are empty
// (e.g. an unfilled glossary) are dropped so they add no noise.
export const assembleVisionPrompt = (overrides: PromptOverrides = {}): string =>
  PROMPT_BLOCKS.map(b => blockText(b, overrides))
    .filter(t => t.length > 0)
    .join('\n\n');

// ---- PDF escalation variant (2026-07-18, user decision) ----
// An escalated PDF page is often NOT handwriting (hard print: old scan,
// dense table, exotic font also trips the low-confidence threshold), so
// telling the model "you transcribe handwritten notebook pages from an
// e-ink tablet" is factually wrong there and biases it. The PDF prompt
// swaps role+fidelity for neutral document wording, drops the notebook
// 'template' block, and keeps the user's content blocks (formatting,
// drawings, languages, money, glossary) with their overrides.
export const PDF_ROLE_BLOCK =
  'You transcribe one page of a PDF document. The page may contain ' +
  'printed text, handwriting, tables or figures. Output ONLY the ' +
  'transcription itself, with no preamble and no commentary.';

export const PDF_FIDELITY_BLOCK =
  'Transcribe the page faithfully and completely, in reading order, in ' +
  'its original language, including margin notes and annotations. Never ' +
  'invent text; mark an illegible word with <?>.';

// v0.47 (user request 2026-07-18: "je n'ai aucun cadre .pdf only"): the
// PDF Role/Fidelity lines are EDITABLE blocks like every other one —
// "nothing is hidden" applies to the PDF variant too. Overrides live in
// the same promptBlocks map under their own ids.
export const PDF_PROMPT_BLOCKS: PromptBlock[] = [
  {
    id: 'pdfRole',
    label: 'Role',
    hint: 'What the model does on a PDF page escalated to Vision.',
    default: PDF_ROLE_BLOCK,
  },
  {
    id: 'pdfFidelity',
    label: 'Fidelity',
    hint: 'Faithfulness rules for escalated PDF pages.',
    default: PDF_FIDELITY_BLOCK,
  },
];

const PDF_SHARED_IDS = [
  'formatting',
  'drawings',
  'languages',
  'money',
  'glossary',
];

// The system prompt for a vision escalation on a PDF page.
export const assemblePdfVisionPrompt = (
  overrides: PromptOverrides = {},
): string =>
  [
    ...PDF_PROMPT_BLOCKS.map(b => blockText(b, overrides)),
    ...PROMPT_BLOCKS.filter(b => PDF_SHARED_IDS.includes(b.id)).map(b =>
      blockText(b, overrides),
    ),
  ]
    .filter(t => t.length > 0)
    .join('\n\n');

// Whether a block currently differs from its default (for a "reset" affordance).
export const isBlockCustom = (
  b: PromptBlock,
  overrides: PromptOverrides,
): boolean =>
  typeof overrides[b.id] === 'string' &&
  overrides[b.id].trim() !== b.default.trim();
