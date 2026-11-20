import { afterEach } from "vitest";
import { makeTempRoot, removeTempRoot } from "./temp-root.js";

export function useTempDirs(): {
  root(name: string): string;
  close(release: () => void): void;
} {
  const roots: string[] = [];
  const closers: Array<() => void> = [];

  afterEach(() => {
    const errors: unknown[] = [];
    for (const release of closers.splice(0).reverse()) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const root of roots.splice(0)) {
      try {
        removeTempRoot(root);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  });

  return {
    root(name: string) {
      const directory = makeTempRoot(name);
      roots.push(directory);
      return directory;
    },
    close(release: () => void) {
      closers.push(release);
    },
  };
}
