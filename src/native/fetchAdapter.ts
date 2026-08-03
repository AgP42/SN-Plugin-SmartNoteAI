// Adapts React Native's global fetch to the CORE's injected FetchFn.
// The shapes match (ok/status/json/text) — this just pins the type so
// the CORE never references the global.
import type {FetchFn} from '../core/model/types';

export const fetchAdapter: FetchFn = (url, init) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fetch as any)(url, init);
