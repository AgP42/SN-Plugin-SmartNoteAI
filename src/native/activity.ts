// Background-activity beacon (v0.67, user request: "l'utilisateur voit
// que quelque chose se passe et peut cancel"). ONE current activity —
// the pipelines are already serialized, so a single slot is honest. The
// UI banners subscribe; they show while an activity is set and vanish
// on their own when the producer clears it (or the user taps Stop).
//
// Stop semantics: requestStop() raises a flag the producers poll BETWEEN
// units of work (a note, a page) — nothing is interrupted mid-write, and
// every producer clears its activity on the way out. The flag dies with
// the activity, so a Stop never leaks into the next run.

export type Activity = {
  label: string; // short, user-facing ("Checking notes", "Rendering pages")
  done?: number;
  total?: number;
};

let current: Activity | null = null;
let stopFlag = false;
const subs = new Set<() => void>();

const notify = (): void => {
  for (const fn of subs) {
    try {
      fn();
    } catch {
      // a listener must not break a producer
    }
  }
};

export const setActivity = (a: Activity | null): void => {
  current = a;
  if (a === null) {
    stopFlag = false;
  }
  notify();
};

export const getActivity = (): Activity | null => current;

export const subscribeActivity = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

export const requestStop = (): void => {
  if (current !== null) {
    stopFlag = true;
    notify();
  }
};

export const stopRequested = (): boolean => stopFlag;
