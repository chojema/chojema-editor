/** Share foreground/background requests; a failed import can be retried. */
export function deferredModule<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= Promise.resolve().then(load).catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}
