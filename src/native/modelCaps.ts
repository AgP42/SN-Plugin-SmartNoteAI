// Live model capabilities for the chat panel (v0.50): ONE cached GET of
// /v1/models per plugin session, answering "can this model drive the
// connector tools?". The config screen has its own richer fetch; the
// panel only needs the function_calling flag to grey its one-shot
// buttons. Falls back to `undefined` (caller uses the static
// modelLacksTools list) when offline or before the fetch lands.

let capsP: Promise<Map<string, boolean>> | null = null;

const fetchCaps = async (apiKey: string): Promise<Map<string, boolean>> => {
  const map = new Map<string, boolean>();
  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      headers: {Authorization: `Bearer ${apiKey}`},
    });
    if (!res.ok) {
      return map;
    }
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        capabilities?: {function_calling?: boolean};
      }>;
    };
    for (const m of data.data ?? []) {
      if (
        typeof m.id === 'string' &&
        typeof m.capabilities?.function_calling === 'boolean'
      ) {
        map.set(m.id, m.capabilities.function_calling);
      }
    }
  } catch {
    // offline — empty map, callers fall back to the static list
  }
  return map;
};

export const modelSupportsTools = async (
  apiKey: string,
  modelId: string,
): Promise<boolean | undefined> => {
  if (capsP === null) {
    capsP = fetchCaps(apiKey);
  }
  const map = await capsP;
  if (map.size === 0) {
    capsP = null; // failed fetch: retry on the next call
    return undefined;
  }
  return map.get(modelId);
};
