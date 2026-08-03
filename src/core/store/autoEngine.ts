// Per-folder / per-note Auto target (v0.32 redesign — mode-only). Each folder
// or note maps to a TARGET = {mode}; there is a single reading engine now
// (Mistral OCR 4 + automatic Vision escalation), so there is no "power" axis
// any more. A path that is not in the map inherits its nearest tracked
// ancestor folder, else the default mode (Manual).
//
//   mode: 'off'    — excluded: never sent to the AI, no transcript stored.
//                    A CHAT question on an Off page asks for one-shot consent
//                    and the read is discarded (not stored).
//         'manual' — read + stored only on demand (a Sync button, or a CHAT
//                    question about that page). DEFAULT.
//         'auto'   — transcribed in the background, kept up to date.
//
// Pure module: plain data in, plain data out — unit-tested, no RN.

export type AutoMode = 'off' | 'manual' | 'auto';
export type AutoTarget = {mode: AutoMode};

// A path with no own entry and no tracked ancestor falls back to this.
export const DEFAULT_MODE: AutoMode = 'manual';

// Chip cycle order: Off -> Manual -> Auto -> Off.
export const MODE_CYCLE: AutoMode[] = ['off', 'manual', 'auto'];

export const modeLabel = (m: AutoMode): string =>
  m === 'off' ? 'Off' : m === 'auto' ? 'Auto' : 'Manual';

export const cycleMode = (cur: AutoMode): AutoMode => {
  const i = MODE_CYCLE.indexOf(cur);
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
};

// A map key is a FOLDER (covers everything under it) unless it ends in a
// document extension.
export const isAutoFolderKey = (key: string): boolean =>
  !/\.(note|pdf)$/i.test(key);

const noTrailingSlash = (p: string): string =>
  p.endsWith('/') ? p.slice(0, -1) : p;

// Effective target for a note/PDF path: its OWN entry wins, else the NEAREST
// tracked ancestor folder, else null (meaning: use DEFAULT_MODE). Kept
// returning null (not the default) so the UI can tell own / inherited / default
// apart.
export const resolveAutoTarget = (
  map: Record<string, AutoTarget>,
  path: string,
): AutoTarget | null => {
  const own = map[path];
  if (own !== undefined) {
    return own;
  }
  let best: string | null = null;
  for (const key of Object.keys(map)) {
    if (!isAutoFolderKey(key)) {
      continue;
    }
    const dir = `${noTrailingSlash(key)}/`;
    if (path.startsWith(dir) && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best !== null ? map[best] : null;
};

// The mode actually in effect for a path (never null — falls back to default).
export const effectiveMode = (
  map: Record<string, AutoTarget>,
  path: string,
): AutoMode => resolveAutoTarget(map, path)?.mode ?? DEFAULT_MODE;

const isMode = (v: unknown): v is AutoMode =>
  v === 'off' || v === 'manual' || v === 'auto';

export const sanitizeAutoTargets = (
  v: unknown,
): Record<string, AutoTarget> => {
  const out: Record<string, AutoTarget> = {};
  if (v !== null && typeof v === 'object') {
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
      const tt = t as {mode?: unknown};
      if (typeof k === 'string' && k.length > 0 && tt != null && isMode(tt.mode)) {
        out[k] = {mode: tt.mode};
      }
    }
  }
  return out;
};
