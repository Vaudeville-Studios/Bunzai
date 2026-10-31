/** Serializes short per-store lifecycle mutations; guest operations use backend commit guards. */
export function createExtensionMutationQueue() {
  let tail: Promise<void> = Promise.resolve();
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
  return { exclusive };
}
