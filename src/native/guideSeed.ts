// Embedded User Guide (v0.60): the PDF ships as an APK asset, gets
// copied to Document/SmartNote AI/ on the device, and its transcript is
// seeded into the store (source 'guide') — so LIBRARY browsing, search,
// export and chat work on it OUT OF THE BOX, before any API key. The
// seeded docHash matches what a Sync would compute for the installed
// file (readPdf compares String(byteLength)), so the guide never counts
// as "to sync" and is never billed.
//
// ensureUserGuide is IDEMPOTENT and cheap when everything is in place —
// App.load fires it on every config open. It re-seeds after every path
// that loses the transcript: first install, contentV fresh start, a
// "Clear all", a corrupt shard. It re-copies the PDF if the user
// deleted it (the Home button offers exactly that).

import {NativeModules} from 'react-native';
import {FileUtils} from 'sn-plugin-lib';
import guidePages from '../core/guide/guidePages.json';
import {loadStore, mutateStore, flushStore} from './transcriptStoreIo';
import {CONFIG_DIR, readTextFileUtf8, writeTextAtomic} from './fs';
import {
  upsertPage,
  makePageEntry,
  setDocHash,
  getStamp,
  setStamp,
  removePages,
} from '../core/store/transcriptStore';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    copyAssetToFile?: (
      assetName: string,
      destPath: string,
    ) => Promise<{success?: boolean; code?: string}>;
  };
};

export const GUIDE_ASSET = 'SmartNoteAI-UserGuide.pdf';
export const GUIDE_DIR = '/storage/emulated/0/Document/SmartNote AI';
export const GUIDE_PDF_PATH = `${GUIDE_DIR}/SmartNote AI - User Guide.pdf`;

// Content revision (v0.63): bump it whenever guidePages.json / the PDF
// asset change (tools/make_guide_pdf.py regenerates the asset). An
// installed guide whose stamp differs is REPLACED — file and transcript
// (yes, including a user-edited copy: it is our document, and stale
// instructions are worse than a lost annotation).
const GUIDE_REV = 18;
const GUIDE_STAMP = `guide-rev:${GUIDE_REV}`;

type GuidePage = {title: string; body: string};

const pageText = (p: GuidePage): string => `# ${p.title}\n\n${p.body}`;

export const ensureUserGuide = async (): Promise<void> => {
  // 0. Up to date? (doc present AND stamped with the current rev)
  const store = await loadStore();
  const hasDoc = store.docs[GUIDE_PDF_PATH] !== undefined;
  const upToDate = hasDoc && getStamp(store, GUIDE_PDF_PATH) === GUIDE_STAMP;
  // Pre-reinstall audit #4: the staleness signal lived in the STORE, so a
  // reinstall (empty store) kept an outdated PDF forever — copyAssetToFile
  // no-ops on EXISTS. A marker FILE tracks the installed PDF's rev
  // independently of the store.
  const markerPath = `${CONFIG_DIR}/guide.rev`;
  const marker = await readTextFileUtf8(markerPath).catch(() => null);
  const pdfStale = marker !== GUIDE_STAMP;
  if ((hasDoc && !upToDate) || pdfStale) {
    // Outdated content rev: drop the old PDF so the asset copy below
    // actually replaces it (copyAssetToFile is a no-op on EXISTS).
    try {
      await (
        FileUtils as {deleteFile: (p: string) => Promise<boolean>}
      ).deleteFile(GUIDE_PDF_PATH);
    } catch {
      // best-effort; the copy below reports the real failure
    }
  }
  // 1. The PDF file (no-op when already there — code EXISTS).
  const r = await SmartNoteAiOverlay?.copyAssetToFile?.(
    GUIDE_ASSET,
    GUIDE_PDF_PATH,
  );
  if (!r?.success) {
    // No PDF on disk → no seed either: a transcript whose document does
    // not exist would be a phantom row in the library.
    console.warn(
      '[SmartNoteAI.guide]',
      `guide PDF install failed (${r?.code ?? 'no native method'})`,
    );
    return;
  }
  if (pdfStale) {
    await writeTextAtomic(markerPath, GUIDE_STAMP).catch(() => {});
  }
  // 2. The transcript seed — skip only when already at the current rev.
  if (upToDate) {
    return;
  }
  // docHash = byte length OF THE INSTALLED FILE, computed the same way
  // the Sync paths compute it — never a constant baked at build time.
  let byteLen = 0;
  try {
    const res = await fetch(`file://${GUIDE_PDF_PATH}`);
    if (res.ok) {
      byteLen = (await res.arrayBuffer()).byteLength;
    }
  } catch {
    // fall through
  }
  if (byteLen === 0) {
    console.warn('[SmartNoteAI.guide]', 'installed guide PDF unreadable — seed skipped');
    return;
  }
  const now = Date.now();
  await mutateStore(s => {
    // A previous rev may have had a different page count — clear it
    // before the fresh seed (removing every page drops the doc).
    removePages(
      s,
      GUIDE_PDF_PATH,
      Array.from({length: 200}, (_, i) => i),
    );
    (guidePages as GuidePage[]).forEach((p, i) => {
      // PDF pages carry hash '' (like every PDF page entry).
      upsertPage(s, GUIDE_PDF_PATH, i, makePageEntry(pageText(p), 'guide', {hash: ''}, now), now);
    });
    setDocHash(s, GUIDE_PDF_PATH, String(byteLen)); // pdfCovered → never "to sync"
    setStamp(s, GUIDE_PDF_PATH, GUIDE_STAMP);
  });
  await flushStore(); // shipped data must survive an immediate close
  console.log(
    '[SmartNoteAI.guide]',
    `seeded ${guidePages.length} guide page(s) (rev ${GUIDE_REV}, docHash ${byteLen})`,
  );
};

// Home button: make sure everything is in place, then OPEN THE GUIDE.
// v0.89.3 (device report): FileUtils.openFilePath only browsed to the file
// in the document list, it never opened it. The same ACTION_VIEW intent the
// Library uses for "Go to this page" opens the PDF itself, so we go through
// that first and keep openFilePath as the fallback.
export const openUserGuide = async (): Promise<boolean> => {
  await ensureUserGuide().catch(() => {});
  const ov = (NativeModules as {SmartNoteAiOverlay?: {
    openNoteAt?: (p: string, page: number) => Promise<{success?: boolean}>;
  }}).SmartNoteAiOverlay;
  try {
    const r = await ov?.openNoteAt?.(GUIDE_PDF_PATH, 1);
    if (r !== undefined && (r as {success?: boolean}).success !== false) {
      return true;
    }
  } catch {
    // fall through to the file-manager route
  }
  try {
    const ok = await (
      FileUtils as {openFilePath?: (p: string) => Promise<boolean>}
    ).openFilePath?.(GUIDE_PDF_PATH);
    return ok === true;
  } catch {
    return false;
  }
};
