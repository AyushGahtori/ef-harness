export function createAsyncBarrier(parties: number): { arrive(): Promise<void> } {
  if (parties < 2) throw new Error("a barrier needs at least two parties");
  let arrived = 0;
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrive() {
      arrived += 1;
      if (arrived >= parties) release();
      return opened;
    },
  };
}
