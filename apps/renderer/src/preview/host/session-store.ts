export class PartitionMemory {
  readonly cookies = new Map<string, string>();
  readonly localStorage = new Map<string, string>();
  readonly indexedDb = new Map<string, string>();
  readonly serviceWorkers: string[] = [];

  writeCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  readCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  writeLocalStorage(key: string, value: string): void {
    this.localStorage.set(key, value);
  }

  readLocalStorage(key: string): string | undefined {
    return this.localStorage.get(key);
  }

  writeIndexedDb(key: string, value: string): void {
    this.indexedDb.set(key, value);
  }

  readIndexedDb(key: string): string | undefined {
    return this.indexedDb.get(key);
  }
}
