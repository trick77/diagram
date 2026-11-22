/** The renderer's parse in flight (with what reads it), the next waiting
 * on it. One chain for the package's read (editorial.ts) and the renderer's
 * own parse and render (draw.ts): the renderer keeps a single db for every
 * timeline on the page and a single builder for every quadrant chart, so a
 * second parse landing between a parse and its read or render drew the
 * second source's picture for both. */
let chain: Promise<unknown> = Promise.resolve();

/** serial runs job after every job queued before it; a failed one does not
 * hold up the next. */
export function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job);
  chain = next.catch(() => {});
  return next;
}
