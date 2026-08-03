// One serialized write queue per store file: concurrent updaters each
// run in turn against the freshest state, so no writer can drop
// another's change. Shared by settings and the conversation index
// (identical promise-chain serializers lived in both — audit 2026-07-20).
export const makeWriteQueue = (): (<T>(fn: () => Promise<T>) => Promise<T>) => {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
};
