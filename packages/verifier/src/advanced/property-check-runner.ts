import {
  array,
  check,
  constantFrom,
  integer,
  property,
  record,
  type IProperty,
  type Parameters as FastCheckParameters,
  type RunDetails,
} from "fast-check";
import { roundHalfAwayFromZero } from "./money-rounding.js";

export type DomainInvariant =
  | "conservation_of_totals"
  | "idempotence"
  | "sort_order_preservation"
  | "integer_minor_unit_money_rounding";

export interface QuantityLine {
  readonly label: string;
  readonly quantity: number;
}

export interface PropertyBounds {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minQuantity?: number;
  readonly maxQuantity?: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly minDenominator?: number;
  readonly maxDenominator?: number;
  readonly labels?: readonly string[];
}

export type PropertySubject =
  | {
      readonly invariant: "conservation_of_totals";
      readonly total: (lines: readonly QuantityLine[]) => number;
    }
  | {
      readonly invariant: "idempotence";
      readonly apply: (value: number) => number;
    }
  | {
      readonly invariant: "sort_order_preservation";
      readonly sort: (items: readonly QuantityLine[]) => readonly QuantityLine[];
    }
  | {
      readonly invariant: "integer_minor_unit_money_rounding";
      readonly roundMinor: (numerator: number, denominator: number) => number;
    };

export interface PropertyCheckRequest {
  readonly checkId: string;
  readonly seed: number;
  readonly numRuns?: number;
  readonly path?: string;
  readonly bounds?: PropertyBounds;
  readonly subject: PropertySubject;
  readonly examples?: readonly unknown[];
}

export interface PropertyCheckReceipt {
  readonly checkId: string;
  readonly invariant: DomainInvariant;
  readonly ruleId: "X-04" | null;
  readonly passed: boolean;
  readonly seed: number;
  readonly path: string | null;
  readonly counterexample: unknown;
  readonly initialFailure: unknown;
  readonly initialFailureSize: number | null;
  readonly numShrinks: number;
  readonly numRuns: number;
  readonly interrupted: boolean;
}

interface ResolvedBounds {
  readonly minLength: number;
  readonly maxLength: number;
  readonly minQuantity: number;
  readonly maxQuantity: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly minDenominator: number;
  readonly maxDenominator: number;
  readonly labels: readonly string[];
}

export class PropertyCheckRunner {
  run(request: PropertyCheckRequest): PropertyCheckReceipt {
    if (!Number.isFinite(request.seed)) {
      throw new Error("property seed must be a finite number");
    }
    const numRuns = request.numRuns ?? 100;
    if (!Number.isInteger(numRuns) || numRuns < 1) {
      throw new Error("numRuns must be a positive integer");
    }
    const bounds = resolveBounds(request.bounds);
    switch (request.subject.invariant) {
      case "conservation_of_totals":
        return this.runConservation(request, request.subject, bounds, numRuns);
      case "idempotence":
        return this.runIdempotence(request, request.subject, bounds, numRuns);
      case "sort_order_preservation":
        return this.runSort(request, request.subject, bounds, numRuns);
      case "integer_minor_unit_money_rounding":
        return this.runMoney(request, request.subject, bounds, numRuns);
      default: {
        const unknown: never = request.subject;
        throw new Error(`unsupported invariant ${JSON.stringify(unknown)}`);
      }
    }
  }

  reproduce(request: PropertyCheckRequest, prior: PropertyCheckReceipt): PropertyCheckReceipt {
    return this.run({
      ...request,
      seed: prior.seed,
      ...(prior.path ? { path: prior.path } : {}),
    });
  }

  private runConservation(
    request: PropertyCheckRequest,
    subject: Extract<PropertySubject, { invariant: "conservation_of_totals" }>,
    bounds: ResolvedBounds,
    numRuns: number,
  ): PropertyCheckReceipt {
    const lines = lineArbitrary(bounds);
    const examples = (request.examples ?? []).map((example) => [readLines(example)] as [QuantityLine[]]);
    const details = execute(
      property(lines, (value) => {
        const expected = value.reduce((sum, line) => sum + line.quantity, 0);
        const actual = subject.total(value);
        return actual === expected && Number.isSafeInteger(actual);
      }),
      request.seed,
      numRuns,
      request.path,
      examples,
    );
    return finish(request, "conservation_of_totals", null, 1, details);
  }

  private runIdempotence(
    request: PropertyCheckRequest,
    subject: Extract<PropertySubject, { invariant: "idempotence" }>,
    bounds: ResolvedBounds,
    numRuns: number,
  ): PropertyCheckReceipt {
    const examples: [number][] = [];
    for (const example of request.examples ?? []) {
      if (typeof example !== "number" || !Number.isSafeInteger(example)) {
        throw new Error("idempotence examples must be safe integers");
      }
      examples.push([example]);
    }
    const details = execute(
      property(integer({ min: bounds.minValue, max: bounds.maxValue }), (value) => {
        const once = subject.apply(value);
        const twice = subject.apply(once);
        return Object.is(once, twice);
      }),
      request.seed,
      numRuns,
      request.path,
      examples,
    );
    return finish(request, "idempotence", null, 1, details);
  }

  private runSort(
    request: PropertyCheckRequest,
    subject: Extract<PropertySubject, { invariant: "sort_order_preservation" }>,
    bounds: ResolvedBounds,
    numRuns: number,
  ): PropertyCheckReceipt {
    const lines = lineArbitrary(bounds);
    const examples = (request.examples ?? []).map((example) => [readLines(example)] as [QuantityLine[]]);
    const details = execute(
      property(lines, (value) => sortPreserved(value, subject.sort(value))),
      request.seed,
      numRuns,
      request.path,
      examples,
    );
    return finish(request, "sort_order_preservation", null, 1, details);
  }

  private runMoney(
    request: PropertyCheckRequest,
    subject: Extract<PropertySubject, { invariant: "integer_minor_unit_money_rounding" }>,
    bounds: ResolvedBounds,
    numRuns: number,
  ): PropertyCheckReceipt {
    const examples = readMoneyExamples(request.examples);
    const details = execute(
      property(
        integer({ min: bounds.minValue, max: bounds.maxValue }),
        integer({ min: bounds.minDenominator, max: bounds.maxDenominator }),
        (numerator, denominator) => {
          const actual = subject.roundMinor(numerator, denominator);
          const expected = roundHalfAwayFromZero(numerator, denominator);
          return Number.isSafeInteger(actual) && actual === expected;
        },
      ),
      request.seed,
      numRuns,
      request.path,
      examples,
    );
    return finish(request, "integer_minor_unit_money_rounding", "X-04", 2, details);
  }
}

function lineArbitrary(bounds: ResolvedBounds) {
  return array(
    record({
      label: labelArbitrary(bounds.labels),
      quantity: integer({ min: bounds.minQuantity, max: bounds.maxQuantity }),
    }),
    { minLength: bounds.minLength, maxLength: bounds.maxLength },
  );
}

function labelArbitrary(labels: readonly string[]) {
  const first = labels[0];
  if (first === undefined) throw new Error("property bounds need at least one label");
  return constantFrom(first, ...labels.slice(1));
}

function execute<Ts extends unknown[]>(
  assertion: IProperty<Ts>,
  seed: number,
  numRuns: number,
  replayPath: string | undefined,
  examples: Ts[],
): RunDetails<Ts> {
  const params: FastCheckParameters<Ts> = {
    seed,
    numRuns,
    verbose: true,
  };
  if (replayPath !== undefined) params.path = replayPath;
  if (examples.length > 0) params.examples = examples;
  return check(assertion, params);
}

function finish<Ts extends unknown[]>(
  request: PropertyCheckRequest,
  invariant: DomainInvariant,
  ruleId: "X-04" | null,
  arity: 1 | 2,
  details: RunDetails<Ts>,
): PropertyCheckReceipt {
  const counterexample = domainValue(details.counterexample, arity);
  const first = details.failures[0];
  const initialFailure = first ? domainValue(first, arity) : null;
  const initialFailureSize = arity === 1 && Array.isArray(initialFailure) ? initialFailure.length : null;
  return {
    checkId: request.checkId,
    invariant,
    ruleId,
    passed: !details.failed,
    seed: details.seed,
    path: details.counterexamplePath,
    counterexample,
    initialFailure,
    initialFailureSize,
    numShrinks: details.numShrinks,
    numRuns: details.numRuns,
    interrupted: details.interrupted,
  };
}

function domainValue(value: unknown, arity: 1 | 2): unknown {
  if (value === null || value === undefined) return null;
  if (arity === 1 && Array.isArray(value)) return value[0] ?? null;
  return value;
}

function resolveBounds(bounds: PropertyBounds | undefined): ResolvedBounds {
  const resolved: ResolvedBounds = {
    minLength: bounds?.minLength ?? 0,
    maxLength: bounds?.maxLength ?? 16,
    minQuantity: bounds?.minQuantity ?? 0,
    maxQuantity: bounds?.maxQuantity ?? 8,
    minValue: bounds?.minValue ?? 0,
    maxValue: bounds?.maxValue ?? 200,
    minDenominator: bounds?.minDenominator ?? 1,
    maxDenominator: bounds?.maxDenominator ?? 12,
    labels: bounds?.labels ?? ["A", "B"],
  };
  if (resolved.minLength < 0 || resolved.maxLength < resolved.minLength) {
    throw new Error("property length bounds are invalid");
  }
  if (resolved.maxQuantity < resolved.minQuantity || resolved.maxValue < resolved.minValue) {
    throw new Error("property numeric bounds are invalid");
  }
  if (
    resolved.minDenominator === 0 ||
    resolved.maxDenominator === 0 ||
    resolved.maxDenominator < resolved.minDenominator
  ) {
    throw new Error("property denominator bounds are invalid");
  }
  if (resolved.labels.length === 0) throw new Error("property bounds need at least one label");
  return resolved;
}

function readLines(example: unknown): QuantityLine[] {
  if (!Array.isArray(example)) throw new Error("line examples must be arrays");
  return example.map((line, index) => {
    if (!isQuantityLine(line)) throw new Error(`line example ${index} is invalid`);
    return { label: line.label, quantity: line.quantity };
  });
}

function isQuantityLine(value: unknown): value is QuantityLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as { label?: unknown; quantity?: unknown };
  return typeof line.label === "string" && typeof line.quantity === "number" && Number.isInteger(line.quantity);
}

function readMoneyExamples(examples: readonly unknown[] | undefined): [number, number][] {
  const pairs: [number, number][] = [];
  for (const example of examples ?? []) {
    if (!Array.isArray(example) || example.length !== 2) {
      throw new Error("money rounding examples must be [numerator, denominator] pairs");
    }
    const numerator = example[0];
    const denominator = example[1];
    if (
      typeof numerator !== "number" ||
      typeof denominator !== "number" ||
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator)
    ) {
      throw new Error("money rounding examples must be safe integer pairs");
    }
    if (denominator === 0) throw new Error("X-04 examples cannot use a zero denominator");
    pairs.push([numerator, denominator]);
  }
  return pairs;
}

function sortPreserved(input: readonly QuantityLine[], output: readonly QuantityLine[]): boolean {
  if (output.length !== input.length) return false;
  if (!sameMultiset(input, output)) return false;
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    if (!previous || !current) return false;
    const labelOrder = previous.label.localeCompare(current.label);
    if (labelOrder > 0) return false;
    if (labelOrder === 0 && previous.quantity > current.quantity) return false;
  }
  return true;
}

function sameMultiset(left: readonly QuantityLine[], right: readonly QuantityLine[]): boolean {
  const key = (line: QuantityLine) => `${line.label}\u0000${line.quantity}`;
  const a = left.map(key).sort();
  const b = right.map(key).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
