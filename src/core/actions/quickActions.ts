// One-tap actions shown in the floating panel. Each is just a preset
// user prompt sent about the captured page — pure data so the UI stays
// dumb and this list is easy to unit-test and later make user-editable.

export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

// v0.76.1 (user): the standard Chat is the GENERALIST — its three most
// universal actions. The specialised agents (Facts, Writer, Tutor,
// Brainstorm) cover key-points / explain-pedagogy / quiz / ideation. Prompts
// no longer say "this page" (context can be a page, a range, a whole note,
// added pages or a lasso image); Translate leaves the target language to
// the user.
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summary',
    label: 'Summarize',
    prompt: 'Summarize the provided notes concisely.',
  },
  {
    id: 'explain',
    label: 'Explain',
    prompt: 'Explain the provided notes in simple, clear terms.',
  },
  {
    id: 'translate',
    label: 'Translate',
    prompt: 'Translate the provided content.',
  },
];

// A user-configurable quick action (persisted in settings.json). `enabled`
// controls whether it shows in the panel; array order is display order.
export type QuickActionItem = {
  label: string;
  prompt: string;
  enabled: boolean;
};

export const MAX_QUICK_ACTIONS = 12;

// The starting set (the built-ins, all on) used when nothing is saved.
export const DEFAULT_QUICK_ACTIONS: QuickActionItem[] = QUICK_ACTIONS.map(a => ({
  label: a.label,
  prompt: a.prompt,
  enabled: true,
}));

// Validate an untrusted list (settings file, agent field). Returns the
// valid entries capped at MAX, or undefined when nothing valid — the
// shared building block of resolveQuickActions and sanitizeAgents
// (v0.59 per-agent quick actions).
export const sanitizeQuickActions = (
  raw: unknown,
): QuickActionItem[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const valid = raw.filter(
    (a: unknown): a is QuickActionItem =>
      a != null &&
      typeof (a as QuickActionItem).label === 'string' &&
      typeof (a as QuickActionItem).prompt === 'string' &&
      typeof (a as QuickActionItem).enabled === 'boolean',
  );
  // v0.88 (audit): a valid-but-EMPTY list is a deliberate "removed them
  // all": it must round-trip as [], not fall back to the defaults at the
  // next boot. But a list that HAD entries and lost them all to validation
  // is corrupt input, not a choice, so it still means "use the defaults"
  // (review 2026-08-01 #10).
  if (raw.length > 0 && valid.length === 0) {
    return undefined;
  }
  return valid.slice(0, MAX_QUICK_ACTIONS);
};

// Sanitise a saved list; fall back to the defaults when empty/invalid.
export const resolveQuickActions = (
  saved?: QuickActionItem[],
): QuickActionItem[] => sanitizeQuickActions(saved) ?? DEFAULT_QUICK_ACTIONS;
