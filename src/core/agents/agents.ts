// AI Agents (v0.55, L3 of the panel-redesign spec): an agent is a
// persona + a set of library documents + a model, chosen at the START of
// a conversation. Pure logic only — the UI lives in ChatAgentsScreen (config)
// and ChatPanel (start card); the money paths reuse reading.ts.
//
// Key design decisions (user, 2026-07-19):
// - max 4 agents (+ the standard Chat = 5 choices on the start card);
// - docs are LIVE references: a folder path includes documents created
//   under it later (resolved against the store at every use);
// - the agent's docs ride in the SYSTEM prompt, in a stable order — the
//   stable prefix is what makes Mistral's prompt cache bill follow-up
//   messages at 10%;
// - docs referenced by any agent are HARD-pinned in the transcript
//   store's LRU (historical: auto-eviction is gone — nothing evicts
//   shrink an agent's knowledge without anyone noticing).

import {
  sanitizeQuickActions,
  type QuickActionItem,
} from '../actions/quickActions';

export type Agent = {
  id: string; // stable, never reused
  name: string;
  icon: string; // an emoji, free choice
  persona: string; // system prompt ('' = the default chat system)
  model: string; // model id or -latest alias ('' = the chat's model)
  docs: string[]; // exact doc paths and/or folder paths (live)
  // v0.75: page-scoped context — specific pages of a note added from the
  // Library ("Add pages to Agent"). path -> sorted 0-indexed page numbers.
  // STATIC (unlike docs' live folder refs): a page you picked stays that
  // page. If a path is ALSO in docs (whole note), the whole wins on
  // compose (superset) — docPages is deduped away for it.
  docPages?: Record<string, number[]>;
  // v0.59 unification ("the standard CHAT is just the default agent"):
  // every per-conversation setting of the chat exists per agent too.
  // ABSENT = inherit the CHAT defaults (settings.answerStyle /
  // settings.quickActions) — so existing agents keep behaving as before
  // and "customize" is an explicit act in the config.
  answerStyle?: 'precise' | 'balanced' | 'creative';
  quickActions?: QuickActionItem[];
};

// v0.75.4: raised from 4 to 8 so the 4 starter presets leave room for the
// user's own agents.
export const MAX_AGENTS = 8;

// ---------- starter presets (v0.75.4) ----------
// Ready-made agents seeded once on a fresh install (App.load) and also
// addable on demand from the config ("+ Add preset"). They are ORDINARY
// agents: fully editable and deletable, no special status. Model choices
// come from the bench (Small = precise/factual & cheap; Ministral =
// cheap/creative for ideation where facts don't matter). English-first.
export const PRESET_AGENTS: Agent[] = [
  {
    id: 'preset-extractor',
    name: 'Extractor',
    icon: '📋',
    model: 'mistral-small-latest',
    answerStyle: 'precise',
    docs: [],
    persona:
      'You are SmartNote AI in extraction mode. Work ONLY from the notes and ' +
      'image provided. Never invent facts, figures or dates; if something is ' +
      'not in the notes, say so explicitly. Do NOT add options, alternatives, ' +
      'caveats or content that was not asked for. Preserve every item — never ' +
      'silently drop an entry. Be concise, neutral and faithful. Answer in ' +
      'Markdown (headings, bold, dash lists, tables when tabular).',
    quickActions: [
      {
        label: 'Summarize',
        prompt: 'Summarize the provided notes concisely and faithfully.',
        enabled: true,
      },
      {
        label: 'Key points & actions',
        prompt:
          'List the key points and every action item (owner + deadline if ' +
          'stated) as a bulleted list. Mark anything missing as "not specified".',
        enabled: true,
      },
      {
        label: 'To table',
        prompt:
          'Extract the structured data in the provided notes into a Markdown ' +
          'table. ' +
          'Do not invent columns or values.',
        enabled: true,
      },
      {
        label: 'Dates & deadlines',
        prompt:
          'List every date, deadline and time-bound item found, with what it ' +
          'refers to. Only what is written.',
        enabled: true,
      },
    ],
  },
  {
    id: 'preset-writer',
    name: 'Writer',
    icon: '✍️',
    model: 'mistral-small-latest',
    answerStyle: 'balanced',
    docs: [],
    persona:
      'You are SmartNote AI, a warm, human and engaging writing assistant in ' +
      'English. Use a friendly tone (a short greeting when natural) and be ' +
      'generous: when useful, offer one variant or briefly explain your ' +
      'choices. IMPERATIVE, though: (1) strictly respect any explicit format ' +
      'and length constraint in the request; (2) impeccable, academic ' +
      'English. Correctness and following the instruction always come before ' +
      'style.',
    quickActions: [
      {
        label: 'Rewrite clearly',
        prompt: 'Rewrite this in clear, simple English.',
        enabled: true,
      },
      {
        label: 'Warmer tone',
        prompt:
          'Rewrite this message in a warm, courteous tone without changing ' +
          'its substance.',
        enabled: true,
      },
      {
        label: 'Draft an email',
        prompt: 'Draft a short, polite email from these notes.',
        enabled: true,
      },
      {
        label: 'Proofread',
        prompt: 'Return only the text with spelling and grammar corrected.',
        enabled: true,
      },
    ],
  },
  {
    id: 'preset-tutor',
    name: 'Tutor',
    icon: '🎓',
    model: 'mistral-small-latest',
    answerStyle: 'balanced',
    docs: [],
    persona:
      "You are a patient, encouraging tutor working from the user's notes. " +
      "Explain clearly, adapt to the user's level, and use concrete " +
      'analogies. When quizzing, ask ONE question at a time and wait for the ' +
      'answer before the next. Keep it warm but never invent facts beyond the ' +
      'notes.',
    quickActions: [
      {
        label: 'Explain simply',
        prompt: 'Explain the provided notes in simple, clear terms.',
        enabled: true,
      },
      {
        label: 'Grill me',
        prompt:
          'Quiz me one question at a time to test my understanding of the ' +
          'provided notes.',
        enabled: true,
      },
      {
        label: 'Revision plan',
        prompt: 'Turn the provided notes into a short revision plan / checklist.',
        enabled: true,
      },
      {
        label: 'Give an example',
        prompt:
          'Give a concrete example or analogy for the main idea in the ' +
          'provided notes.',
        enabled: true,
      },
    ],
  },
  {
    id: 'preset-brainstorm',
    name: 'Brainstorm',
    icon: '💡',
    model: 'ministral-14b-2512',
    answerStyle: 'creative',
    docs: [],
    persona:
      'You are a bold, generative brainstorming partner in English. Produce ' +
      'many diverse ideas; favour range and quantity over polish. Riff, ' +
      "suggest angles the user hasn't considered, group ideas loosely. It's " +
      'fine to be playful. (No need for strict factual accuracy here — this ' +
      'is ideation.)',
    quickActions: [
      {
        label: '5 ideas',
        prompt: 'Give me 5 varied ideas based on the provided notes.',
        enabled: true,
      },
      {
        label: 'Another angle',
        prompt: 'Suggest 3 completely different angles or approaches.',
        enabled: true,
      },
      {
        label: 'What if…',
        prompt: 'Push this further with a few "what if" variations.',
        enabled: true,
      },
      {
        label: 'Titles',
        prompt: 'Propose 5 catchy titles for this.',
        enabled: true,
      },
      {
        label: "What's missing?",
        prompt:
          "What's missing, unexplored, or worth adding here? Push the thinking " +
          'further.',
        enabled: true,
      },
      {
        label: "Devil's advocate",
        prompt:
          "Play devil's advocate: challenge the ideas and assumptions in the " +
          'provided notes, poke holes, and push me to think harder.',
        enabled: true,
      },
    ],
  },
];

// ---------- "Lecteur" — the built-in Reader preset (v0.74) ----------
// A first-class brain sitting next to Chat and the user's agents on the
// start card. It is NOT stored in settings.agents (so it never counts
// toward MAX_AGENTS and never pollutes save/sanitize): it lives as a
// reserved agentId + this constant, resolved wherever an agent is looked
// up. It reads ONLY the lasso image (docs: []), and its persona is Q&A-
// first — NOT transcription-first, or the model slips into scribe mode and
// v0.81 (user): the lasso is no longer a dedicated agent — see
// DEFAULT_LASSO_DIRECTIVE below. It is a transverse MODE: an image folded
// into whatever chat/agent is active.

// The default "there is an image to read" directive, appended to the active
// brain's system prompt whenever a lasso image is in the context. Editable
// in door 2 (READ); an EMPTY directive sends nothing (the user's choice is
// never overridden). Covers instructions to execute AND content (a table, a
// diagram) the user's chat message will act on.
export const DEFAULT_LASSO_DIRECTIVE =
  'The user lassoed a region of their handwritten note and attached it as ' +
  'an image. Read it, then either carry out the instruction it contains, or ' +
  'treat it as the subject of the user’s question or request in the chat. ' +
  'It may be text, a table, a diagram or a sketch. Use web search for ' +
  'anything current (weather, news, prices, schedules). Never merely say ' +
  'you will do something and stop; do it now.';

// v0.75: page-scoped refs to gather for an agent, EXCLUDING notes already
// pulled whole via docs (a whole note is a superset of its pages). Returns
// only paths still present in the store. Sorted for a stable prompt prefix.
export const resolveAgentDocPages = (
  agent: Agent,
  storePaths: string[],
): Array<{path: string; pages: number[]}> => {
  const dp = agent.docPages;
  if (dp === undefined) {
    return [];
  }
  const wholePaths = new Set(resolveAgentDocs(agent.docs, storePaths));
  const known = new Set(storePaths);
  const out: Array<{path: string; pages: number[]}> = [];
  for (const path of Object.keys(dp).sort()) {
    if (wholePaths.has(path) || !known.has(path)) {
      continue;
    }
    out.push({path, pages: dp[path]});
  }
  return out;
};

// Default IMAGE quick action (v0.81): the image quick actions (max 3) show
// in the panel ONLY when a lasso image is in context, ahead of the normal
// ones. A fresh install ships with just this one, enabled.
export const SELECTION_QUICK_ACTION: QuickActionItem = {
  label: 'About this selection',
  prompt:
    'Focus on the lassoed selection shown in the image. Use the rest of the ' +
    'context only as background. If it is a question, answer it (use web ' +
    'search for anything current); otherwise transcribe or explain it.',
  enabled: true,
};

// The shipped default image-quick-actions list (one entry). Kept as a
// factory so callers get a fresh array, never a shared mutable ref.
export const DEFAULT_IMAGE_QUICK_ACTIONS = (): QuickActionItem[] => [
  {...SELECTION_QUICK_ACTION},
];
export const MAX_IMAGE_QUICK_ACTIONS = 3;

// Settings-file sanitizer (the file is hand-editable over USB — garbage
// must never crash the panel). Silently drops malformed entries and
// anything beyond MAX_AGENTS.
export const sanitizeAgents = (raw: unknown): Agent[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Agent[] = [];
  for (const a of raw) {
    if (
      a &&
      typeof a.id === 'string' &&
      a.id.length > 0 &&
      typeof a.name === 'string' &&
      a.name.trim().length > 0 &&
      Array.isArray(a.docs)
    ) {
      const agent: Agent = {
        id: a.id,
        name: a.name,
        icon: typeof a.icon === 'string' ? a.icon : '',
        persona: typeof a.persona === 'string' ? a.persona : '',
        model: typeof a.model === 'string' ? a.model : '',
        docs: a.docs.filter(
          (d: unknown): d is string => typeof d === 'string' && d.length > 0,
        ),
      };
      if (
        a.answerStyle === 'precise' ||
        a.answerStyle === 'balanced' ||
        a.answerStyle === 'creative'
      ) {
        agent.answerStyle = a.answerStyle;
      }
      const qa = sanitizeQuickActions(a.quickActions);
      if (qa !== undefined) {
        agent.quickActions = qa;
      }
      if (a.docPages && typeof a.docPages === 'object') {
        const dp: Record<string, number[]> = {};
        for (const [k, v] of Object.entries(a.docPages)) {
          if (typeof k === 'string' && k.length > 0 && Array.isArray(v)) {
            const pages = [
              ...new Set(
                v.filter(
                  (n: unknown): n is number =>
                    typeof n === 'number' && Number.isInteger(n) && n >= 0,
                ),
              ),
            ].sort((x, y) => x - y);
            if (pages.length > 0) {
              dp[k] = pages;
            }
          }
        }
        if (Object.keys(dp).length > 0) {
          agent.docPages = dp;
        }
      }
      out.push(agent);
      if (out.length >= MAX_AGENTS) {
        break;
      }
    }
  }
  return out;
};

// Does a doc reference (exact path OR folder path) cover `path`?
// Folder semantics are prefix-based on the '/' boundary, so
// "/Note/Work" covers "/Note/Work/a.note" but NOT "/Note/Workshop.note".
export const isUnderDocRef = (ref: string, path: string): boolean => {
  if (ref === path) {
    return true;
  }
  const folder = ref.endsWith('/') ? ref.slice(0, -1) : ref;
  return path.startsWith(folder + '/');
};

// Resolve an agent's LIVE doc refs against the store's known documents.
// Sorted — the order feeds the system prompt and must be stable for the
// prompt cache.
export const resolveAgentDocs = (
  docs: string[],
  storePaths: string[],
): string[] =>
  storePaths.filter(p => docs.some(ref => isUnderDocRef(ref, p))).sort();

// ---------- system-prompt composition ----------

export type AgentDocBlock = {
  path: string;
  name: string;
  page: number; // 0-indexed
  text: string;
};

const AGENT_DOCS_INTRO =
  'You have PERMANENT access to the following pages from the user’s own ' +
  'library. They are your working context for every answer; cite the ' +
  'note name and page when it helps.';

// The agent docs section appended to the system prompt. Deterministic:
// sorted by (path, page) whatever order the caller gathered them in —
// an identical library state must yield a byte-identical prefix.
export const composeAgentDocsSection = (blocks: AgentDocBlock[]): string => {
  const withText = blocks.filter(b => b.text.trim().length > 0);
  if (withText.length === 0) {
    return '';
  }
  const sorted = [...withText].sort((a, b) =>
    a.path === b.path ? a.page - b.page : a.path < b.path ? -1 : 1,
  );
  return (
    `\n\n${AGENT_DOCS_INTRO}` +
    sorted
      .map(
        b =>
          `\n\n--- Agent doc: "${b.name}" p.${b.page + 1} ---\n` +
          b.text.trim(),
      )
      .join('')
  );
};

// ---------- cost estimate (config screen pedagogy) ----------

// chars → tokens, the usual rough ratio for mixed FR/EN text.
export const estimateTokens = (chars: number): number => Math.round(chars / 4);

export type AgentCostEstimate = {
  tokens: number;
  // Cents (euro) for the agent-docs prefix alone; undefined when the
  // model's input price is unknown (custom id — tokens still shown).
  firstMsgCents?: number;
  nextMsgCents?: number; // cached prefix: 10% of the input price
};

export const estimateAgentCost = (
  chars: number,
  inEurPerM: number | undefined,
): AgentCostEstimate => {
  const tokens = estimateTokens(chars);
  if (inEurPerM === undefined) {
    return {tokens};
  }
  const first = (tokens / 1_000_000) * inEurPerM * 100;
  return {
    tokens,
    firstMsgCents: Math.round(first * 100) / 100,
    nextMsgCents: Math.round(first * 10) / 100,
  };
};
