export interface ParsedLaunchArgs {
  readonly projectPath: string | null;
  readonly deepLink: string | null;
  readonly hiddenTray: boolean;
}

export interface DeliveredLaunch extends ParsedLaunchArgs {
  readonly workingDirectory: string;
}

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  onSecondInstance(
    listener: (argv: readonly string[], workingDirectory: string) => void,
  ): void;
  exit(code: number): void;
}

export interface SingleInstanceAcquisition {
  readonly primary: boolean;
  readonly shouldExit: boolean;
  readonly forwarded: ParsedLaunchArgs | null;
}

const DEEP_LINK = /^[a-z][a-z0-9+.-]*:\/\//i;

export function parseLaunchArgs(argv: readonly string[]): ParsedLaunchArgs {
  let projectPath: string | null = null;
  let deepLink: string | null = null;
  let hiddenTray = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--hidden-tray") {
      hiddenTray = true;
      continue;
    }
    if (arg === "--project") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        projectPath = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--project=")) {
      projectPath = arg.slice("--project=".length);
      continue;
    }
    if (DEEP_LINK.test(arg)) {
      deepLink = arg;
      continue;
    }
    if (index === 0 || arg.startsWith("-")) continue;
    if (projectPath === null && (arg.includes("\\") || arg.includes("/") || arg.endsWith(".json"))) {
      projectPath = arg;
    }
  }
  return { projectPath, deepLink, hiddenTray };
}

export class SingleInstanceLock {
  private primary = false;
  private lastForward: DeliveredLaunch | null = null;

  constructor(
    private readonly app: SingleInstanceApp,
    private readonly restore: () => void,
  ) {}

  get isPrimary(): boolean {
    return this.primary;
  }

  lastForwardedLaunch(): DeliveredLaunch | null {
    return this.lastForward;
  }

  acquire(argv: readonly string[]): SingleInstanceAcquisition {
    const granted = this.app.requestSingleInstanceLock();
    this.primary = granted;
    if (!granted) {
      return { primary: false, shouldExit: true, forwarded: null };
    }
    this.app.onSecondInstance((secondArgv, workingDirectory) => {
      const parsed = parseLaunchArgs(secondArgv);
      this.lastForward = { ...parsed, workingDirectory };
      this.restore();
    });
    return { primary: true, shouldExit: false, forwarded: parseLaunchArgs(argv) };
  }
}
