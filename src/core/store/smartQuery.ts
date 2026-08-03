// Smart search grammar (v0.37, user-designed 2026-07-17): ONE field
// compiling to the advanced engine's criteria. Terms separated by spaces
// OR '+' (user choice: both accepted — quotes protect a literal + or
// space), all ANDed:
//
//   mot            page contains the word (all bare words AND together)
//   "une phrase"   contains the exact phrase
//   a|b|c          contains at least one (OR)
//   !mot !"phr"    does NOT contain the word / phrase
//   f:X folder:X   folder path contains X        (f:"Tasks and Projects")
//   n:X note:X     notebook name contains X
//   type:note|pdf  document origin
//   star: star:no  page carries a five-pointed star (bare = yes)
//   kw:X           a Supernote keyword on the page contains X
//   src:manual|ai  transcript source
//   after:2026-06  before:2026-07-15   read-date range
//   sort:date|note|relevance            result order
//
// Unknown prefixes are treated as plain words — the interpretation line
// makes the mistake visible instead of silently dropping the term.

import type {SearchCriterion, SearchSort} from './librarySearch';

export type SmartQuery = {
  criteria: SearchCriterion[];
  sort?: SearchSort;
  // Human-readable echo of how the query was understood — shown under the
  // field (no syntax highlighting on e-ink; this is what builds trust).
  interpretation: string;
};

// Split on whitespace and '+', protecting double-quoted spans.
const tokenize = (q: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of q) {
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (!inQ && (ch === ' ' || ch === '\t' || ch === '+')) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    out.push(cur);
  }
  return out;
};

const unquote = (v: string): string =>
  v.startsWith('"') && v.endsWith('"') && v.length >= 2
    ? v.slice(1, -1)
    : v.replace(/^"/, '');

const PREFIXES: Record<string, string> = {
  f: 'folder',
  folder: 'folder',
  n: 'notebook',
  nb: 'notebook',
  note: 'notebook',
  notebook: 'notebook',
  type: 'doctype',
  star: 'starred',
  starred: 'starred',
  kw: 'keyword',
  keyword: 'keyword',
  src: 'source',
  source: 'source',
  after: 'after',
  before: 'before',
  sort: 'sort',
  p: 'page',
  page: 'page',
  approx: 'approx',
  ap: 'approx',
};

export const parseSmartQuery = (q: string): SmartQuery => {
  const criteria: SearchCriterion[] = [];
  const parts: string[] = [];
  const words: string[] = [];
  let sort: SearchSort | undefined;

  for (const raw of tokenize(q)) {
    const neg = raw.startsWith('!');
    const tok = neg ? raw.slice(1) : raw;
    if (tok.length === 0) {
      continue;
    }
    // Quoted phrase (possibly negated).
    if (tok.startsWith('"')) {
      const phrase = unquote(tok).trim();
      if (phrase.length < 2) {
        continue;
      }
      criteria.push({type: neg ? 'excludePhrase' : 'phrase', value: phrase});
      parts.push(`${neg ? 'without' : 'phrase'}: "${phrase}"`);
      continue;
    }
    // prefix:value term.
    const m = /^([A-Za-z]+):(.*)$/.exec(tok);
    const kind = m !== null ? PREFIXES[m[1].toLowerCase()] : undefined;
    if (m !== null && kind !== undefined && !neg) {
      const value = unquote(m[2]).trim();
      if (kind === 'sort') {
        const v = value.toLowerCase();
        sort =
          v === 'date'
            ? 'date'
            : v === 'note' || v === 'notebook'
            ? 'notebook'
            : 'relevance';
        parts.push(`sort: ${sort}`);
      } else if (kind === 'starred') {
        const v = value.toLowerCase() === 'no' ? 'no' : 'yes';
        criteria.push({type: 'starred', value: v});
        parts.push(v === 'yes' ? '★ starred' : 'not starred');
      } else if (kind === 'doctype') {
        const v = value.toLowerCase();
        if (v === 'note' || v === 'pdf') {
          criteria.push({type: 'doctype', value: v});
          parts.push(`type = ${v}`);
        } else {
          parts.push(`type:? (use type:note or type:pdf)`);
        }
      } else if (kind === 'source') {
        const v = value.toLowerCase();
        if (v === 'manual' || v === 'ai') {
          criteria.push({type: 'source', value: v});
          parts.push(`source = ${v}`);
        } else {
          parts.push(`src:? (use src:manual or src:ai)`);
        }
      } else if (kind === 'page') {
        // v0.75: p:first / p:last grab the doc's first / last transcribed
        // page (resolved per-doc in librarySearch); p:N stays 1-based.
        const low = value.toLowerCase();
        if (low === 'first' || low === 'last') {
          criteria.push({type: 'page', value: low});
          parts.push(`page = ${low}`);
        } else {
          const n = parseInt(value, 10);
          if (Number.isInteger(n) && n >= 1) {
            criteria.push({type: 'page', value: String(n)});
            parts.push(`page = ${n}`);
          } else {
            parts.push('p:? (use p:8, p:first, p:last)');
          }
        }
      } else if (value.length === 0) {
        parts.push(`${m[1]}: (empty, ignored)`);
      } else {
        criteria.push({type: kind as SearchCriterion['type'], value});
        parts.push(
          kind === 'folder'
            ? `folder ~ ${value}`
            : kind === 'notebook'
            ? `notebook ~ ${value}`
            : kind === 'keyword'
            ? `kw ~ ${value}`
            : kind === 'approx'
            ? `≈ ${value} (fuzzy)`
            : `read ${kind} ${value}`,
        );
      }
      continue;
    }
    // OR alternation.
    if (tok.includes('|') && !neg) {
      const alts = tok.split('|').filter(w => w.trim().length > 0);
      if (alts.length >= 2) {
        criteria.push({type: 'any', value: alts.join(' ')});
        parts.push(`any of: ${alts.join(' | ')}`);
        continue;
      }
    }
    // Bare (or negated) word — unknown prefixes land here on purpose.
    if (neg) {
      criteria.push({type: 'exclude', value: tok});
      parts.push(`without: ${tok}`);
    } else {
      words.push(tok);
    }
  }

  if (words.length > 0) {
    criteria.push({type: 'contains', value: words.join(' ')});
    parts.unshift(`all of: ${words.join(' ')}`);
  }

  return {criteria, sort, interpretation: parts.join(' · ')};
};
