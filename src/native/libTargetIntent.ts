// Deep-link target for the Library, set by the floating MENU overlay before it
// opens the hosted config view (they are SEPARATE React roots, so the overlay
// can't set App state directly). App consumes it when it navigates to the
// Library and hands it to LibraryScreen's openTarget. (v0.85)
export type LibTarget = {doc: string; page: number | null};

let pending: LibTarget | null = null;

export const setLibTargetIntent = (t: LibTarget | null): void => {
  pending = t;
};

export const consumeLibTargetIntent = (): LibTarget | null => {
  const t = pending;
  pending = null;
  return t;
};
