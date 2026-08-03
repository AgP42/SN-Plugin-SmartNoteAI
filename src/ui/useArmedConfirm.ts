// One-tap-confirm (phase 4, spec §2.1): destructive/overwriting actions on
// e-ink use tap-to-arm then tap-to-execute (no long-press). This hook
// replaces the four hand-rolled copies (App armThen/confirmClear,
// ChatPanel guardOverwrite/confirmDelId, key delete).
//
// Full review 2026-08-02 #10: the auto-disarm used to BE the safety — a
// plain setTimeout cleared the armed state. RN freezes plain timers in the
// floating-overlay state, so the armed state survived for minutes and a
// stray later tap executed the destructive action. The timer is now only
// cosmetic (it refreshes the UI); the SAFETY is the deadline check at tap
// time: a second tap past the window re-arms instead of executing.

import {useCallback, useRef, useState} from 'react';

export const useArmedConfirm = (
  timeoutMs = 4000,
): {
  armed: string | null;
  // First tap on `key` arms it (returns false); a second tap within the
  // window disarms, runs `run` (if given) and returns true.
  confirm: (key: string, run?: () => void) => boolean;
  disarm: () => void;
} => {
  const [armed, setArmed] = useState<string | null>(null);
  const armedAtRef = useRef(0);
  const confirm = useCallback(
    (key: string, run?: () => void): boolean => {
      const fresh =
        armed === key && Date.now() - armedAtRef.current <= timeoutMs;
      if (!fresh) {
        setArmed(key);
        armedAtRef.current = Date.now();
        // Cosmetic only: un-highlight when the window lapses. If frozen,
        // the deadline check above still refuses a stale second tap.
        setTimeout(() => setArmed(a => (a === key ? null : a)), timeoutMs);
        return false;
      }
      setArmed(null);
      run?.();
      return true;
    },
    [armed, timeoutMs],
  );
  const disarm = useCallback(() => setArmed(null), []);
  return {armed, confirm, disarm};
};
