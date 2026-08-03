// Pure helpers to turn a user's typed message + the captured page into
// the text of a chat turn. The image itself rides separately (imageBase64
// on the ChatTurn); this only composes the TEXT part: the message plus
// the transcribed page as labelled context, so text-only reasoning and
// vision agree on what's on the page.

export const DEFAULT_SYSTEM =
  'You are SmartNote AI, an assistant for handwritten notes on an ' +
  'e-ink tablet. Be concise and useful. ' +
  'When BOTH a page image and an OCR transcription are provided, use the ' +
  'transcription as a hint to read the handwriting, but it is imperfect, ' +
  'so if it clearly conflicts with what the image shows, trust the more ' +
  'legible source and do not point out the discrepancy unless asked. Use ' +
  'the image for layout, drawings, diagrams and structure. The image also ' +
  'shows a printed background template (ruled lines, grid, margins, ' +
  'headers): IGNORE it, only the user’s handwriting and drawings matter. ' +
  'When only transcriptions are provided (e.g. several pages, each ' +
  'labelled "--- Page N (transcribed) ---"), answer from them. ' +
  'Transcripts are labelled with the note they come from; when the ' +
  'conversation spans several notes, answer about the CURRENT one unless ' +
  'asked otherwise. ' +
  'Blocks labelled "--- Added: … ---" are extra pages the user attached ' +
  'from a library search: use them as additional context. ' +
  'Answer in the user’s language.';

// v0.75.2 (user decision): the old hidden PLAIN_TEXT_RULE — which forced
// every answer to plain text, "no Markdown, no tables" — is REMOVED. The
// panel (MarkdownView) renders Markdown, and the transcription path already
// asks for it, so the chat may answer in Markdown too. Pasting into a note
// text box (plain text) is handled by the "Copy .txt" / "Insert to note"
// buttons (markdownToPlain), not by gagging the model.

// Headers must keep the '--- Page' prefix: the UI strips everything from
// that marker on when displaying the user's own bubble.
// `noteName` labels the transcript with its source note — without it, a
// conversation that outlives a note switch carries anonymous transcripts
// in history and the model can't tell the old note's pages from the new.
export const composeUserText = (
  input: string,
  pageText: string,
  noteName?: string,
): string => {
  const msg = input.trim();
  const page = pageText.trim();
  if (page.length === 0) {
    return msg;
  }
  const of = noteName && noteName.length > 0 ? ` of "${noteName}"` : '';
  return `${msg}\n\n--- Page${of} (transcribed) ---\n${page}`;
};

// "Add to context" (v0.54): pages picked from a library search ride as
// their own labelled blocks AFTER the message (and after any page
// context). Free — the text comes from the local store.
export type AddedBlock = {name: string; page: number; text: string};

export const composeAddedText = (
  base: string,
  blocks: AddedBlock[],
): string => {
  const withText = blocks.filter(b => b.text.trim().length > 0);
  if (withText.length === 0) {
    return base;
  }
  return (
    base +
    withText
      .map(
        b =>
          `\n\n--- Added: "${b.name}" p.${b.page + 1} (transcribed) ---\n` +
          b.text.trim(),
      )
      .join('')
  );
};

// Hide every appended context block from the user's own bubble (and from
// the redacted ephemeral turns saved to disk): cut at the FIRST context
// marker, whatever its kind.
const CONTEXT_MARKERS = ['\n\n--- Page', '\n\n--- Added:'];

export const stripContextBlocks = (text: string): string => {
  const cuts = CONTEXT_MARKERS.map(m => text.indexOf(m)).filter(i => i !== -1);
  return cuts.length === 0 ? text : text.slice(0, Math.min(...cuts));
};
