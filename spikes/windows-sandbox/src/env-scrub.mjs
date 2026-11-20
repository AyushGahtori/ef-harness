const WINDOWS_ALLOW = [
  "ALLUSERSPROFILE",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "COMPUTERNAME",
  "ComSpec",
  "HOMEDRIVE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "PUBLIC",
  "SystemDrive",
  "SystemRoot",
  "USERDOMAIN",
  "USERNAME",
  "windir",
  "PATH",
];

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD|API_KEY|APIKEY)/i;

/**
 * Build an explicit environment. This never copies the source object wholesale.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} source
 * @param {{ home: string, temp: string }} redirects
 */
export function scrubEnvironment(source, redirects) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of WINDOWS_ALLOW) {
    const value = source[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (SECRET_NAME.test(key)) continue;
    env[key] = value;
  }
  env.HOME = redirects.home;
  env.USERPROFILE = redirects.home;
  env.TEMP = redirects.temp;
  env.TMP = redirects.temp;
  env.XDG_CACHE_HOME = redirects.temp;
  env.npm_config_cache = redirects.temp;
  env.HTTP_PROXY = "http://127.0.0.1:9";
  env.HTTPS_PROXY = "http://127.0.0.1:9";
  env.ALL_PROXY = "http://127.0.0.1:9";
  env.NO_PROXY = "localhost,127.0.0.1,::1";
  env.GIT_SSH_COMMAND = "cmd /c exit 1";
  for (const key of Object.keys(env)) {
    if (SECRET_NAME.test(key) || key.startsWith("AWS_") || key.startsWith("AZURE_")) {
      delete env[key];
    }
  }
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

/**
 * @param {Record<string, string>} env
 */
export function environmentPairs(env) {
  const pairs = [];
  for (const [key, value] of Object.entries(env)) {
    if (key.includes("=") || key.includes("\0") || value.includes("\0") || value.includes("\n")) {
      throw new Error(`environment entry ${key} cannot be encoded`);
    }
    pairs.push(`${key}=${value}`);
  }
  return pairs;
}
