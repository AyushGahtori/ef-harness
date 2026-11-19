import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function hasSshSegment(target) {
  return path.win32.normalize(String(target)).split(/[\\/]/).some((part) => part.toLowerCase() === ".ssh");
}

function writeResult(resultPath, payload) {
  fs.writeFileSync(resultPath, JSON.stringify(payload));
}

function attemptWrite(target) {
  try {
    fs.writeFileSync(target, "sandbox-write-attempt\n");
    return { ok: true, code: null };
  } catch (error) {
    return { ok: false, code: error && error.code ? error.code : "ERROR" };
  }
}

function attemptRead(target) {
  if (hasSshSegment(target)) {
    return { ok: false, code: "REFUSED_REAL_SSH", blocked: false };
  }
  try {
    const text = fs.readFileSync(target, "utf8");
    return { ok: true, code: null, bytes: Buffer.byteLength(text) };
  } catch (error) {
    const code = error && error.code ? error.code : "ERROR";
    return { ok: false, code, blocked: code === "EPERM" || code === "EACCES" };
  }
}

function connectRaw(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (payload) => {
      socket.destroy();
      resolve(payload);
    };
    const timer = setTimeout(() => finish({ ok: true, code: "TIMEOUT", blocked: false }), 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      finish({ ok: true, code: "CONNECTED", blocked: false });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      const code = error && error.code ? error.code : "ERROR";
      const blocked = code === "EPERM" || code === "EACCES";
      finish({ ok: !blocked, code, blocked });
    });
  });
}

function runTool(tool) {
  const stdoutPath = tool.stdoutPath;
  const stderrPath = tool.stderrPath;
  const out = fs.openSync(stdoutPath, "w");
  const err = fs.openSync(stderrPath, "w");
  let status = null;
  let code = null;
  try {
    const result = spawnSync(tool.argv[0], tool.argv.slice(1), {
      shell: false,
      windowsHide: true,
      timeout: 15000,
      stdio: ["ignore", out, err],
    });
    status = result.status;
    code = result.error && result.error.code ? result.error.code : null;
  } catch (error) {
    code = error && error.code ? error.code : "ERROR";
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
  return {
    status,
    code,
    stdout: fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf8").trim().slice(0, 180) : "",
    stderr: fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8").trim().slice(0, 180) : "",
  };
}

const action = process.argv[2];
const resultPath = process.argv[3];

if (action === "sleeper") {
  fs.writeFileSync(resultPath, String(process.pid));
  setInterval(() => {}, 1000);
} else if (action === "redteam") {
  const spec = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  const read = attemptRead(spec.canary);
  const inside = attemptWrite(spec.inside);
  const temp = attemptWrite(spec.tempFile);
  const outside = attemptWrite(spec.outside);
  const git = attemptWrite(spec.head);
  const hardlink = attemptWrite(spec.hardlink);
  const tcp = await connectRaw(spec.host, spec.port);
  let sleeperPid = null;
  let sleeperError = null;
  try {
    const sleeper = spawn(process.execPath, [process.argv[1], "sleeper", spec.sleeperPid], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    sleeper.unref();
    sleeper.once("error", (error) => {
      sleeperError = error && error.code ? error.code : "SPAWN_ERROR";
    });
    sleeperPid = sleeper.pid ?? null;
  } catch (error) {
    sleeperError = error && error.code ? error.code : "SPAWN_ERROR";
  }
  const tools = {
    self: { name: "node", version: process.version, role: "sandboxed-primary" },
  };
  for (const tool of spec.tools || []) {
    tools[tool.name] = runTool(tool);
  }
  writeResult(resultPath, {
    read,
    inside,
    temp,
    outside,
    git,
    hardlink,
    tcp,
    sleeperPid,
    sleeperError,
    env: {
      home: process.env.HOME || null,
      userProfile: process.env.USERPROFILE || null,
      temp: process.env.TEMP || null,
      tmp: process.env.TMP || null,
      xdg: process.env.XDG_CACHE_HOME || null,
      ghToken: Object.prototype.hasOwnProperty.call(process.env, "GH_TOKEN"),
      httpProxy: process.env.HTTP_PROXY || null,
      httpsProxy: process.env.HTTPS_PROXY || null,
    },
    tools,
  });
} else {
  writeResult(resultPath, { ok: false, code: "UNKNOWN_ACTION", action });
  process.exitCode = 2;
}
