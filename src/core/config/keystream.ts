// At-rest obfuscation for the API key (v0.20.1): XOR with a PBKDF2
// keystream derived from a random device-local pepper. Pure module —
// the PBKDF2 itself runs in the native module; this only XORs and
// (de)frames the payload.
//
// Threat model, stated honestly: this protects the key against MyStyle
// cloud sync (the reason the old key FILE was a liability) and against
// casual file browsing. It does NOT resist an attacker who can read the
// plugin's private dir (adb root), since the pepper lives next to the
// ciphertext — a user PIN would fix that at the cost of the "galère"
// the user explicitly declined.

export const xorBytes = (data: Uint8Array, stream: Uint8Array): Uint8Array => {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // eslint-disable-next-line no-bitwise
    out[i] = data[i] ^ stream[i % stream.length];
  }
  return out;
};

// Framed as JSON so future fields (algo version, iterations) can evolve.
export type SecretFile = {
  v: 1;
  saltB64: string;
  dataB64: string; // XOR(keystream, utf8(secret))
};

export const parseSecretFile = (text: string | null): SecretFile | null => {
  if (text === null || text.trim().length === 0) {
    return null;
  }
  try {
    const obj = JSON.parse(text) as SecretFile;
    if (
      obj &&
      obj.v === 1 &&
      typeof obj.saltB64 === 'string' &&
      typeof obj.dataB64 === 'string'
    ) {
      return obj;
    }
  } catch {
    // fall through
  }
  return null;
};

export const PBKDF2_ITERATIONS = 10_000;
