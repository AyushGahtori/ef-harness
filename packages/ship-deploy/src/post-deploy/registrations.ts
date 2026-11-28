import { promises as dns } from "node:dns";
import {
  PROBE_TIMEOUT_MS,
  defaultTls,
  dnsName,
  fetchReadOnly,
  readOnlyRequest,
  isLiveSideEffectHost,
  isLoopbackHost,
  systemClock,
  withTimeout,
} from "./http.js";
import type {
  Clock,
  DnsProbePort,
  ExternalRegistrationReceipt,
  HumanStepProbeRegistry,
  PacketSecurityRedactor,
  PostDeployStateStore,
  ProbeRequest,
  ProbeResponse,
  RegistrationProbeOutcome,
  RegistrationSpec,
  TlsProbe,
} from "./types.js";

export function createNodeDnsProbe(): DnsProbePort {
  return {
    async resolveCname(host) {
      try {
        return await dns.resolveCname(host);
      } catch (error) {
        if (isMissingDns(error)) return [];
        throw error;
      }
    },
    async resolveTxt(host) {
      try {
        return await dns.resolveTxt(host);
      } catch (error) {
        if (isMissingDns(error)) return [];
        throw error;
      }
    },
    async resolve4(host) {
      try {
        return await dns.resolve4(host);
      } catch (error) {
        if (isMissingDns(error)) return [];
        throw error;
      }
    },
  };
}

export function createReadOnlyProbeRegistry(deps?: {
  readonly dns?: DnsProbePort;
  readonly tlsProbe?: TlsProbe;
  readonly fetchImpl?: typeof fetch;
  readonly redactor?: PacketSecurityRedactor;
}): HumanStepProbeRegistry {
  const lookup = deps?.dns ?? createNodeDnsProbe();
  const tlsProbe = deps?.tlsProbe ?? defaultTls;
  return {
    async run(request) {
      const timeout = request.timeoutMs ?? PROBE_TIMEOUT_MS;
      try {
        const response = await withTimeout(dispatchProbe(request, lookup, tlsProbe, deps?.fetchImpl), timeout);
        return redactProbe(response, deps?.redactor);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return redactProbe(
          { ok: false, values: [], evidence: message },
          deps?.redactor,
        );
      }
    },
  };
}

export class ExternalRegistrationReceiptManager {
  constructor(
    private readonly deps: {
      readonly store: PostDeployStateStore;
      readonly probes: HumanStepProbeRegistry;
      readonly clock?: Clock;
      readonly redactor?: PacketSecurityRedactor;
    },
  ) {}

  copyable(spec: RegistrationSpec): string {
    switch (spec.registrationType) {
      case "stripe-webhook": {
        const url = spec.webhookUrl ?? spec.targetUrlOrDomain;
        const events = (spec.signingEvents ?? []).join(", ");
        return `Webhook URL: ${url}\nSigning events: ${events}`;
      }
      case "oauth-redirect":
        return `Redirect URI: ${spec.oauthRedirectUri ?? spec.targetUrlOrDomain}`;
      case "dns-cname":
        return `Type: CNAME\nHost: ${spec.targetUrlOrDomain}\nValue: ${spec.expectedCname ?? ""}`;
      case "dns-a":
        return `Type: A\nHost: ${spec.targetUrlOrDomain}\nValue: ${spec.expectedAddress ?? ""}`;
      case "dns-txt":
      case "spf":
        return `Type: TXT\nHost: ${spec.targetUrlOrDomain}\nValue: ${spec.expectedTxtIncludes ?? ""}`;
      case "dkim":
        return `Type: TXT\nHost: ${dkimHost(spec)}\nValue: v=DKIM1`;
      default: {
        const exhaustive: never = spec.registrationType;
        return exhaustive;
      }
    }
  }

  async verify(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    const outcome = await this.probe(spec);
    if (!outcome.ok || !outcome.receipt) return outcome;
    this.deps.store.insertRegistration(outcome.receipt);
    return outcome;
  }

  attest(spec: RegistrationSpec): ExternalRegistrationReceipt {
    const note = spec.attestationNote?.trim() || "I did this manually";
    const receipt: ExternalRegistrationReceipt = {
      shipRunId: spec.shipRunId,
      registrationType: spec.registrationType,
      targetUrlOrDomain: spec.targetUrlOrDomain,
      probeStatus: "attested",
      verifiedAt: null,
      evidence: this.redact(`Self-attested by you (unprobed): ${note}`),
    };
    this.deps.store.insertRegistration(receipt);
    return receipt;
  }

  private async probe(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    switch (spec.registrationType) {
      case "dns-cname":
        return this.verifyCname(spec);
      case "dns-a":
        return this.verifyAddress(spec);
      case "dns-txt":
      case "spf":
        return this.verifyTxt(spec, spec.registrationType === "spf");
      case "dkim":
        return this.verifyDkim(spec);
      case "stripe-webhook":
        return this.verifyWebhook(spec);
      case "oauth-redirect":
        return this.verifyHttps(spec, spec.oauthRedirectUri ?? spec.targetUrlOrDomain);
      default: {
        const exhaustive: never = spec.registrationType;
        return exhaustive;
      }
    }
  }

  private async verifyCname(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    const response = await this.deps.probes.run({
      kind: "dns-cname",
      target: spec.targetUrlOrDomain,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return this.failed(response.evidence);
    const actual = response.values[0] ? dnsName(response.values[0]) : "";
    const expected = dnsName(spec.expectedCname ?? "");
    if (!actual) return this.failed(`CNAME record not found for ${spec.targetUrlOrDomain}`);
    if (!expected || actual !== expected) {
      return this.failed(
        `CNAME still points to ${actual} — DNS propagation may take a few minutes`,
      );
    }
    const tls = await this.deps.probes.run({
      kind: "tls",
      target: spec.targetUrlOrDomain,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!tls.ok) return this.failed(tls.evidence);
    return this.verified(
      spec,
      `CNAME ${actual} matches ${expected}. ${tls.evidence}`,
    );
  }

  private async verifyAddress(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    const response = await this.deps.probes.run({
      kind: "dns-a",
      target: spec.targetUrlOrDomain,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return this.failed(response.evidence);
    const expected = spec.expectedAddress ?? "";
    if (!expected || !response.values.includes(expected)) {
      return this.failed(
        `A record for ${spec.targetUrlOrDomain} is ${response.values.join(", ") || "(none)"}`,
      );
    }
    return this.verified(spec, `A ${expected} matches`);
  }

  private async verifyTxt(spec: RegistrationSpec, spf: boolean): Promise<RegistrationProbeOutcome> {
    const response = await this.deps.probes.run({
      kind: "dns-txt",
      target: spec.targetUrlOrDomain,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return this.failed(response.evidence);
    const joined = response.values.join("\n");
    if (spf && !joined.includes("v=spf1")) {
      return this.failed(`SPF TXT not found for ${spec.targetUrlOrDomain}`);
    }
    const expected = spec.expectedTxtIncludes;
    if (expected && !joined.includes(expected)) {
      return this.failed(`TXT for ${spec.targetUrlOrDomain} does not include ${expected}`);
    }
    if (!spf && !expected && response.values.length === 0) {
      return this.failed(`TXT record not found for ${spec.targetUrlOrDomain}`);
    }
    return this.verified(spec, `TXT probe matched ${response.values.length} record(s)`);
  }

  private async verifyDkim(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    const host = dkimHost(spec);
    const response = await this.deps.probes.run({
      kind: "dns-txt",
      target: host,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return this.failed(response.evidence);
    const joined = response.values.join("\n");
    if (!joined.includes("v=DKIM1")) {
      return this.failed(`DKIM TXT not found at ${host}`);
    }
    return this.verified(spec, `DKIM verified at ${host}`);
  }

  private async verifyWebhook(spec: RegistrationSpec): Promise<RegistrationProbeOutcome> {
    const url = spec.webhookUrl ?? spec.targetUrlOrDomain;
    const reach = await this.verifyHttps(spec, url);
    if (!reach.ok) return reach;
    if (!spec.allowSignedTestPing) return reach;
    const ping = await this.deps.probes.run({
      kind: "webhook-test-ping",
      target: url,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!ping.ok) return this.failed(ping.evidence);
    return this.verified(spec, `${reach.receipt?.evidence ?? "HTTPS reachable"}. ${ping.evidence}`);
  }

  private async verifyHttps(
    spec: RegistrationSpec,
    target: string,
  ): Promise<RegistrationProbeOutcome> {
    const response = await this.deps.probes.run({
      kind: "https",
      target,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return this.failed(response.evidence);
    return this.verified(spec, response.evidence);
  }

  private verified(spec: RegistrationSpec, evidence: string): RegistrationProbeOutcome {
    const receipt: ExternalRegistrationReceipt = {
      shipRunId: spec.shipRunId,
      registrationType: spec.registrationType,
      targetUrlOrDomain: spec.targetUrlOrDomain,
      probeStatus: "verified",
      verifiedAt: new Date((this.deps.clock ?? systemClock).now()).toISOString(),
      evidence: this.redact(evidence),
    };
    return { ok: true, receipt };
  }

  private failed(evidence: string): RegistrationProbeOutcome {
    return {
      ok: false,
      probeStatus: "failed",
      evidence: this.redact(evidence),
      receipt: null,
    };
  }

  private redact(text: string): string {
    return this.deps.redactor ? this.deps.redactor.redact(text) : text;
  }
}

async function dispatchProbe(
  request: ProbeRequest,
  lookup: DnsProbePort,
  tlsProbe: TlsProbe,
  fetchImpl: typeof fetch | undefined,
): Promise<ProbeResponse> {
  switch (request.kind) {
    case "dns-cname": {
      const values = (await lookup.resolveCname(request.target)).map((value) => dnsName(value));
      return { ok: true, values, evidence: values.join(", ") || "no CNAME records" };
    }
    case "dns-txt": {
      const records = await lookup.resolveTxt(request.target);
      const values = records.map((chunks) => chunks.join(""));
      return { ok: true, values, evidence: values.join(" | ") || "no TXT records" };
    }
    case "dns-a": {
      const values = [...(await lookup.resolve4(request.target))];
      return { ok: true, values, evidence: values.join(", ") || "no A records" };
    }
    case "tls": {
      const target = toHttpsUrl(request.target);
      const report = await tlsProbe(target);
      const evidence = report.valid
        ? `TLS valid${report.expiresAt ? ` expires ${report.expiresAt}` : ""}`
        : (report.reason ?? "TLS certificate is not valid");
      return report.expiresAt
        ? { ok: report.valid, values: [], evidence, expiresAt: report.expiresAt }
        : { ok: report.valid, values: [], evidence };
    }
    case "https": {
      const response = await fetchReadOnly(toProbeUrl(request.target), readOnlyRequest("manual", fetchImpl));
      const reachable = response.status !== 404 && response.status > 0 && response.status < 500;
      return {
        ok: reachable,
        values: [],
        status: response.status,
        evidence: reachable
          ? `HTTPS reachable HTTP ${response.status}`
          : `HTTPS probe returned HTTP ${response.status}`,
      };
    }
    case "webhook-test-ping":
      return pingWebhook(request.target, fetchImpl);
    default: {
      const exhaustive: never = request.kind;
      return exhaustive;
    }
  }
}

async function pingWebhook(
  target: string,
  fetchImpl: typeof fetch | undefined,
): Promise<ProbeResponse> {
  const url = new URL(target);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    return { ok: false, values: [], evidence: "Signed test ping requires HTTPS" };
  }
  if (isLiveSideEffectHost(url.hostname)) {
    return { ok: false, values: [], evidence: "Refusing to ping a live Stripe or email host" };
  }
  const response = await (fetchImpl ?? fetch)(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-ef-test-ping": "1",
    },
    body: JSON.stringify({ efTestPing: true }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const ok = response.status > 0 && response.status < 500;
  return {
    ok,
    values: [],
    status: response.status,
    evidence: `signed test ping HTTP ${response.status}`,
  };
}

function toHttpsUrl(target: string): URL {
  if (target.startsWith("http://") || target.startsWith("https://")) return new URL(target);
  return new URL(`https://${target}/`);
}

function toProbeUrl(target: string): string {
  if (target.startsWith("http://") || target.startsWith("https://")) return target;
  return `https://${target}/`;
}

function dkimHost(spec: RegistrationSpec): string {
  const selector = spec.dkimSelector ?? "resend";
  return `${selector}._domainkey.${dnsName(spec.targetUrlOrDomain)}`;
}

function isMissingDns(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  return code === "ENOTFOUND" || code === "ENODATA" || code === "ENOENT";
}

function redactProbe(response: ProbeResponse, redactor: PacketSecurityRedactor | undefined): ProbeResponse {
  if (!redactor) return response;
  return { ...response, evidence: redactor.redact(response.evidence) };
}
