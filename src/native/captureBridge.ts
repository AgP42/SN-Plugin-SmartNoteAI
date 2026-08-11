// Wires the pure capture orchestration (capture.ts) to the real
// sn-plugin-lib APIs. The only file that knows both the CaptureDeps
// shape and the SDK — kept thin and untested (device-validated).
/* eslint-disable @typescript-eslint/no-explicit-any */
import {NativeModules} from 'react-native';
import {
  PluginManager,
  PluginCommAPI,
  PluginFileAPI,
  PluginDocAPI,
  PluginNoteAPI,
  FileUtils,
} from 'sn-plugin-lib';
import type {CaptureDeps} from './capture';
import {loadStore} from './transcriptStoreIo';
import {docPageCount} from '../core/store/transcriptStore';

export const captureBridge = (): CaptureDeps => ({
  getCurrentFilePath: () => (PluginCommAPI as any).getCurrentFilePath(),
  getCurrentPageNum: () => (PluginCommAPI as any).getCurrentPageNum(),
  getPluginDirPath: () => (PluginManager as any).getPluginDirPath(),
  generateNotePng: p => (PluginFileAPI as any).generateNotePng(p),
  generateDocImage: (path, page, png, size) =>
    (PluginDocAPI as any).generateDocImage(path, page, png, size),
  getCurrentDocText: page => (PluginDocAPI as any).getCurrentDocText(page),
  getNoteTotalPageNum: notePath =>
    (PluginFileAPI as any).getNoteTotalPageNum(notePath),
  // Reliable PDF page count from the store (getNoteTotalPageNum returns 1 for
  // PDFs on-device). loadStore is the cached in-memory store — cheap.
  getDocPageCount: async path => docPageCount(await loadStore(), path),
  // (v0.86.3: openFilePath/bringPluginToFront removed — the plugin no longer
  // force-opens a doc to switch the render host. The user opens the note/PDF
  // themselves; the SYNC STATUS explains which host each type needs.)
  saveCurrentNote: () => (PluginNoteAPI as any).saveCurrentNote(),
  // v0.82 (user): PDF handwritten-annotation (.mark) reading.
  // Release audit 2026-08-12: this wired the dep UNCONDITIONALLY, so
  // getMarkPagesList's "the SDK has no ink layer at all → []" branch was
  // unreachable — PluginFileAPI.getMarkPages is a JS wrapper that always
  // exists, and on a firmware whose native side lacks it the call rejects,
  // which getMarkPagesList reads as "could not list, defer". PDF Vision
  // then deferred forever, with no message. Only wire it when the SDK
  // really carries the method.
  ...((PluginFileAPI as any).getMarkPages !== undefined
    ? {
        getMarkPages: (filePath: string) =>
          (PluginFileAPI as any).getMarkPages(filePath),
      }
    : {}),
  // ⚠ Param order verified ON DEVICE (logcat verifyParams, 2026-08-03):
  // the lib wants (notePath, page) — the docs' quick-ref table says the
  // opposite and cost a silent probe failure (v1.0.2's blank skip never
  // fired). page is 0-based (schema min: 0).
  getElementCounts: (page, filePath) =>
    (PluginFileAPI as any).getElementCounts(filePath, page),
  generateMarkThumbnails: (markPath, page, png, size) =>
    (PluginFileAPI as any).generateMarkThumbnails(markPath, page, png, size),
  compositePng: (base, overlay, out) =>
    (NativeModules.SmartNoteAiOverlay as any)?.compositePng(base, overlay, out),
  deleteFile: path => (FileUtils as any).deleteFile(path),
  fetchFn: url => (fetch as any)(url),
  logger: {
    warn: msg => console.warn('[SmartNoteAI.capture]', msg),
    log: msg => console.log('[SmartNoteAI.capture]', msg),
  },
});
