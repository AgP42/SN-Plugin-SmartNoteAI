// Library search (v0.25; moved out of transcriptStore in v0.36 — it is a
// query engine over the store, not part of the cache state machine).
// In-memory, accent-insensitive, over every stored transcript. No SQLite —
// the store already lives in memory. The old simple searchLibrary() was a
// strict subset and folded into searchLibraryAdvanced([{type:'contains'}]).

import type {Store, TranscriptSource} from './transcriptStore';

// ---- Library search (v0.25): in-memory, accent-insensitive, over every
// stored transcript. No SQLite — the store already lives in memory. AND
// of all terms; score = total occurrences; snippet around the first hit.
const deaccentLower = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type SearchHit = {
  path: string;
  name: string;
  folder: string;
  page: number; // 0-indexed
  // Absent on a META hit (v0.37): a page matched by star:/kw: that has no
  // transcript yet — surfaced for navigation ("(not read yet)").
  source?: TranscriptSource;
  snippet: string;
  at: number; // entry timestamp (for date sort; 0 on meta hits)
  terms: string[]; // positive terms/phrases that matched (for highlighting)
};

// Advanced search: a list of criteria, each a (type, value), all ANDed.
// A "base" search is just [{type:'contains', value: query}].
export type SearchCriterionType =
  | 'contains' // page has ALL words of the value (AND within the row)
  | 'phrase' // page has the value as a contiguous phrase
  | 'any' // page has AT LEAST ONE word of the value (OR within the row)
  | 'exclude' // page has NONE of the value's words
  | 'excludePhrase' // v0.37: page does NOT contain the value as a phrase
  | 'notebook' // notebook name contains the value
  | 'folder' // folder path contains the value
  | 'source' // entry source category: 'manual' | 'ai'
  | 'doctype' // v0.37: 'note' | 'pdf' (origin of the document)
  | 'starred' // v0.37: 'yes' | 'no' — page carries a five-pointed star
  | 'keyword' // v0.37: a Supernote keyword on the page contains the value
  | 'after' // v0.37: entry read on/after this date (YYYY-MM[-DD])
  | 'before' // v0.37: entry read before this date
  | 'page' // v0.64: exact page number (value = 1-based user input)
  | 'approx'; // v0.64: fuzzy word match (edit distance 1, 2 from 6 chars)
export type SearchCriterion = {type: SearchCriterionType; value: string};
export type SearchSort = 'relevance' | 'date' | 'notebook';

export const MAX_SEARCH_CRITERIA = 10;

// Which raw sources each source-filter category covers.
const SOURCE_CATEGORY: Record<string, TranscriptSource[]> = {
  manual: ['user'],
  ai: ['medium', 'mistral-ocr', 'improved'],
};

// Bounded Levenshtein for approx: (v0.64) — early exit once the whole
// DP row exceeds `max`, so long words stay cheap.
const editDistanceAtMost = (a: string, b: string, max: number): boolean => {
  if (Math.abs(a.length - b.length) > max) {
    return false;
  }
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) {
        rowMin = v;
      }
    }
    if (rowMin > max) {
      return false;
    }
    prev = cur;
  }
  return prev[b.length] <= max;
};

const searchWords = (v: string): string[] =>
  deaccentLower(v)
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2);

const countOcc = (hay: string, needle: string): number => {
  if (needle.length === 0) {
    return 0; // indexOf('') would loop forever below — guard the invariant
  }
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
};

// Criteria that need the page TEXT — a page with no transcript can never
// match them, so meta-only hits (see below) require none to be present.
const TEXT_TYPES: SearchCriterionType[] = [
  'contains',
  'phrase',
  'any',
  'exclude',
  'excludePhrase',
  'source',
  'after',
  'before',
  // 'approx' needs the page TEXT too (full-scope audit 2026-08-12, N4): a page
  // with no transcript can never fuzzy-match a word, so its presence must
  // suppress the meta (unread-page) branch — otherwise `approx:x star:` listed
  // textless starred pages that cannot contain the word.
  'approx',
];

// 'YYYY-MM' or 'YYYY-MM-DD' → epoch ms at UTC midnight; NaN when invalid
// (an invalid date criterion matches nothing — visible, not silent).
const parseDay = (v: string): number => {
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(v.trim());
  if (m === null) {
    return NaN;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3] ?? '1');
  const t = Date.UTC(y, mo - 1, d);
  const rt = new Date(t);
  if (
    rt.getUTCFullYear() !== y ||
    rt.getUTCMonth() !== mo - 1 ||
    rt.getUTCDate() !== d
  ) {
    // Date.UTC silently rolls out-of-range parts over (2026-13 → Jan 2027,
    // 2026-06-31 → Jul 1) — the contract here is "invalid matches NOTHING,
    // visibly", not a wrong result (audit 2026-07-18). Round-trip check
    // catches every impossible date, incl. per-month day counts.
    return NaN;
  }
  return t;
};

const makeSnippet = (text: string, at: number, len: number): string => {
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + len + 60);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '…' : '')
  );
};

// Deaccented page text cached per ENTRY object (audit 2026-07-20):
// entries are replaced on write, never mutated in place, so identity is
// a safe cache key. Typing one more search letter no longer re-runs
// NFD-normalization over every stored transcript.
const lowTextCache = new WeakMap<object, string>();
const lowTextOf = (e: {text: string}): string => {
  let v = lowTextCache.get(e);
  if (v === undefined) {
    v = deaccentLower(e.text);
    lowTextCache.set(e, v);
  }
  return v;
};

// Multi-criteria search: every criterion must hold on the SAME page (AND).
// Scoring counts occurrences of the positive text criteria (contains / any
// / phrase); scope (notebook / folder / source) and exclude only filter.
// Sort by relevance (default), date, or notebook.
export const searchLibraryAdvanced = (
  store: Store,
  criteria: SearchCriterion[],
  opts?: {limit?: number; sort?: SearchSort},
): SearchHit[] => {
  const limit = opts?.limit ?? 60;
  const sort = opts?.sort ?? 'relevance';
  // Drop empty rows, cap at the max, and require at least one usable one.
  const crit = criteria
    .filter(c => c.value.trim().length > 0)
    .slice(0, MAX_SEARCH_CRITERIA);
  if (crit.length === 0) {
    return [];
  }
  // Positive terms/phrases drive scoring + highlighting (not exclude/scope).
  const highlight: string[] = [];
  for (const c of crit) {
    if (c.type === 'contains' || c.type === 'any') {
      for (const w of searchWords(c.value)) {
        if (!highlight.includes(w)) highlight.push(w);
      }
    } else if (c.type === 'phrase') {
      const p = deaccentLower(c.value).trim().replace(/\s+/g, ' ');
      if (p.length >= 2 && !highlight.includes(p)) highlight.push(p);
    }
  }
  // Perf (audit 2026-07-20): everything derivable from the QUERY alone
  // is computed once here — words lists, normalized phrases, parsed
  // numbers. The per-page loop (thousands of pages) touches only the page.
  const prep = new Map<
    SearchCriterion,
    {words?: string[]; p?: string; want?: number; day?: number; max?: number}
  >();
  for (const c of crit) {
    if (c.type === 'contains' || c.type === 'any' || c.type === 'exclude') {
      prep.set(c, {words: searchWords(c.value)});
    } else if (c.type === 'phrase' || c.type === 'excludePhrase') {
      prep.set(c, {p: deaccentLower(c.value).trim().replace(/\s+/g, ' ')});
    } else if (
      c.type === 'notebook' ||
      c.type === 'folder' ||
      c.type === 'keyword'
    ) {
      prep.set(c, {p: deaccentLower(c.value).trim()});
    } else if (c.type === 'page') {
      const v = c.value.toLowerCase();
      prep.set(
        c,
        v === 'first' || v === 'last'
          ? {p: v}
          : {want: parseInt(c.value, 10)},
      );
    } else if (c.type === 'approx') {
      const t = deaccentLower(c.value).trim();
      prep.set(c, {p: t, max: t.length >= 6 ? 2 : 1});
    } else if (c.type === 'after' || c.type === 'before') {
      prep.set(c, {day: parseDay(c.value)});
    } else {
      prep.set(c, {});
    }
  }
  const scored: Array<{hit: SearchHit; score: number}> = [];
  for (const [path, doc] of Object.entries(store.docs)) {
    const i = path.lastIndexOf('/');
    const name = i === -1 ? path : path.slice(i + 1);
    const folder = i === -1 ? '' : path.slice(0, i);
    const nameLow = deaccentLower(name);
    const folderLow = deaccentLower(folder);
    // v0.75: first / last transcribed page of THIS doc, for p:first / p:last.
    let docMinPage = -1;
    let docMaxPage = -1;
    for (const [kk, ee] of Object.entries(doc.pages)) {
      if (ee.text.trim().length === 0) {
        continue;
      }
      const n = Number(kk);
      if (docMinPage < 0 || n < docMinPage) docMinPage = n;
      if (n > docMaxPage) docMaxPage = n;
    }
    for (const [k, e] of Object.entries(doc.pages)) {
      if (e.text.trim().length === 0) {
        continue;
      }
      const low = lowTextOf(e);
      let ok = true;
      let score = 0;
      let firstPos = -1;
      const note = (pos: number): void => {
        if (pos >= 0 && (firstPos < 0 || pos < firstPos)) firstPos = pos;
      };
      for (const c of crit) {
        if (c.type === 'contains') {
          const words = prep.get(c)?.words ?? [];
          // A text criterion with no usable word (e.g. a single letter)
          // matches NOTHING — not everything (v0.36: this was the old
          // base searchLibrary's guard, kept when it folded in here).
          if (words.length === 0) {
            ok = false;
            break;
          }
          for (const w of words) {
            const n = countOcc(low, w);
            if (n === 0) {
              ok = false;
              break;
            }
            score += n;
            note(low.indexOf(w));
          }
        } else if (c.type === 'any') {
          let hit = false;
          for (const w of prep.get(c)?.words ?? []) {
            const n = countOcc(low, w);
            if (n > 0) {
              hit = true;
              score += n;
              note(low.indexOf(w));
            }
          }
          if (!hit) ok = false;
        } else if (c.type === 'phrase') {
          const p = prep.get(c)?.p ?? '';
          const n = p.length >= 2 ? countOcc(low, p) : 0;
          if (n === 0) {
            ok = false;
          } else {
            score += n;
            note(low.indexOf(p));
          }
        } else if (c.type === 'exclude') {
          if ((prep.get(c)?.words ?? []).some(w => low.includes(w))) {
            ok = false;
          }
        } else if (c.type === 'excludePhrase') {
          const p = prep.get(c)?.p ?? '';
          if (p.length >= 2 && low.includes(p)) ok = false;
        } else if (c.type === 'notebook') {
          if (!nameLow.includes(prep.get(c)?.p ?? '')) ok = false;
        } else if (c.type === 'folder') {
          if (!folderLow.includes(prep.get(c)?.p ?? '')) ok = false;
        } else if (c.type === 'source') {
          const cats = SOURCE_CATEGORY[c.value.trim().toLowerCase()];
          if (cats === undefined || !cats.includes(e.source)) ok = false;
        } else if (c.type === 'doctype') {
          const isNote = /\.note$/i.test(path);
          const v = c.value.trim().toLowerCase();
          if (v === 'note' ? !isNote : v === 'pdf' ? isNote : true) ok = false;
        } else if (c.type === 'starred') {
          const starred = doc.stars?.includes(Number(k)) === true;
          if ((c.value.trim().toLowerCase() === 'no') === starred) ok = false;
        } else if (c.type === 'keyword') {
          const v = prep.get(c)?.p ?? '';
          const hasKw =
            doc.kws?.some(
              w => w.p === Number(k) && deaccentLower(w.t).includes(v),
            ) === true;
          if (!hasKw) ok = false;
        } else if (c.type === 'page') {
          const pv = prep.get(c);
          if (pv?.p === 'first') {
            if (Number(k) !== docMinPage) ok = false;
          } else if (pv?.p === 'last') {
            if (Number(k) !== docMaxPage) ok = false;
          } else {
            // User types 1-based (p:8); pages are stored 0-indexed.
            const want = pv?.want ?? NaN;
            if (!Number.isInteger(want) || Number(k) !== want - 1) ok = false;
          }
        } else if (c.type === 'approx') {
          const target = prep.get(c)?.p ?? '';
          if (target.length < 2) {
            ok = false;
          } else {
            const max = prep.get(c)?.max ?? 1;
            let found: string | null = null;
            for (const w of low.split(/[^a-z0-9'’-]+/)) {
              if (
                w.length >= 2 &&
                editDistanceAtMost(w, target, max)
              ) {
                found = w;
                break;
              }
            }
            if (found === null) {
              ok = false;
            } else {
              // The matched word varies per page (bug→bag) and
              // `highlight` is per-QUERY — snippet position only.
              score += 1;
              note(low.indexOf(found));
            }
          }
        } else if (c.type === 'after') {
          if (!(e.at >= (prep.get(c)?.day ?? 0))) ok = false;
        } else if (c.type === 'before') {
          if (!(e.at < (prep.get(c)?.day ?? 0))) ok = false;
        }
        if (!ok) break;
      }
      if (!ok) {
        continue;
      }
      scored.push({
        score,
        hit: {
          path,
          name,
          folder,
          page: Number(k),
          source: e.source,
          snippet: makeSnippet(e.text, firstPos >= 0 ? firstPos : 0, 1),
          at: e.at,
          terms: highlight,
        },
      });
    }
    // META hits (v0.37): star:/kw: also surface pages with NO transcript
    // yet — a star or keyword exists even before the AI ever read the
    // page, and finding it is half the point. Only when no text criterion
    // is present (those can never match an unread page).
    const metaCriteria = crit.filter(
      c => c.type === 'starred' || c.type === 'keyword',
    );
    if (metaCriteria.length > 0 && !crit.some(c => TEXT_TYPES.includes(c.type))) {
      const candidates = new Set<number>([
        ...(doc.stars ?? []),
        ...(doc.kws ?? []).map(w => w.p),
      ]);
      for (const p of candidates) {
        const existing = doc.pages[String(p)];
        if (existing !== undefined && existing.text.trim().length > 0) {
          continue; // already emitted (or rejected) by the main loop
        }
        let ok = true;
        for (const c of crit) {
          if (c.type === 'starred') {
            const starred = doc.stars?.includes(p) === true;
            if ((c.value.trim().toLowerCase() === 'no') === starred) ok = false;
          } else if (c.type === 'keyword') {
            const v = prep.get(c)?.p ?? '';
            if (
              doc.kws?.some(
                w => w.p === p && deaccentLower(w.t).includes(v),
              ) !== true
            )
              ok = false;
          } else if (c.type === 'doctype') {
            const isNote = /\.note$/i.test(path);
            const v = c.value.trim().toLowerCase();
            if (v === 'note' ? !isNote : v === 'pdf' ? isNote : true) ok = false;
          } else if (c.type === 'notebook') {
            if (!nameLow.includes(prep.get(c)?.p ?? '')) ok = false;
          } else if (c.type === 'folder') {
            if (!folderLow.includes(prep.get(c)?.p ?? '')) ok = false;
          } else if (c.type === 'page') {
            // N4 (2026-08-12): the meta branch used to DROP the page constraint,
            // so `star: p:1` surfaced starred pages other than page 1. Apply the
            // NUMERIC page test on the candidate page `p` (0-indexed; the user
            // types 1-based). Regression audit: do NOT apply 'first'/'last' here
            // — docMinPage/docMaxPage are computed over TRANSCRIBED pages only,
            // so an UNREAD first/last page could never match them and `star:
            // p:first` returned empty. First/last stays unconstrained for meta
            // hits (as before the fix), which only over-includes, never hides.
            const pv = prep.get(c);
            if (pv?.p !== 'first' && pv?.p !== 'last') {
              const want = pv?.want ?? NaN;
              if (!Number.isInteger(want) || p !== want - 1) ok = false;
            }
          }
          if (!ok) break;
        }
        if (!ok) {
          continue;
        }
        const kwHere = (doc.kws ?? [])
          .filter(w => w.p === p)
          .map(w => w.t)
          .join(', ');
        scored.push({
          score: 0,
          hit: {
            path,
            name,
            folder,
            page: p,
            snippet:
              (doc.stars?.includes(p) === true ? '★ ' : '') +
              (kwHere.length > 0 ? kwHere + ' — ' : '') +
              '(not read yet)',
            at: 0,
            terms: highlight,
          },
        });
      }
    }
  }
  scored.sort((a, b) => {
    if (sort === 'date') {
      return b.hit.at - a.hit.at;
    }
    if (sort === 'notebook') {
      const c = a.hit.name.localeCompare(b.hit.name);
      return c !== 0 ? c : a.hit.page - b.hit.page;
    }
    return b.score - a.score || b.hit.at - a.hit.at;
  });
  return scored.slice(0, limit).map(s => s.hit);
};

