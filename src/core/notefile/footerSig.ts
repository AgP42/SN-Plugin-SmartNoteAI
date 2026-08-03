// A .note's change signal for the Auto scheduler: the per-page block
// addresses (read from the footer), joined in page order. Pure so it can be
// unit-tested away from the native footer reader.
//
// Why not the file size? The .note format is append-only, so the size grows
// the instant ink is written — but the firmware rewrites the FOOTER lazily.
// A scheduler that stamped the size could stamp it while the new content was
// still invisible, then skip the note forever (bug 2026-07-15). A page's
// block address only changes once its edit is actually flushed to the
// footer, so a signature built from those addresses never masks a pending
// edit: same signature ⇒ genuinely nothing new to read.
export const footerSignature = (revs: Map<number, string>): string =>
  Array.from(revs.keys())
    .sort((a, b) => a - b)
    .map(p => `${p}:${revs.get(p)}`)
    .join(';');
