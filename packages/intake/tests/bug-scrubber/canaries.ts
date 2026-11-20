/** Runtime-only canaries. The source text must not contain the joined markers. */
export function canaries(): {
  readonly stripe: string;
  readonly github: string;
  readonly aws: string;
  readonly jwt: string;
  readonly postgres: string;
  readonly postgresLong: string;
  readonly cookie: string;
  readonly pem: string;
} {
  return {
    stripe: ["sk", "_live_", "CANARY_999"].join(""),
    github: ["ghp", "_", "CANARY999CANARY999"].join(""),
    aws: ["AK", "IA", "CANARYCANARYCANA"].join(""),
    jwt: ["eyJhbGci", "OiJub25lIn0", ".", "CANARYCANARY", ".", "eyJhbGciCANARY"].join(""),
    postgres: ["postgres://", "u:", "CANARY", "@h/db"].join(""),
    postgresLong: ["postgresql://", "admin:", "Sup3rS3cret!", "@db.prod.internal:5432/app"].join(""),
    cookie: ["sid=", "CANARY"].join(""),
    pem: ["-----", "BEGIN ", "PRIVATE KEY-----", "\nCANARY\n", "-----", "END ", "PRIVATE KEY-----"].join(""),
  };
}

export function assertAbsent(haystack: string, needles: readonly string[]): void {
  for (const needle of needles) {
    if (needle.length > 0 && haystack.includes(needle)) {
      throw new Error(`canary survived scrubbing (${needle.length} chars)`);
    }
  }
}
