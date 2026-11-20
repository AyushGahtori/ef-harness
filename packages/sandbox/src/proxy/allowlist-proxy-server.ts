import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import { ProxyAuditLog } from "./audit-log.js";
import { canonicalIp, everyAddressPermitted } from "./ip-policy.js";
import {
  DEFAULT_ATTEMPT_LIMITS,
  RESEARCHER_DOCUMENTATION_HOSTS,
  evaluateProfileAccess,
  normalizeHostname,
  vendorOwnsHost,
  type ProfileAccessRequest,
} from "./profiles.js";
import { resolveHostDefault } from "./resolve-host.js";
import { CanaryVaultSecretRedactor, redactSensitiveHeader } from "./secret-scan.js";
import {
  BIND_HOST,
  HEADER_READ_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  PORT_LEASE_MAX,
  PORT_LEASE_MIN,
  type AllowlistProxyServerOptions,
  type AllowedTestEndpoint,
  type AttemptFenceReason,
  type AttemptRegistration,
  type AttemptResourceLimits,
  type HostResolver,
  type NetworkAuditEvent,
  type NetworkPolicyProfile,
  type PortLease,
  type ProxyDiagnosticsSnapshot,
  type ProxyTokenHandle,
  type ResolvedAddress,
  type SecretRedactor,
  type StructuredLogger,
  type WrappedVendorId,
} from "./types.js";
export class ProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyConfigError";
  }
}

interface AttemptState {
  attemptId: string;
  profile: NetworkPolicyProfile;
  tokenDigest: string;
  vendor?: WrappedVendorId;
  allowedTestEndpoints: readonly AllowedTestEndpoint[];
  documentationHosts: readonly string[];
  corporateRegistries: readonly string[];
  limits: AttemptResourceLimits;
  revoked: boolean;
}

interface HttpTarget {
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
  pathname: string;
  search: string;
  href: string;
}

interface AuditSeed {
  method: string;
  host: string;
  port: number;
  query: string;
  authorization: string;
  attemptId: string;
  profile: NetworkPolicyProfile | "unknown";
  bytesIn: number;
  bytesOut: number;
  closed: boolean;
}

interface PinSuccess {
  ok: true;
  address: string;
  family: 4 | 6;
}

interface PinFailure {
  ok: false;
  reason: string;
}

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "host",
]);

const PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  403: "Forbidden",
  405: "Method Not Allowed",
  407: "Proxy Authentication Required",
  429: "Too Many Requests",
  502: "Bad Gateway",
};

const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class AllowlistProxyServer {
  readonly auditLog = new ProxyAuditLog();
  readonly bindHost = BIND_HOST;
  readonly headerReadTimeoutMs: number;
  readonly maxHeaderBytes: number;

  private readonly server: http.Server;
  private readonly lease: PortLease;
  private readonly logger: StructuredLogger;
  private readonly redactor: SecretRedactor;
  private readonly resolveHost: HostResolver;
  private readonly now: () => number;
  private readonly testOnlyPrivateIps: readonly string[];
  private readonly rejectUnauthorized: boolean;
  private readonly baseDocumentationHosts: readonly string[];
  private readonly byToken = new Map<string, AttemptState>();
  private readonly byAttempt = new Map<string, AttemptState>();
  private readonly revokedDigests = new Map<string, AttemptState>();
  private readonly sockets = new Map<string, Set<net.Socket>>();
  private readonly inflight = new Map<string, number>();
  private started = false;
  private stopped = false;

  constructor(options: AllowlistProxyServerOptions) {
    this.lease = validateLease(options.portLease, options.now ?? Date.now);
    this.now = options.now ?? Date.now;
    this.headerReadTimeoutMs = positiveAtMost(
      options.headerReadTimeoutMs,
      HEADER_READ_TIMEOUT_MS,
      "headerReadTimeoutMs",
    );
    this.maxHeaderBytes = positiveAtMost(
      options.maxHeaderBytes,
      MAX_HEADER_BYTES,
      "maxHeaderBytes",
    );
    this.rejectUnauthorized = options.rejectUnauthorized ?? true;
    this.testOnlyPrivateIps = (options.testOnlyPrivateIpAllowlist ?? []).map((entry) => {
      const canonical = canonicalIp(entry);
      if (!canonical)
        throw new ProxyConfigError("test-only private IP allowlist contains an unreadable address");
      return canonical;
    });
    if (process.env.NODE_ENV === "production" && this.testOnlyPrivateIps.length > 0) {
      throw new ProxyConfigError("test-only private IP allowlist is disabled in production");
    }
    if (process.env.NODE_ENV === "production" && this.rejectUnauthorized === false) {
      throw new ProxyConfigError("TLS certificate checks cannot be disabled in production");
    }
    this.logger = options.logger ?? noopLogger;
    this.redactor = options.redactor ?? new CanaryVaultSecretRedactor();
    this.resolveHost = options.resolveHost ?? resolveHostDefault;
    this.baseDocumentationHosts = uniqueHosts([
      ...RESEARCHER_DOCUMENTATION_HOSTS,
      ...(options.researcherDocumentationHosts ?? []),
    ]);
    this.server = http.createServer({ maxHeaderSize: this.maxHeaderBytes });
    this.server.headersTimeout = this.headerReadTimeoutMs;
    this.server.requestTimeout = 0;
    this.server.timeout = 0;
    this.server.keepAliveTimeout = 1_000;
    this.server.on("connection", (socket) => {
      guardSocket(socket);
      socket.setTimeout(this.headerReadTimeoutMs);
      socket.on("timeout", () => socket.destroy());
    });
    this.server.on("request", (req, res) => {
      req.socket?.setTimeout(0);
      void this.handleRequest(req, res);
    });
    this.server.on("connect", (req, socket, head) => {
      if (socket instanceof net.Socket) socket.setTimeout(0);
      void this.handleConnect(
        req,
        socket instanceof net.Socket ? socket : (socket as net.Socket),
        head,
      );
    });
    this.server.on("clientError", (error, socket) => {
      if (socket instanceof net.Socket) this.handleClientError(error, socket);
      else socket.destroy();
    });
    this.server.on("error", (error) => {
      this.logger.error("proxy_server_error", { message: this.redactor.redact(error.message) });
    });
  }

  get port(): number {
    const address = this.server.address();
    if (address && typeof address !== "string") return address.port;
    return this.lease.port;
  }

  get listeningAddress(): string {
    const address = this.server.address();
    if (!address || typeof address === "string") return "";
    return address.address;
  }

  get secretRedactor(): SecretRedactor {
    return this.redactor;
  }

  get deniedCount(): number {
    return this.auditLog.deniedCount;
  }

  diagnosticsHealth(): ProxyDiagnosticsSnapshot {
    return this.auditLog.diagnosticsHealth();
  }

  async start(): Promise<void> {
    if (this.started) throw new ProxyConfigError("AllowlistProxyServer is already listening");
    validateLease(this.lease, this.now);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListen);
        reject(error);
      };
      const onListen = (): void => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListen);
      this.server.listen(this.lease.port, BIND_HOST);
    });
    const address = this.server.address();
    if (!address || typeof address === "string" || address.address !== BIND_HOST) {
      await this.stop();
      throw new ProxyConfigError("AllowlistProxyServer must bind 127.0.0.1");
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const attemptId of [...this.byAttempt.keys()]) this.fenceAttempt(attemptId, "completed");
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) socket.destroy();
    }
    this.sockets.clear();
    if (typeof this.server.closeAllConnections === "function") this.server.closeAllConnections();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  registerAttempt(input: AttemptRegistration): ProxyTokenHandle {
    const attemptId = input.attemptId.trim();
    if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new ProxyConfigError("attemptId is invalid");
    if (!isProfile(input.profile)) throw new ProxyConfigError("network profile is invalid");
    if (input.profile === "wrapped_vendor" && !input.vendor) {
      throw new ProxyConfigError("wrapped_vendor requires a vendor binding");
    }
    if (input.vendor && !isVendor(input.vendor)) throw new ProxyConfigError("vendor is invalid");
    const existing = this.byAttempt.get(attemptId);
    if (existing && !existing.revoked) throw new ProxyConfigError("attempt is already registered");
    const token = randomBytes(32).toString("base64url");
    const state: AttemptState = {
      attemptId,
      profile: input.profile,
      tokenDigest: digestToken(token),
      allowedTestEndpoints: normalizeEndpoints(input.allowedTestEndpoints ?? []),
      documentationHosts: uniqueHosts([
        ...this.baseDocumentationHosts,
        ...(input.documentationHosts ?? []),
      ]),
      corporateRegistries: uniqueHosts(input.corporateRegistries ?? []),
      limits: mergeLimits(DEFAULT_ATTEMPT_LIMITS[input.profile], input.limits),
      revoked: false,
    };
    if (input.vendor) state.vendor = input.vendor;
    this.byAttempt.set(attemptId, state);
    this.byToken.set(state.tokenDigest, state);
    this.loggerFor(attemptId).info("attempt_registered", {
      attemptId,
      profile: input.profile,
    });
    return {
      attemptId,
      profile: input.profile,
      token,
      proxyAuthorization: `Bearer ${token}`,
    };
  }

  fenceAttempt(attemptId: string, reason: AttemptFenceReason = "fenced"): void {
    const state = this.byAttempt.get(attemptId);
    if (!state) {
      this.destroySockets(attemptId);
      return;
    }
    state.revoked = true;
    this.byToken.delete(state.tokenDigest);
    this.revokedDigests.set(state.tokenDigest, state);
    this.destroySockets(attemptId);
    this.loggerFor(attemptId).warn("attempt_fenced", {
      attemptId,
      profile: state.profile,
      reason,
    });
  }

  revokeAttempt(attemptId: string, reason: AttemptFenceReason = "fenced"): void {
    this.fenceAttempt(attemptId, reason);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = parseAbsoluteUrl(req.url);
    const seed = this.seed(req.method ?? "GET", target, headerString(req.headers, "authorization"));
    req.pause();
    req.on("data", (chunk: Buffer) => {
      seed.bytesIn += chunk.length;
    });
    req.on("error", () => {
      req.destroy();
    });
    res.on("error", () => {
      res.destroy();
    });
    try {
      const auth = this.authenticate(req.headers);
      if (!auth.ok) {
        seed.attemptId = auth.attemptId;
        seed.profile = auth.profile;
        this.finish(seed, "deny", auth.reason);
        sendStatus(res, 407);
        req.resume();
        return;
      }
      seed.attemptId = auth.state.attemptId;
      seed.profile = auth.state.profile;
      if (this.leaseExpired() || this.stopped) {
        this.finish(seed, "deny", "lease_expired");
        sendStatus(res, 403);
        req.resume();
        return;
      }
      if (!target) {
        this.finish(seed, "deny", "malformed_target");
        sendStatus(res, 400);
        req.resume();
        return;
      }
      const decision = evaluateProfileAccess(
        this.accessRequest(auth.state, target, req.method ?? "GET", false),
      );
      if (!decision.allow) {
        this.finish(seed, "deny", decision.reason);
        sendStatus(res, decision.status);
        req.resume();
        return;
      }
      if (this.containsOutboundSecret(target.href, req.headers, auth.state, target.hostname)) {
        this.finish(seed, "deny", "secret_exfiltration");
        sendStatus(res, 403);
        req.resume();
        return;
      }
      if (!this.acquire(auth.state)) {
        this.finish(seed, "deny", "concurrency_limit");
        sendStatus(res, 429);
        req.resume();
        return;
      }
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        this.release(auth.state.attemptId);
      };
      try {
        if (auth.state.revoked) {
          release();
          this.finish(seed, "deny", "attempt_revoked");
          sendStatus(res, 407);
          req.resume();
          return;
        }
        const pinned = await this.pin(target.hostname);
        if (auth.state.revoked) {
          release();
          this.finish(seed, "deny", "attempt_revoked");
          sendStatus(res, 407);
          req.resume();
          return;
        }
        if (!pinned.ok) {
          release();
          this.finish(seed, "deny", pinned.reason);
          sendStatus(res, 403);
          req.resume();
          return;
        }
        await this.forwardHttp(req, res, target, pinned, auth.state, seed, release);
      } catch (error) {
        release();
        this.finish(seed, "deny", "upstream_failed");
        sendStatus(res, 502);
        req.resume();
        this.loggerFor(auth.state.attemptId).error("upstream_failed", {
          message: this.redactor.redact(error instanceof Error ? error.message : "upstream failed"),
        });
      }
    } catch (error) {
      this.finish(seed, "deny", "internal_error");
      sendStatus(res, 502);
      req.resume();
      this.logger.error("proxy_request_error", {
        message: this.redactor.redact(error instanceof Error ? error.message : "request failed"),
      });
    }
  }

  private async handleConnect(
    req: IncomingMessage,
    socket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    guardSocket(socket);
    const target = parseConnectAuthority(req.url);
    const seed = this.seed("CONNECT", target, headerString(req.headers, "authorization"));
    try {
      const auth = this.authenticate(req.headers);
      if (!auth.ok) {
        seed.attemptId = auth.attemptId;
        seed.profile = auth.profile;
        this.finish(seed, "deny", auth.reason);
        writeSocketStatus(socket, 407);
        return;
      }
      seed.attemptId = auth.state.attemptId;
      seed.profile = auth.state.profile;
      if (this.leaseExpired() || this.stopped) {
        this.finish(seed, "deny", "lease_expired");
        writeSocketStatus(socket, 403);
        return;
      }
      if (!target) {
        this.finish(seed, "deny", "malformed_target");
        writeSocketStatus(socket, 400);
        return;
      }
      const decision = evaluateProfileAccess(
        this.accessRequest(auth.state, target, "CONNECT", true),
      );
      if (!decision.allow) {
        this.finish(seed, "deny", decision.reason);
        writeSocketStatus(socket, decision.status);
        return;
      }
      const connectUrl = `https://${target.hostname}:${target.port}`;
      if (this.containsOutboundSecret(connectUrl, req.headers, auth.state, target.hostname)) {
        this.finish(seed, "deny", "secret_exfiltration");
        writeSocketStatus(socket, 403);
        return;
      }
      if (!this.acquire(auth.state)) {
        this.finish(seed, "deny", "concurrency_limit");
        writeSocketStatus(socket, 429);
        return;
      }
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        this.release(auth.state.attemptId);
      };
      try {
        const pinned = await this.pin(target.hostname);
        if (auth.state.revoked) {
          release();
          this.finish(seed, "deny", "attempt_revoked");
          writeSocketStatus(socket, 407);
          return;
        }
        if (!pinned.ok) {
          release();
          this.finish(seed, "deny", pinned.reason);
          writeSocketStatus(socket, 403);
          return;
        }
        const upstream = await connectPinned(
          pinned.address,
          pinned.family,
          target.port,
          auth.state.limits.connectTimeoutMs,
        );
        if (auth.state.revoked) {
          upstream.destroy();
          release();
          this.finish(seed, "deny", "attempt_revoked");
          writeSocketStatus(socket, 407);
          return;
        }
        this.track(auth.state.attemptId, socket);
        this.track(auth.state.attemptId, upstream);
        guardSocket(upstream);
        socket.setTimeout(auth.state.limits.idleTimeoutMs);
        upstream.setTimeout(auth.state.limits.idleTimeoutMs);
        socket.on("timeout", () => socket.destroy());
        upstream.on("timeout", () => upstream.destroy());
        let settled = false;
        let completion: { decision: "allow" | "deny"; reason: string } = {
          decision: "allow",
          reason: "allowlisted",
        };
        const settle = (): void => {
          if (settled) return;
          settled = true;
          release();
          if (auth.state.revoked) this.finish(seed, "deny", "attempt_revoked");
          else this.finish(seed, completion.decision, completion.reason);
        };
        socket.on("close", settle);
        upstream.on("close", settle);
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
          seed.bytesIn += head.length;
          upstream.write(head);
        }
        socket.on("data", (chunk: Buffer) => {
          seed.bytesIn += chunk.length;
        });
        upstream.on("data", (chunk: Buffer) => {
          if (seed.bytesOut + chunk.length > auth.state.limits.maxResponseBytes) {
            completion = { decision: "deny", reason: "response_too_large" };
            socket.unpipe(upstream);
            upstream.unpipe(socket);
            socket.destroy();
            upstream.destroy();
            return;
          }
          seed.bytesOut += chunk.length;
        });
        socket.pipe(upstream);
        upstream.pipe(socket);
      } catch (error) {
        release();
        this.finish(seed, "deny", "upstream_failed");
        writeSocketStatus(socket, 502);
        this.loggerFor(auth.state.attemptId).error("upstream_failed", {
          message: this.redactor.redact(error instanceof Error ? error.message : "connect failed"),
        });
      }
    } catch (error) {
      this.finish(seed, "deny", "internal_error");
      writeSocketStatus(socket, 502);
      this.logger.error("proxy_connect_error", {
        message: this.redactor.redact(error instanceof Error ? error.message : "connect failed"),
      });
    }
  }

  private async forwardHttp(
    req: IncomingMessage,
    res: ServerResponse,
    target: HttpTarget,
    pinned: PinSuccess,
    state: AttemptState,
    seed: AuditSeed,
    release: () => void,
  ): Promise<void> {
    const secure = target.protocol === "https:";
    const agent = secure
      ? new https.Agent({
          keepAlive: false,
          maxSockets: 1,
          rejectUnauthorized: this.rejectUnauthorized,
        })
      : new http.Agent({ keepAlive: false, maxSockets: 1 });
    const headers = forwardHeaders(req.headers);
    let settled = false;
    const settle = (decision: "allow" | "deny", reason: string): void => {
      if (settled) return;
      settled = true;
      release();
      agent.destroy();
      this.finish(seed, decision, reason);
    };
    const lookup = pinnedLookup(pinned.address, pinned.family);
    const upstreamReq = secure
      ? https.request({
          agent,
          protocol: "https:",
          hostname: target.hostname,
          servername: target.hostname,
          port: target.port,
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          family: pinned.family,
          lookup,
          rejectUnauthorized: this.rejectUnauthorized,
        })
      : http.request({
          agent,
          protocol: "http:",
          hostname: target.hostname,
          port: target.port,
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          family: pinned.family,
          lookup,
        });
    upstreamReq.setTimeout(state.limits.connectTimeoutMs, () => {
      upstreamReq.destroy(new Error("connect timeout"));
    });
    upstreamReq.on("socket", (socket) => {
      guardSocket(socket);
      this.track(state.attemptId, socket);
      socket.once("connect", () => {
        socket.setTimeout(state.limits.idleTimeoutMs);
      });
    });
    if (req.socket) this.track(state.attemptId, req.socket);
    upstreamReq.on("error", () => {
      settle(
        state.revoked ? "deny" : "deny",
        state.revoked ? "attempt_revoked" : "upstream_failed",
      );
      sendStatus(res, 502);
    });
    upstreamReq.on("response", (upstreamRes) => {
      void this.deliverResponse(upstreamRes, res, target, state, seed, settle).catch(
        (error: unknown) => {
          settle("deny", "upstream_failed");
          sendStatus(res, 502);
          this.loggerFor(state.attemptId).error("upstream_failed", {
            message: this.redactor.redact(
              error instanceof Error ? error.message : "response failed",
            ),
          });
        },
      );
    });
    req.pipe(upstreamReq);
  }

  private async deliverResponse(
    upstreamRes: IncomingMessage,
    res: ServerResponse,
    target: HttpTarget,
    state: AttemptState,
    seed: AuditSeed,
    settle: (decision: "allow" | "deny", reason: string) => void,
  ): Promise<void> {
    upstreamRes.pause();
    guardSocket(upstreamRes);
    const status = upstreamRes.statusCode ?? 502;
    const locations = headerList(upstreamRes.headers.location);
    if (isRedirect(status) && locations.length > 0) {
      for (const location of locations) {
        const verdict = await this.validateRedirect(location, target, state);
        if (!verdict.allow) {
          upstreamRes.destroy();
          settle("deny", "redirect_blocked");
          sendStatus(res, 403);
          return;
        }
      }
    }
    const declaredLength = Number(upstreamRes.headers["content-length"] ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > state.limits.maxResponseBytes) {
      upstreamRes.destroy();
      settle("deny", "response_too_large");
      sendStatus(res, 502);
      return;
    }
    if (state.revoked) {
      upstreamRes.destroy();
      settle("deny", "attempt_revoked");
      sendStatus(res, 407);
      return;
    }
    res.writeHead(status, responseHeaders(upstreamRes.headers));
    let overflow = false;
    upstreamRes.on("data", (chunk: Buffer) => {
      seed.bytesOut += chunk.length;
      if (seed.bytesOut > state.limits.maxResponseBytes) {
        overflow = true;
        upstreamRes.destroy();
        res.destroy();
        return;
      }
      if (!res.write(chunk)) upstreamRes.pause();
    });
    res.on("drain", () => upstreamRes.resume());
    upstreamRes.on("end", () => {
      if (!res.writableEnded) res.end();
      settle(
        overflow || state.revoked ? "deny" : "allow",
        overflow ? "response_too_large" : state.revoked ? "attempt_revoked" : "allowlisted",
      );
    });
    upstreamRes.on("error", () => {
      res.destroy();
      settle("deny", state.revoked ? "attempt_revoked" : "upstream_failed");
    });
    upstreamRes.on("close", () => {
      if (overflow) settle("deny", "response_too_large");
    });
    upstreamRes.resume();
  }

  private async validateRedirect(
    location: string,
    current: HttpTarget,
    state: AttemptState,
  ): Promise<{ allow: boolean }> {
    let next: URL;
    try {
      next = new URL(location, current.href);
    } catch {
      return { allow: false };
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") return { allow: false };
    if (this.redactor.scanForSecrets(next.href).length > 0) return { allow: false };
    const port = next.port ? Number(next.port) : next.protocol === "https:" ? 443 : 80;
    const decision = evaluateProfileAccess(
      this.accessRequest(state, { hostname: next.hostname, port }, "GET", false),
    );
    if (!decision.allow) return { allow: false };
    const pinned = await this.pin(next.hostname);
    return { allow: pinned.ok };
  }

  private async pin(hostname: string): Promise<PinSuccess | PinFailure> {
    let resolved: readonly ResolvedAddress[];
    const literal = net.isIP(hostname);
    if (literal === 4 || literal === 6) {
      resolved = [{ address: hostname, family: literal }];
    } else {
      try {
        resolved = await this.resolveHost(hostname);
      } catch {
        return { ok: false, reason: "dns_failed" };
      }
    }
    if (resolved.length === 0) return { ok: false, reason: "dns_failed" };
    if (
      !everyAddressPermitted(
        resolved.map((record) => record.address),
        this.testOnlyPrivateIps,
      )
    ) {
      return { ok: false, reason: "private_ip" };
    }
    const selected = resolved[0];
    if (!selected) return { ok: false, reason: "dns_failed" };
    return { ok: true, address: selected.address, family: selected.family };
  }

  private containsOutboundSecret(
    url: string,
    headers: IncomingHttpHeaders,
    state: AttemptState,
    hostname: string,
  ): boolean {
    const allowVendorAuthorization =
      state.profile === "wrapped_vendor" && vendorOwnsHost(state.vendor, hostname);
    const lines = [url];
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const lower = name.toLowerCase();
      if (lower === "proxy-authorization" || lower === "proxy-authenticate") continue;
      if (lower === "authorization" && allowVendorAuthorization) continue;
      lines.push(`${name}: ${Array.isArray(value) ? value.join("\n") : value}`);
    }
    return this.redactor.scanForSecrets(lines.join("\n")).length > 0;
  }

  private authenticate(
    headers: IncomingHttpHeaders,
  ):
    | { ok: true; state: AttemptState }
    | { ok: false; reason: string; attemptId: string; profile: NetworkPolicyProfile | "unknown" } {
    const token = extractProxyToken(headerString(headers, "proxy-authorization"));
    if (!token)
      return { ok: false, reason: "proxy_auth_required", attemptId: "", profile: "unknown" };
    const digest = digestToken(token);
    const state = this.byToken.get(digest);
    if (state && !state.revoked) return { ok: true, state };
    const revoked = this.revokedDigests.get(digest);
    if (revoked) {
      return {
        ok: false,
        reason: "attempt_revoked",
        attemptId: revoked.attemptId,
        profile: revoked.profile,
      };
    }
    return { ok: false, reason: "proxy_auth_required", attemptId: "", profile: "unknown" };
  }

  private accessRequest(
    state: AttemptState,
    target: { hostname: string; port: number },
    method: string,
    connect: boolean,
  ): ProfileAccessRequest {
    const request: ProfileAccessRequest = {
      profile: state.profile,
      hostname: target.hostname,
      port: target.port,
      method,
      connect,
      allowedTestEndpoints: state.allowedTestEndpoints,
      documentationHosts: state.documentationHosts,
      corporateRegistries: state.corporateRegistries,
    };
    if (state.vendor) return { ...request, vendor: state.vendor };
    return request;
  }

  private seed(
    method: string,
    target: { hostname: string; port: number; search?: string } | undefined,
    authorization: string | undefined,
  ): AuditSeed {
    const query = target && "search" in target && target.search ? target.search.slice(1) : "";
    return {
      method,
      host: target?.hostname ?? "",
      port: target?.port ?? 0,
      query,
      authorization: authorization ?? "",
      attemptId: "",
      profile: "unknown",
      bytesIn: 0,
      bytesOut: 0,
      closed: false,
    };
  }

  private finish(seed: AuditSeed, decision: "allow" | "deny", reason: string): void {
    if (seed.closed) return;
    seed.closed = true;
    const event: NetworkAuditEvent = {
      at: new Date(this.now()).toISOString(),
      attemptId: seed.attemptId,
      profile: seed.profile,
      method: seed.method,
      host: this.redactor.redact(seed.host),
      port: seed.port,
      decision,
      reason,
      bytesIn: seed.bytesIn,
      bytesOut: seed.bytesOut,
      query: this.redactor.redact(seed.query),
      authorization: seed.authorization
        ? redactSensitiveHeader(seed.authorization, this.redactor)
        : "",
    };
    this.auditLog.record(event);
    const fields = {
      attemptId: event.attemptId,
      profile: event.profile,
      method: event.method,
      host: event.host,
      port: event.port,
      decision: event.decision,
      reason: event.reason,
      bytesIn: event.bytesIn,
      bytesOut: event.bytesOut,
      query: event.query,
      authorization: event.authorization,
    };
    const logger = this.loggerFor(event.attemptId);
    if (decision === "deny") logger.warn("network_audit", fields);
    else logger.info("network_audit", fields);
  }

  private acquire(state: AttemptState): boolean {
    const current = this.inflight.get(state.attemptId) ?? 0;
    if (current >= state.limits.maxConcurrentTunnels) return false;
    this.inflight.set(state.attemptId, current + 1);
    return true;
  }

  private release(attemptId: string): void {
    const current = this.inflight.get(attemptId) ?? 0;
    if (current <= 1) this.inflight.delete(attemptId);
    else this.inflight.set(attemptId, current - 1);
  }

  private track(attemptId: string, socket: net.Socket): void {
    let set = this.sockets.get(attemptId);
    if (!set) {
      set = new Set();
      this.sockets.set(attemptId, set);
    }
    set.add(socket);
    socket.once("close", () => {
      set?.delete(socket);
      if (set && set.size === 0) this.sockets.delete(attemptId);
    });
  }

  private destroySockets(attemptId: string): void {
    const set = this.sockets.get(attemptId);
    if (!set) return;
    for (const socket of set) socket.destroy();
  }

  private leaseExpired(): boolean {
    return this.lease.expiresAt !== null && this.now() >= this.lease.expiresAt;
  }

  private loggerFor(attemptId: string): StructuredLogger {
    return this.logger.withContext?.({ attemptId, component: "allowlist-proxy" }) ?? this.logger;
  }

  private handleClientError(error: Error, socket: net.Socket): void {
    guardSocket(socket);
    socket.destroy();
    this.logger.warn("proxy_client_error", { message: this.redactor.redact(error.message) });
  }
}

const noopLogger: StructuredLogger = {
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  },
};

function validateLease(lease: PortLease, now: () => number): PortLease {
  if (!Number.isInteger(lease.port) || lease.port < PORT_LEASE_MIN || lease.port > PORT_LEASE_MAX) {
    throw new ProxyConfigError("port lease is outside 41000-48999");
  }
  if (!lease.projectId.trim() || !lease.environment.trim()) {
    throw new ProxyConfigError("port lease is missing project or environment");
  }
  if (!Number.isSafeInteger(lease.leasedAt) || lease.leasedAt < 0) {
    throw new ProxyConfigError("port lease leasedAt is invalid");
  }
  if (lease.expiresAt !== null) {
    if (!Number.isSafeInteger(lease.expiresAt) || lease.expiresAt < lease.leasedAt) {
      throw new ProxyConfigError("port lease expiresAt is invalid");
    }
    if (now() >= lease.expiresAt) throw new ProxyConfigError("port lease is expired");
  }
  return lease;
}

function positiveAtMost(value: number | undefined, cap: number, name: string): number {
  const selected = value ?? cap;
  if (!Number.isInteger(selected) || selected < 1 || selected > cap) {
    throw new ProxyConfigError(`${name} must be an integer from 1 to ${cap}`);
  }
  return selected;
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function extractProxyToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^(Bearer|Basic)\s+(\S+)$/i.exec(header.trim());
  if (!match || header.length > 512) return undefined;
  const scheme = (match[1] ?? "").toLowerCase();
  const value = match[2] ?? "";
  if (!value || value.length > 256) return undefined;
  if (scheme === "bearer") return value;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded || decoded.includes("\u0000")) return undefined;
  const colon = decoded.indexOf(":");
  const token = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  return token.length > 0 ? token : undefined;
}

function headerString(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return undefined;
}

function headerList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseAbsoluteUrl(raw: string | undefined): HttpTarget | undefined {
  if (!raw || raw.length > MAX_HEADER_BYTES) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return undefined;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return {
    hostname: url.hostname,
    port,
    protocol: url.protocol,
    pathname: url.pathname || "/",
    search: url.search,
    href: url.href,
  };
}

function parseConnectAuthority(
  raw: string | undefined,
): { hostname: string; port: number } | undefined {
  if (!raw || raw.length > 2048 || raw.includes(" ") || raw.includes("\r") || raw.includes("\n"))
    return undefined;
  try {
    const url = new URL(`http://${raw}`);
    const port = url.port ? Number(url.port) : 443;
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
    return { hostname: url.hostname, port };
  } catch {
    return undefined;
  }
}

function forwardHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const output: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_HEADERS.has(name.toLowerCase())) continue;
    output[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return output;
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const output: OutgoingHttpHeaders = { connection: "close" };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_HEADERS.has(name.toLowerCase())) continue;
    output[name] = value;
  }
  return output;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function sendStatus(res: ServerResponse, status: number): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  const phrase = PHRASES[status] ?? "Error";
  const headers: OutgoingHttpHeaders = {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(phrase),
    connection: "close",
  };
  if (status === 407) headers["proxy-authenticate"] = 'Bearer realm="ef-harness"';
  res.writeHead(status, headers);
  res.end(phrase);
}

function writeSocketStatus(socket: net.Socket, status: number): void {
  if (!socket.writable || socket.destroyed) {
    socket.destroy();
    return;
  }
  const phrase = PHRASES[status] ?? "Error";
  const lines = [
    `HTTP/1.1 ${status} ${phrase}`,
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(phrase)}`,
    "Connection: close",
  ];
  if (status === 407) lines.push('Proxy-Authenticate: Bearer realm="ef-harness"');
  socket.end(`${lines.join("\r\n")}\r\n\r\n${phrase}`);
}

function guardSocket(socket: NodeJS.EventEmitter): void {
  socket.on("error", () => undefined);
}

function connectPinned(
  address: string,
  family: 4 | 6,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port, family });
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("connect timeout"));
      socket.destroy();
    }, timeoutMs);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(socket);
    };
    socket.once("connect", () => finish());
    socket.once("error", (error) => {
      socket.destroy();
      finish(error);
    });
  });
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function normalizeEndpoints(endpoints: readonly AllowedTestEndpoint[]): AllowedTestEndpoint[] {
  return endpoints.map((endpoint) => {
    const host = normalizeHostname(endpoint.host);
    if (!host || host.startsWith("."))
      throw new ProxyConfigError("allowed test endpoint host is invalid");
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65_535) {
      throw new ProxyConfigError("allowed test endpoint port is invalid");
    }
    return { host, port: endpoint.port };
  });
}

function uniqueHosts(values: readonly string[]): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const host = normalizeHostname(value);
    if (!host) throw new ProxyConfigError("allowlist hostname is invalid");
    if (seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

function mergeLimits(
  base: AttemptResourceLimits,
  override: Partial<AttemptResourceLimits> | undefined,
): AttemptResourceLimits {
  const limits: AttemptResourceLimits = {
    maxConcurrentTunnels: override?.maxConcurrentTunnels ?? base.maxConcurrentTunnels,
    maxResponseBytes: override?.maxResponseBytes ?? base.maxResponseBytes,
    connectTimeoutMs: override?.connectTimeoutMs ?? base.connectTimeoutMs,
    idleTimeoutMs: override?.idleTimeoutMs ?? base.idleTimeoutMs,
  };
  if (
    !Number.isInteger(limits.maxConcurrentTunnels) ||
    limits.maxConcurrentTunnels < 1 ||
    !Number.isInteger(limits.maxResponseBytes) ||
    limits.maxResponseBytes < 0 ||
    !Number.isInteger(limits.connectTimeoutMs) ||
    limits.connectTimeoutMs < 1 ||
    !Number.isInteger(limits.idleTimeoutMs) ||
    limits.idleTimeoutMs < 1
  ) {
    throw new ProxyConfigError("attempt resource limits are invalid");
  }
  return limits;
}

function isProfile(value: string): value is NetworkPolicyProfile {
  return (
    value === "coding_worker" ||
    value === "verifier_test" ||
    value === "kernel_installer" ||
    value === "researcher" ||
    value === "wrapped_vendor"
  );
}

function isVendor(value: string): value is WrappedVendorId {
  return (
    value === "openai" ||
    value === "chatgpt" ||
    value === "anthropic" ||
    value === "github_copilot" ||
    value === "cursor" ||
    value === "google"
  );
}
