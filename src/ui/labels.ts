// Shared UI vocabulary (phase 4, spec §2.1): provenance labels and date
// formatters used by the config screens, the chat panel and the search
// panel. One copy — App.tsx and ChatPanel.tsx used to carry diverging
// duplicates (ChatPanel's SRC_LONG still said "(escalation)" from the
// pre-v0.38 heuristic era).

import type {TranscriptSource} from '../core/store/transcriptStore';

// Source naming (user decision 2026-07-12): Local OCR / Mistral OCR /
// Mistral OCR+Vision / Manual. 'improved' shares the OCR+Vision name
// (same engine family); SRC_LONG tells them apart.
export const SRC_LABEL: Record<TranscriptSource, string> = {
  medium: 'Mistral OCR+Vision',
  'mistral-ocr': 'Mistral OCR',
  improved: 'Mistral OCR+Vision',
  user: 'Manual',
  guide: 'Guide',
};

export const SRC_LONG: Record<TranscriptSource, string> = {
  medium: 'Mistral OCR 4 + Vision',
  'mistral-ocr': 'Mistral OCR', // PDF printed pages (OCR only)
  improved: 'Mistral OCR 4 + Vision',
  user: 'Manual (edited by you)',
  guide: 'Guide (shipped with the plugin)',
};

// "15/07" — compact day for chips.
export const fmtDay = (at: number): string => {
  const d = new Date(at);
  return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// "15/07/2026 14:03" (device feedback 2026-07-15: the time matters).
export const fmtDateTime = (at: number): string => {
  const d = new Date(at);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

// "14:03" — for the sync frame's last-check lines.
// File name without extension, for titles and transcript labels.
export const baseName = (path: string): string =>
  (path.split('/').pop() || '').replace(/\.(note|pdf|epub|mark)$/i, '');
