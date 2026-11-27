import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifySeededRows,
  seededRowsFromSnapshot,
  snapshotContainsText,
  toMatchAriaSnapshot,
} from "./aria-snapshot.js";
import { bindCopyCatalog, CopyCatalogLinter } from "./copy-catalog.js";
import { ContractSchemaError, HumanStepRequired } from "./errors.js";
import {
  assertNoBrittleLocators,
  compileContractChecks,
  duplicateControlMessage,
  missingControlMessage,
  missingTextMessage,
} from "./locators.js";
import { isMissingChromiumError, launchChromium } from "./playwright-runtime.js";
import type {
  CasBlobStorePort,
  EnvironmentHandlePort,
  HintLadderPort,
  PwBrowser,
  PwBrowserContext,
  PwLocator,
  PwPage,
  SurfaceCheckInput,
  SurfaceCheckResult,
  SurfaceCollectInput,
  UiCollectPort,
} from "./ports.js";
import { UiInteractionContractSchema } from "./schema.js";
import { redactVerbatim, TextMatchNormalizer } from "./text-match.js";
import type {
  ActionSpec,
  ContractStateName,
  HiddenCheckFailure,
  HiddenUiExpectation,
  HintFailureType,
  RegionScope,
  StateSpec,
  StoredArtifact,
  TextSpec,
  UiInteractionContract,
  UiVerificationResult,
  VerificationAttribution,
} from "./types.js";

const TRANSIENT_STATES = new Set<ContractStateName>(["empty", "loading", "error", "unauthorized"]);

export interface UiVerificationRequest {
  readonly env: EnvironmentHandlePort;
  readonly contract: unknown;
  readonly copyCatalog?: unknown;
  readonly hidden?: HiddenUiExpectation;
  readonly checks?: readonly unknown[];
  readonly focusState?: ContractStateName;
  readonly dataPath?: string;
  readonly networkDelayMs?: number;
  readonly populatedBody?: string;
  readonly checkId?: string;
}

interface Draft {
  readonly passed: boolean;
  readonly attribution: VerificationAttribution;
  readonly message: string;
  readonly disposition: UiVerificationResult["disposition"];
  readonly hiddenCheckFailure: boolean;
  readonly sealedHint: HiddenCheckFailure | null;
  readonly keyboardActivated: readonly string[];
}

interface NetworkPlan {
  readonly hold: boolean;
  readonly delayMs: number;
  readonly status: number;
  readonly body: string;
}

/**
 * Playwright role/label verifier for planner interaction contracts.
 * Missing visible controls stay a contract mismatch and do not touch the hint ladder.
 * Hidden seeded rows and ARIA snapshots are behavior failures.
 */
export class UiInteractionContractVerifier implements UiCollectPort {
  readonly id = "ui-interaction-contract";

  constructor(
    private readonly options: {
      readonly cas: CasBlobStorePort;
      readonly hintLadder?: HintLadderPort;
      readonly launchBrowser?: () => Promise<PwBrowser>;
    },
  ) {}

  supports(check: SurfaceCheckInput): boolean {
    return check.surface === "browser" || check.surface === "ui";
  }

  async collect(input: SurfaceCollectInput): Promise<readonly SurfaceCheckResult[]> {
    const results: SurfaceCheckResult[] = [];
    for (const check of input.checks) {
      if (!this.supports(check)) continue;
      const request = requestFromCheck(check, input.env);
      const result = await this.verify(request);
      results.push(toSurfaceResult(check.checkId, result));
    }
    return results;
  }

  async verify(request: UiVerificationRequest): Promise<UiVerificationResult> {
    const contract = resolveContract(request);
    assertNoBrittleLocators([...compileContractChecks(contract), ...(request.checks ?? [])]);
    const secrets = hiddenSecrets(request.hidden);
    const browser = await openBrowser(this.options.launchBrowser);
    let context: PwBrowserContext | undefined;
    let releaseHold: (() => void) | undefined;
    let tracingStarted = false;
    let trace = new Uint8Array();
    let screenshot = new Uint8Array();
    let ariaTree = "";
    let draft: Draft | undefined;
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    try {
      context = await browser.newContext({ locale: "en-US" });
      await context.tracing.start({ screenshots: true, snapshots: true });
      tracingStarted = true;
      const page = await context.newPage();
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error" && message.text().trim().length > 0) {
          if (/Failed to load resource/i.test(message.text())) return;
          consoleErrors.push(message.text());
        }
      });
      const appUrl = readAppUrl(request.env);
      const role = roleFor(contract, request.focusState);
      await context.addCookies([{ name: "ef_role", value: role, url: appUrl.origin }]);
      releaseHold = await installNetwork(page, request, contract);
      const target = new URL(contract.route, appUrl).toString();
      const response = await page.goto(target, { waitUntil: "load", timeout: 15_000 });
      if (response && response.status() >= 400) {
        draft = plainFailure(contract, "contract_mismatch", `Route ${contract.route} did not load`, secrets);
      } else {
        draft = await inspect(page, contract, request, pageErrors, consoleErrors, secrets);
      }
      try {
        ariaTree = await page.ariaSnapshot();
      } catch (error) {
        ariaTree = error instanceof Error ? error.message : String(error);
      }
      try {
        screenshot = copyBytes(await page.screenshot({ type: "png" }));
      } catch {
        screenshot = new Uint8Array();
      }
    } catch (error) {
      if (!draft) {
        const message = error instanceof Error ? error.message : String(error);
        draft = plainFailure(
          contract,
          "implementation",
          redactVerbatim(`Could not open ${contract.route}. ${message}`, secrets),
          secrets,
        );
      }
    } finally {
      if (releaseHold) releaseHold();
      if (context && tracingStarted) {
        trace = await readTrace(context);
      }
      if (context) await context.close();
      await browser.close();
    }
    const settled = draft ?? plainFailure(contract, "implementation", `Could not open ${contract.route}`, secrets);
    const artifacts = await this.storeArtifacts(
      [
        { label: "playwright-trace", bytes: trace },
        { label: "playwright-screenshot", bytes: screenshot },
        { label: "aria-tree", bytes: copyBytes(new TextEncoder().encode(ariaTree)) },
      ],
      settled.passed,
    );
    let ladderAdvanced = false;
    if (settled.hiddenCheckFailure && settled.sealedHint && this.options.hintLadder) {
      await this.options.hintLadder.processHiddenFailure(settled.sealedHint);
      ladderAdvanced = true;
    }
    return {
      passed: settled.passed,
      attribution: settled.attribution,
      message: settled.message,
      disposition: settled.disposition,
      ladderAdvanced,
      hiddenCheckFailure: settled.hiddenCheckFailure,
      sealedHint: settled.sealedHint,
      artifacts,
      pageErrors,
      consoleErrors,
      hostAriaTree: ariaTree,
      contractRoute: contract.route,
      keyboardActivated: settled.keyboardActivated,
      traceBytes: trace,
    };
  }

  private async storeArtifacts(
    files: readonly { readonly label: StoredArtifact["label"]; readonly bytes: Uint8Array }[],
    passed: boolean,
  ): Promise<StoredArtifact[]> {
    const stored: StoredArtifact[] = [];
    for (const file of files) {
      const digest = await this.options.cas.put(file.bytes, { retention: "diagnostic", label: file.label });
      let retention: StoredArtifact["retention"] = "diagnostic";
      if (passed) {
        await this.options.cas.promote(digest, "evidence");
        retention = "evidence";
      }
      stored.push({
        label: file.label,
        digest,
        retention,
        byteLength: file.bytes.byteLength,
      });
    }
    return stored;
  }
}

async function openBrowser(launchBrowser: (() => Promise<PwBrowser>) | undefined): Promise<PwBrowser> {
  try {
    return await (launchBrowser ?? launchChromium)();
  } catch (error) {
    if (error instanceof HumanStepRequired) throw error;
    if (isMissingChromiumError(error)) throw new HumanStepRequired("install_playwright_chromium");
    throw error;
  }
}

function requestFromCheck(check: SurfaceCheckInput, env: EnvironmentHandlePort): UiVerificationRequest {
  const input = isRecord(check.input) ? check.input : {};
  const request: {
    env: EnvironmentHandlePort;
    contract: unknown;
    checkId: string;
    copyCatalog?: unknown;
    hidden?: HiddenUiExpectation;
    focusState?: ContractStateName;
    dataPath?: string;
    networkDelayMs?: number;
    populatedBody?: string;
  } = {
    env,
    contract: input.contract,
    checkId: check.checkId,
  };
  if (input.copyCatalog !== undefined) request.copyCatalog = input.copyCatalog;
  if (isRecord(input.hidden)) request.hidden = input.hidden as HiddenUiExpectation;
  if (typeof input.focusState === "string") request.focusState = input.focusState as ContractStateName;
  if (typeof input.dataPath === "string") request.dataPath = input.dataPath;
  if (typeof input.networkDelayMs === "number") request.networkDelayMs = input.networkDelayMs;
  if (typeof input.populatedBody === "string") request.populatedBody = input.populatedBody;
  return request;
}

function toSurfaceResult(checkId: string, result: UiVerificationResult): SurfaceCheckResult {
  const observed = {
    passed: result.passed,
    attribution: result.attribution,
    message: result.message,
    route: result.contractRoute,
    hiddenCheckFailure: result.hiddenCheckFailure,
  };
  const log = new TextEncoder().encode(
    [result.message, ...result.pageErrors, ...result.consoleErrors].join("\n"),
  );
  return {
    checkId,
    observed,
    hasObserved: true,
    reporterStatus: result.passed ? "pass" : "fail",
    signals:
      result.attribution === "contract_mismatch"
        ? {
            contractMismatch: true,
            visibleControlMissing: true,
            plainMessage: result.message,
          }
        : null,
    trace: result.traceBytes,
    log,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveContract(request: UiVerificationRequest): UiInteractionContract {
  const parsed = UiInteractionContractSchema.parse(request.contract);
  if (request.copyCatalog === undefined) return parsed;
  const catalog = new CopyCatalogLinter().lint(request.copyCatalog);
  return bindCopyCatalog(parsed, catalog);
}

function hiddenSecrets(hidden: HiddenUiExpectation | undefined): readonly string[] {
  if (!hidden) return [];
  return [...(hidden.rows ?? []), hidden.ariaSnapshot ?? ""];
}

function readAppUrl(env: EnvironmentHandlePort): URL {
  const value = env.vars().APP_URL;
  if (!value) throw new ContractSchemaError("Environment vars() is missing APP_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ContractSchemaError("APP_URL is not a URL");
  }
  const expectedHost = `env-${env.id}.localhost`;
  if (url.hostname !== expectedHost) {
    throw new ContractSchemaError(`APP_URL host must be ${expectedHost} for cookie isolation`);
  }
  return url;
}

function roleFor(contract: UiInteractionContract, focusState: ContractStateName | undefined): string {
  const state = focusState ? contract.states.find((item) => item.name === focusState) : undefined;
  return state?.viewAs ?? contract.as.role;
}

function networkPlan(request: UiVerificationRequest, contract: UiInteractionContract): NetworkPlan | undefined {
  const focus = request.focusState;
  if (!focus) return undefined;
  const state = contract.states.find((item) => item.name === focus);
  if (!state) return undefined;
  const delayMs = request.networkDelayMs ?? 0;
  if (state.name === "loading") {
    return { hold: true, delayMs, status: 200, body: "[]" };
  }
  if (state.name === "error") return { hold: false, delayMs, status: 500, body: "{\"ok\":false}" };
  if (state.name === "empty") return { hold: false, delayMs, status: 200, body: "[]" };
  if (state.name === "populated" && request.populatedBody) {
    return { hold: false, delayMs, status: 200, body: request.populatedBody };
  }
  return undefined;
}

async function installNetwork(
  page: PwPage,
  request: UiVerificationRequest,
  contract: UiInteractionContract,
): Promise<(() => void) | undefined> {
  const plan = networkPlan(request, contract);
  if (!plan) return undefined;
  let release = (): void => {};
  let released = false;
  const gate = new Promise<void>((resolve) => {
    release = () => {
      if (released) return;
      released = true;
      resolve();
    };
  });
  const dataPath = request.dataPath ?? "/api/orders";
  await page.route(`**${dataPath}`, async (route) => {
    if (plan.hold) await gate;
    if (plan.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    }
    await route.fulfill({
      status: plan.status,
      contentType: "application/json",
      body: plan.body,
    });
  });
  return release;
}

function copyBytes(input: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy;
}

async function readTrace(context: PwBrowserContext): Promise<Uint8Array<ArrayBuffer>> {
  const directory = await mkdtemp(path.join(tmpdir(), "ef-ui-trace-"));
  const file = path.join(directory, "trace.zip");
  try {
    await context.tracing.stop({ path: file });
    const fileBytes = await readFile(file);
    return copyBytes(fileBytes);
  } catch {
    return new Uint8Array();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function inspect(
  page: PwPage,
  contract: UiInteractionContract,
  request: UiVerificationRequest,
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
  secrets: readonly string[],
): Promise<Draft> {
  const normalizer = new TextMatchNormalizer();
  const focus = request.focusState;
  if (focus && TRANSIENT_STATES.has(focus)) {
    const state = contract.states.find((item) => item.name === focus);
    if (!state) {
      return plainFailure(contract, "contract_mismatch", `No ${focus} state on ${contract.route}`, secrets);
    }
    const stateFailure = await assertState(page, contract, state, normalizer, secrets);
    if (stateFailure) return stateFailure;
    return crashOrPass(page, contract, pageErrors, consoleErrors, secrets, []);
  }
  for (const landmark of contract.landmarks) {
    const found = await locateRole(page, landmark.role, landmark.name, landmark.within, normalizer, contract.route);
    if (!found.ok) return plainFailure(contract, "contract_mismatch", found.message, secrets);
    for (const column of landmark.columns ?? []) {
      const header = await locateRole(
        found.locator,
        "columnheader",
        column,
        undefined,
        normalizer,
        contract.route,
      );
      if (!header.ok) return plainFailure(contract, "contract_mismatch", header.message, secrets);
    }
  }
  const located: { spec: ActionSpec; locator: PwLocator }[] = [];
  for (const action of contract.actions) {
    const found = await locateAction(page, action, normalizer, contract.route);
    if (!found.ok) return plainFailure(contract, "contract_mismatch", found.message, secrets);
    located.push({ spec: action, locator: found.locator });
  }
  const earlyCrash = crashDraft(contract, pageErrors, consoleErrors, secrets, []);
  if (earlyCrash) return earlyCrash;
  const keyboardActivated: string[] = [];
  for (const item of located) {
    const reached = await activateByKeyboard(page, item.spec, item.locator, normalizer);
    if (!reached) {
      const name = item.spec.name?.text ?? item.spec.testid ?? item.spec.role;
      return plainFailure(
        contract,
        "implementation",
        `${capitalize(item.spec.role)} '${name}' on ${contract.route} is not reachable by keyboard`,
        secrets,
      );
    }
    keyboardActivated.push(item.spec.name?.text ?? item.spec.testid ?? item.spec.role);
    await activateByPointer(item.spec, item.locator);
  }
  const postActionCrash = crashDraft(contract, pageErrors, consoleErrors, secrets, keyboardActivated);
  if (postActionCrash) return postActionCrash;
  return assertHidden(page, contract, request, pageErrors, consoleErrors, secrets, keyboardActivated);
}

async function assertState(
  page: PwPage,
  contract: UiInteractionContract,
  state: StateSpec,
  normalizer: TextMatchNormalizer,
  secrets: readonly string[],
): Promise<Draft | undefined> {
  const seen = await waitFor(async () => {
    if (state.role) {
      const found = await locateRole(page, state.role, state.accessibleName, undefined, normalizer, contract.route);
      if (!found.ok) return false;
    }
    if (state.text) {
      const tree = await page.ariaSnapshot();
      if (!snapshotContainsText(tree, state.text.text, state.text.matchMode)) return false;
    }
    return true;
  }, 5_000);
  if (seen) return undefined;
  if (state.text) {
    return plainFailure(contract, "contract_mismatch", missingTextMessage(state.text.text, contract.route), secrets);
  }
  return plainFailure(
    contract,
    "contract_mismatch",
    missingControlMessage(state.role ?? state.name, state.accessibleName?.text, contract.route),
    secrets,
  );
}

async function assertHidden(
  page: PwPage,
  contract: UiInteractionContract,
  request: UiVerificationRequest,
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
  secrets: readonly string[],
  keyboardActivated: readonly string[],
): Promise<Draft> {
  const hidden = request.hidden;
  if (!hidden) {
    const crash = crashDraft(contract, pageErrors, consoleErrors, secrets, keyboardActivated);
    if (crash) return crash;
    return {
      passed: true,
      attribution: "pass",
      message: `Interaction contract matched on ${contract.route}`,
      disposition: "pass",
      hiddenCheckFailure: false,
      sealedHint: null,
      keyboardActivated,
    };
  }
  const tree = await page.ariaSnapshot();
  const mode = hidden.matchMode ?? "normalized";
  if (hidden.rows && hidden.rows.length > 0) {
    const headers = contract.landmarks.flatMap((landmark) => landmark.columns?.map((column) => column.text) ?? []);
    const actual = seededRowsFromSnapshot(tree, headers);
    const classified = classifySeededRows(actual, hidden.rows, mode);
    if (!classified.ok) {
      return hiddenDraft(
        contract,
        request.checkId ?? "ui-contract",
        classified.failureType,
        { rows: hidden.rows },
        { rows: actual },
        `Seeded table rows on ${contract.route} did not match the hidden expectation.`,
        secrets,
        keyboardActivated,
      );
    }
  }
  if (hidden.ariaSnapshot) {
    const region = await snapshotReader(page, contract);
    const comparison = await toMatchAriaSnapshot(region, hidden.ariaSnapshot, mode);
    if (!comparison.ok) {
      return hiddenDraft(
        contract,
        request.checkId ?? "ui-contract",
        "wrong_value",
        { ariaSnapshot: hidden.ariaSnapshot },
        { ariaSnapshot: comparison.actual },
        `ARIA snapshot on ${contract.route} did not match the hidden expectation.`,
        secrets,
        keyboardActivated,
      );
    }
  }
  const crash = crashDraft(contract, pageErrors, consoleErrors, secrets, keyboardActivated);
  if (crash) return crash;
  return {
    passed: true,
    attribution: "pass",
    message: `Interaction contract matched on ${contract.route}`,
    disposition: "pass",
    hiddenCheckFailure: false,
    sealedHint: null,
    keyboardActivated,
  };
}

async function snapshotReader(
  page: PwPage,
  contract: UiInteractionContract,
): Promise<{ ariaSnapshot(): Promise<string> }> {
  const table = contract.landmarks.find((landmark) => landmark.role === "table");
  if (!table) return page;
  const normalizer = new TextMatchNormalizer();
  const found = await locateRole(page, "table", table.name, table.within, normalizer, contract.route);
  if (!found.ok) return page;
  return found.locator;
}

async function crashOrPass(
  page: PwPage,
  contract: UiInteractionContract,
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
  secrets: readonly string[],
  keyboardActivated: readonly string[],
): Promise<Draft> {
  const crash = crashDraft(contract, pageErrors, consoleErrors, secrets, keyboardActivated);
  if (crash) return crash;
  void page;
  return {
    passed: true,
    attribution: "pass",
    message: `Interaction contract matched on ${contract.route}`,
    disposition: "pass",
    hiddenCheckFailure: false,
    sealedHint: null,
    keyboardActivated,
  };
}

function crashDraft(
  contract: UiInteractionContract,
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
  secrets: readonly string[],
  keyboardActivated: readonly string[],
): Draft | undefined {
  if (pageErrors.length > 0) {
    return plainFailure(
      contract,
      "implementation",
      `Unhandled page error on ${contract.route}`,
      secrets,
      keyboardActivated,
    );
  }
  if (consoleErrors.length > 0) {
    return plainFailure(
      contract,
      "implementation",
      `Severe console error on ${contract.route}`,
      secrets,
      keyboardActivated,
    );
  }
  return undefined;
}

type Hit = { ok: true; locator: PwLocator } | { ok: false; message: string };

async function locateAction(
  page: PwPage,
  action: ActionSpec,
  normalizer: TextMatchNormalizer,
  route: string,
): Promise<Hit> {
  if (action.testid && !action.name) {
    const group = page.getByTestId(action.testid);
    const count = await group.count();
    if (count === 0) return { ok: false, message: `No test id '${action.testid}' on ${route}` };
    if (count > 1) return { ok: false, message: `Multiple test ids '${action.testid}' on ${route}` };
    return { ok: true, locator: group.nth(0) };
  }
  return locateRole(page, action.role, action.name, action.within, normalizer, route);
}

async function locateRole(
  scope: PwPage | PwLocator,
  role: string,
  name: TextSpec | undefined,
  within: RegionScope | undefined,
  normalizer: TextMatchNormalizer,
  route: string,
): Promise<Hit> {
  let target: PwPage | PwLocator = scope;
  if (within) {
    const region = await matchRole(scope, within.role, within.name, normalizer);
    if (region.length === 0) {
      return { ok: false, message: missingControlMessage(within.role, within.name?.text, route) };
    }
    if (region.length > 1) {
      return { ok: false, message: duplicateControlMessage(within.role, within.name?.text, route) };
    }
    const only = region[0];
    if (!only) return { ok: false, message: missingControlMessage(within.role, within.name?.text, route) };
    target = only;
  }
  const matches = await matchRole(target, role, name, normalizer);
  if (matches.length === 0) return { ok: false, message: missingControlMessage(role, name?.text, route) };
  if (matches.length > 1) return { ok: false, message: duplicateControlMessage(role, name?.text, route) };
  const locator = matches[0];
  if (!locator) return { ok: false, message: missingControlMessage(role, name?.text, route) };
  return { ok: true, locator };
}

async function matchRole(
  scope: PwPage | PwLocator,
  role: string,
  name: TextSpec | undefined,
  normalizer: TextMatchNormalizer,
): Promise<PwLocator[]> {
  const group = scope.getByRole(role);
  const count = await group.count();
  const matched: PwLocator[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = group.nth(index);
    if (!name) {
      matched.push(item);
      continue;
    }
    const accessible = await accessibleName(item);
    if (normalizer.matches(accessible, name.text, name.matchMode)) matched.push(item);
  }
  return matched;
}

async function accessibleName(locator: PwLocator): Promise<string> {
  const snapshot = await locator.ariaSnapshot();
  const line = snapshot.split(/\r?\n/).find((item) => item.trim().startsWith("- "));
  if (!line) return "";
  const quoted = /"([^"]*)"/.exec(line);
  if (quoted?.[1] !== undefined) return quoted[1];
  const body = line.trim().replace(/^- /, "").replace(/:$/, "");
  const role = /^[A-Za-z][\w-]*\s*/.exec(body);
  return role ? body.slice(role[0].length).trim() : body;
}

async function activateByKeyboard(
  page: PwPage,
  action: ActionSpec,
  locator: PwLocator,
  normalizer: TextMatchNormalizer,
): Promise<boolean> {
  const expected = action.name?.text;
  const mode = action.name?.matchMode ?? "normalized";
  if (!expected) {
    await locator.focus();
    return true;
  }
  await focusDocumentStart(page);
  let reached = false;
  for (let step = 0; step < 40; step += 1) {
    const current = await focusedAccessibleName(page);
    if (current.length > 0 && normalizer.matches(current, expected, mode)) {
      reached = true;
      break;
    }
    await page.keyboard.press("Tab");
  }
  if (!reached) return false;
  if (action.role === "button") {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
  } else if (action.role === "link") {
    await page.keyboard.press("Enter");
  } else if (action.role === "textbox" && action.value) {
    await typeText(page, action.value);
  } else if (action.role === "combobox" && action.value) {
    await locator.selectOption(action.value);
  }
  return true;
}

async function activateByPointer(action: ActionSpec, locator: PwLocator): Promise<void> {
  const interaction = action.interaction ?? defaultInteraction(action);
  if (interaction === "fill" && action.value) {
    await locator.fill(action.value, { timeout: 2_000 });
    return;
  }
  if (interaction === "select" && action.value) {
    await locator.selectOption(action.value);
    return;
  }
  if (action.role === "textbox" || action.role === "combobox") {
    await locator.focus();
    return;
  }
  await locator.click({ timeout: 2_000 });
}

function defaultInteraction(action: ActionSpec): "click" | "fill" | "select" {
  if (action.role === "textbox") return "fill";
  if (action.role === "combobox") return "select";
  return "click";
}

async function typeText(page: PwPage, value: string): Promise<void> {
  for (const char of value) {
    await page.keyboard.press(char === " " ? "Space" : char);
  }
}

async function focusDocumentStart(page: PwPage): Promise<void> {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: { body: { tabIndex: number; focus(): void } | null };
    };
    const body = browser.document.body;
    if (!body) return;
    body.tabIndex = -1;
    body.focus();
  });
}

async function focusedAccessibleName(page: PwPage): Promise<string> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: {
        activeElement: {
          getAttribute(name: string): string | null;
          textContent: string | null;
          closest(selector: string): { textContent: string | null } | null;
          id: string;
        } | null;
        body: unknown;
        documentElement: unknown;
        querySelector(selector: string): { textContent: string | null } | null;
      };
    };
    const doc = browser.document;
    const element = doc.activeElement;
    if (!element || element === doc.body || element === doc.documentElement) return "";
    const labelled = element.getAttribute("aria-label");
    if (labelled && labelled.trim().length > 0) return labelled.trim();
    if (/^[A-Za-z][\w-]*$/.test(element.id)) {
      const label = doc.querySelector(`label[for="${element.id}"]`);
      if (label?.textContent && label.textContent.trim().length > 0) return label.textContent.trim();
    }
    const parent = element.closest("label");
    if (parent?.textContent && parent.textContent.trim().length > 0) return parent.textContent.trim();
    return (element.textContent ?? "").trim();
  });
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return check();
}

function plainFailure(
  contract: UiInteractionContract,
  attribution: "contract_mismatch" | "implementation",
  message: string,
  secrets: readonly string[],
  keyboardActivated: readonly string[] = [],
): Draft {
  return {
    passed: false,
    attribution,
    message: redactVerbatim(message, secrets),
    disposition: "plain_message",
    hiddenCheckFailure: false,
    sealedHint: null,
    keyboardActivated,
  };
}

function hiddenDraft(
  contract: UiInteractionContract,
  checkId: string,
  failureType: HintFailureType,
  expected: unknown,
  observed: unknown,
  message: string,
  secrets: readonly string[],
  keyboardActivated: readonly string[],
): Draft {
  return {
    passed: false,
    attribution: "implementation",
    message: redactVerbatim(message, secrets),
    disposition: "hint_ladder",
    hiddenCheckFailure: true,
    sealedHint: {
      checkId,
      route: contract.route,
      ruleId: null,
      failureType,
      expected,
      observed,
    },
    keyboardActivated,
  };
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
