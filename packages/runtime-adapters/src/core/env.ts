/**
 * OS process baseline kept so a foreign CLI can start.
 * Every other host variable is dropped. Credential and proxy variables survive
 * only when this session's authorized map names them.
 */
const BASELINE_ENV = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMDATA",
  "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "OS",
  "COMPUTERNAME",
  "USERNAME",
  "USERDOMAIN",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
]);

export function scrubChildEnvironment(
  host: Readonly<Record<string, string | undefined>>,
  authorized: Readonly<Record<string, string>>,
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(host)) {
    if (value === undefined || value.length === 0) continue;
    if (!BASELINE_ENV.has(key.toUpperCase())) continue;
    scrubbed[key] = value;
  }
  for (const [key, value] of Object.entries(authorized)) {
    if (key.trim().length === 0 || value.length === 0) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
}
