const tails = new Map<string, Promise<void>>();

/**
 * Serializes backup rotation and recovery scans for one backups directory.
 * A recovery scan holds the lock until validation finishes, so a scheduler
 * tick cannot delete the file currently being checked.
 */
export async function withRotationLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(
    () => gate,
    () => gate,
  );
  tails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}
