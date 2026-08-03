// Capture the current lasso selection as a PNG (v0.73.5, lasso→chat).
//
// Uses the OFFICIAL one-shot method (docs.supernote.com, plugin-comm-api/
// generate-lasso-preview): generateLassoPreview writes the current lasso
// selection straight to a PNG and returns {imagePath, rect, rotateDegree}.
// No intermediate *.sticker file, no coordinate math (the firmware crops
// the exact selection), and rotateDegree lets us straighten a rotated
// selection so the vision model reads it upright. One temp PNG, deleted
// after. The chat model reads the PNG directly — no OCR.
import {NativeModules} from 'react-native';
import {PluginCommAPI, PluginManager, FileUtils} from 'sn-plugin-lib';
import {captureBridge} from './captureBridge';
import {asString, asNumber} from './capture';

const TAG = '[SmartNoteAI.lasso]';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    readFileBase64?: (p: string) => Promise<{success?: boolean; data?: string}>;
    rotatePng?: (p: string, deg: number) => Promise<{success?: boolean}>;
  };
};

const resultOf = (r: unknown): unknown =>
  r && typeof r === 'object' && 'result' in r
    ? (r as {result: unknown}).result
    : r;

export type LassoCapture = {image: string; note: string; page: number};

export const captureLassoImage = async (): Promise<LassoCapture | null> => {
  const deleteFile = async (p: string): Promise<void> => {
    try {
      await (FileUtils as {deleteFile: (p: string) => Promise<boolean>}).deleteFile(p);
    } catch {
      // best-effort
    }
  };
  let pngPath: string | null = null;
  try {
    const deps = captureBridge();
    const note = asString(await deps.getCurrentFilePath().catch(() => null));
    const page = asNumber(await deps.getCurrentPageNum().catch(() => null));
    const dir =
      (await (PluginManager as {getPluginDirPath: () => Promise<unknown>})
        .getPluginDirPath()
        .catch(() => null)) ?? '/sdcard';
    const base = typeof dir === 'string' && dir.length > 0 ? dir : '/sdcard';
    pngPath = `${base}/sp-lasso-${page ?? 0}.png`;

    const preview = resultOf(
      await (
        PluginCommAPI as {generateLassoPreview: (p: string) => Promise<unknown>}
      )
        .generateLassoPreview(pngPath)
        .catch(() => null),
    ) as {imagePath?: unknown; rotateDegree?: unknown} | null;
    if (preview === null) {
      console.log(TAG, 'generateLassoPreview returned nothing — no selection?');
      return null;
    }
    // The API may return the path it actually wrote to (default when we
    // pass ours).
    const imgPath =
      typeof preview.imagePath === 'string' && preview.imagePath.length > 0
        ? preview.imagePath
        : pngPath;
    if (imgPath !== pngPath) {
      pngPath = imgPath; // clean whatever it really wrote
    }

    // Straighten a rotated selection so the model reads it upright.
    const deg =
      typeof preview.rotateDegree === 'number' ? preview.rotateDegree : 0;
    if (deg % 360 !== 0 && SmartNoteAiOverlay?.rotatePng !== undefined) {
      await SmartNoteAiOverlay.rotatePng(imgPath, deg).catch(() => undefined);
    }

    const read = SmartNoteAiOverlay?.readFileBase64;
    const r = read ? await read(imgPath).catch(() => null) : null;
    if (r?.success === true && typeof r.data === 'string' && r.data.length > 0) {
      console.log(TAG, 'captured lasso preview for the chat');
      return {image: r.data, note: note ?? '', page: page ?? 0};
    }
    console.log(TAG, 'readFileBase64 failed on the preview');
    return null;
  } catch (e) {
    console.warn(TAG, 'capture failed', String(e));
    return null;
  } finally {
    if (pngPath !== null) {
      await deleteFile(pngPath);
    }
  }
};
