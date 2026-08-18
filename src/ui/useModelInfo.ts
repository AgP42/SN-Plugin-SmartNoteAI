// useModelInfo (v0.55) — live model info from GET /v1/models, shared by
// the CHAT config picker (v0.48) and the AGENTS editor. Resolved dated
// id for -latest aliases, context window, vision/tools capabilities,
// description, deprecation. NO prices there (verified 2026-07-18: the
// docs model cards are HTML-only too) — catalog notes stay static.
//
// One fetch per mount (cheap GET); offline → null and the pickers still
// work, just without the live lines.

import {useEffect, useRef, useState} from 'react';
import {MISTRAL_API} from '../core/model/http';

export type ModelInfo = {
  resolvedId?: string;
  ctx?: number;
  vision?: boolean;
  tools?: boolean;
  desc?: string;
  // Live deprecation signal (v0.49): ISO date + replacement model id.
  dep?: string;
  depRepl?: string;
};

export const useModelInfo = (
  apiKey: string | null,
): Record<string, ModelInfo> | null => {
  const [modelInfo, setModelInfo] = useState<Record<string, ModelInfo> | null>(
    null,
  );

  // v0.88 (audit): refetch when the KEY changes — a key replaced during the
  // same mount kept showing the previous account's model list forever.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (apiKey !== lastKey.current) {
      lastKey.current = apiKey;
      setModelInfo(null);
    }
    if (modelInfo !== null || apiKey === null || apiKey.length === 0) {
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${MISTRAL_API}/v1/models`, {
          headers: {Authorization: `Bearer ${apiKey}`},
        });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as {
          data?: Array<{
            id?: string;
            aliases?: string[];
            description?: string;
            max_context_length?: number;
            deprecation?: string;
            deprecation_replacement_model?: string;
            capabilities?: {vision?: boolean; function_calling?: boolean};
          }>;
        };
        const entries = data.data ?? [];
        // Only DEFINED fields enter the info object, so a later spread of
        // the dated entry never clobbers alias-entry data with undefined.
        const infoOf = (m: (typeof entries)[number]): ModelInfo => {
          const i: ModelInfo = {};
          if (typeof m.max_context_length === 'number') {
            i.ctx = m.max_context_length;
          }
          if (typeof m.capabilities?.vision === 'boolean') {
            i.vision = m.capabilities.vision;
          }
          if (typeof m.capabilities?.function_calling === 'boolean') {
            i.tools = m.capabilities.function_calling;
          }
          if (typeof m.description === 'string' && m.description.length > 0) {
            i.desc = m.description;
          }
          if (typeof m.deprecation === 'string' && m.deprecation.length > 0) {
            i.dep = m.deprecation;
          }
          if (
            typeof m.deprecation_replacement_model === 'string' &&
            m.deprecation_replacement_model.length > 0
          ) {
            i.depRepl = m.deprecation_replacement_model;
          }
          return i;
        };
        const map: Record<string, ModelInfo> = {};
        for (const m of entries) {
          if (typeof m.id === 'string') {
            map[m.id] = infoOf(m);
          }
        }
        for (const m of entries) {
          const id = m.id;
          // Only DATED ids are resolution targets: the API lists every
          // name (dated AND alias) as its own entry with cross-linked
          // aliases arrays — taking any id let "mistral-small-latest"
          // resolve to "magistral-small-latest" (device report
          // 2026-07-18), and the last entry silently won.
          if (typeof id !== 'string' || id.endsWith('-latest')) {
            continue;
          }
          for (const alias of m.aliases ?? []) {
            if (!alias.endsWith('-latest')) {
              continue;
            }
            // Family check: "mistral-small-latest" may only resolve to a
            // "mistral-small-…" id (excludes the magistral cross-links).
            const family = alias.slice(0, -'latest'.length);
            if (!id.startsWith(family)) {
              continue;
            }
            map[alias] = {...map[alias], ...map[id], resolvedId: id};
          }
        }
        setModelInfo(map);
      } catch {
        // offline — the pickers still work, just without the live lines
      }
    })();
  }, [modelInfo, apiKey]);

  return modelInfo;
};
