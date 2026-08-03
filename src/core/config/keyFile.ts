// Parser for the LEGACY MyStyle/Plugins/SmartNoteAI/mistral-key.txt.
// Pure: string in, key out. Only the API key is read — the old model= /
// max_tokens= knobs stopped reaching anything in v0.20.1 (max_tokens is
// an internal default, the model lives in settings.json) and their
// validation machinery was dropped in v0.36. The file itself only
// survives as a one-time migration source (secureKey.ts).
//
// Format (one key=value per line; # comments and blank lines ignored):
//
//   key=<your Mistral API key>

export const DEFAULT_MODEL = 'mistral-small-latest';

export type ParseResult =
  | {ok: true; apiKey: string}
  | {ok: false; reason: string};

export const parseKeyFile = (text: string): ParseResult => {
  // v0.76.1 (user): accept BOTH `key=<key>` and a file that is just the bare
  // key on its own line — people paste the raw key without the prefix.
  let bare: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq !== -1) {
      const k = line.slice(0, eq).trim().toLowerCase();
      const v = line.slice(eq + 1).trim();
      if (k === 'key' && v.length > 0) {
        return {ok: true, apiKey: v};
      }
      continue; // some other key=value line — ignore
    }
    // A bare line, no '=': treat as the key if it looks like one (no spaces,
    // reasonable length). First such line wins.
    if (bare === null && !/\s/.test(line) && line.length >= 16) {
      bare = line;
    }
  }
  if (bare !== null) {
    return {ok: true, apiKey: bare};
  }
  return {
    ok: false,
    reason: 'no key found: put your Mistral API key on a line (with or without "key=")',
  };
};
