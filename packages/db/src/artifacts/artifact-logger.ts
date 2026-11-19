export interface ArtifactLogEvent {
  readonly level: "info" | "warn" | "error";
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ArtifactLogger {
  log(event: ArtifactLogEvent): void;
}

export function consoleArtifactLogger(): ArtifactLogger {
  return {
    log(event) {
      const line = JSON.stringify(event);
      if (event.level === "info") console.info(line);
      else console.warn(line);
    },
  };
}
