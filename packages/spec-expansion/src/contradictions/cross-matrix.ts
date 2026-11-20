import {
  MATRIX_IDS,
  buildResolutionOptions,
  makeConflictId,
  type ConflictDraft,
  type MatrixCellRecord,
  type MatrixId,
} from "./types.js";

export interface CrossMatrixResult {
  readonly conflicts: readonly ConflictDraft[];
  readonly matricesChecked: readonly MatrixId[];
}

/**
 * Layer 3. Deterministic invariants across the 12 Task 079 matrices.
 * Open and not-applicable cells are ignored. Every matrix id is visited.
 */
export class CrossMatrixInvariantChecker {
  check(cells: readonly MatrixCellRecord[]): CrossMatrixResult {
    const filled = cells.filter((cell) => cell.status === "filled");
    const byMatrix = new Map<MatrixId, MatrixCellRecord[]>();
    for (const matrixId of MATRIX_IDS) byMatrix.set(matrixId, []);
    for (const cell of filled) {
      const bucket = byMatrix.get(cell.matrixId);
      if (bucket !== undefined) bucket.push(cell);
    }
    const m01 = byMatrix.get("M01") ?? [];
    const m02 = byMatrix.get("M02") ?? [];
    const m03 = byMatrix.get("M03") ?? [];
    const m04 = byMatrix.get("M04") ?? [];
    const m06 = byMatrix.get("M06") ?? [];
    const m08 = byMatrix.get("M08") ?? [];
    const m10 = byMatrix.get("M10") ?? [];
    const conflicts: ConflictDraft[] = [];

    for (const role of m01) {
      if (role.allowed !== true || role.actionId === undefined || role.actionId.length === 0) continue;
      const actionId = role.actionId;
      const route = m04.find(
        (cell) => cell.actionId === actionId && cell.routeOrCommand !== undefined && cell.routeOrCommand.length > 0,
      );
      if (route === undefined) {
        conflicts.push(
          mismatch(
            "m01_missing_m04",
            [role.id, `missing:M04:${actionId}`],
            `Role matrix allows ${actionId} but API matrix M04 has no matching route or command.`,
            `Action ${actionId} on ${role.id} cannot be invoked: no M04 route/command is filled.`,
          ),
        );
      }
      const lifecycle = m02.find(
        (cell) =>
          cell.actionId === actionId && cell.lifecycleHandler !== undefined && cell.lifecycleHandler.length > 0,
      );
      if (lifecycle === undefined) {
        conflicts.push(
          mismatch(
            "m01_missing_m02",
            [role.id, `missing:M02:${actionId}`],
            `Role matrix allows ${actionId} but entity matrix M02 has no lifecycle handler.`,
            `Action ${actionId} on ${role.id} has no M02 create/read/update/delete handler.`,
          ),
        );
      }
    }

    for (const screen of m03) {
      if (screen.screenActionId === undefined || screen.screenActionId.length === 0) continue;
      const role = m01.find((cell) => cell.actionId === screen.screenActionId);
      if (role?.allowed === true) continue;
      const rightId = role?.id ?? `missing:M01:${screen.screenActionId}`;
      const label = screen.text ?? screen.screenActionId;
      conflicts.push(
        mismatch(
          "m03_forbidden_by_m01",
          [screen.id, rightId],
          `Screen ${screen.id} renders "${label}" but role matrix ${rightId} does not permit ${screen.screenActionId}.`,
          `A user can see ${label} (${screen.screenActionId}) while M01 forbids that action.`,
        ),
      );
    }

    conflicts.push(...trapConflicts(m06));
    conflicts.push(...retentionConflicts(m02, m10));
    conflicts.push(...notificationConflicts(m06, m08));

    return { conflicts, matricesChecked: MATRIX_IDS };
  }
}

function trapConflicts(m06: readonly MatrixCellRecord[]): ConflictDraft[] {
  const terminals = new Set<string>();
  const states = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const cellForState = new Map<string, string>();
  for (const cell of m06) {
    if (cell.stateId !== undefined) {
      states.add(cell.stateId);
      cellForState.set(cell.stateId, cell.id);
      if (cell.terminal === true) terminals.add(cell.stateId);
    }
    if (cell.fromState !== undefined) {
      states.add(cell.fromState);
      if (!cellForState.has(cell.fromState)) cellForState.set(cell.fromState, cell.id);
      if (cell.terminal === true && cell.toState === undefined) terminals.add(cell.fromState);
    }
    if (cell.toState !== undefined) states.add(cell.toState);
    if (cell.fromState !== undefined && cell.toState !== undefined) {
      const next = outgoing.get(cell.fromState);
      if (next === undefined) outgoing.set(cell.fromState, [cell.toState]);
      else next.push(cell.toState);
    }
  }
  const conflicts: ConflictDraft[] = [];
  for (const state of states) {
    if (terminals.has(state)) continue;
    if (reachesTerminal(state, outgoing, terminals)) continue;
    const cellId = cellForState.get(state) ?? `missing:M06:${state}`;
    conflicts.push(
      mismatch(
        "m06_trap_state",
        [cellId, `state:${state}`],
        `Non-terminal state ${state} has no reachable exit to a terminal state.`,
        `Starting in ${state} never reaches a terminal state, so the lifecycle can trap a record there.`,
      ),
    );
  }
  return conflicts;
}

function reachesTerminal(
  start: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  terminals: ReadonlySet<string>,
): boolean {
  if (terminals.has(start)) return true;
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const nextStates = outgoing.get(current) ?? [];
    for (const next of nextStates) {
      if (terminals.has(next)) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function retentionConflicts(m02: readonly MatrixCellRecord[], m10: readonly MatrixCellRecord[]): ConflictDraft[] {
  const conflicts: ConflictDraft[] = [];
  for (const privacy of m10) {
    if (privacy.entityId === undefined || privacy.retentionAction === undefined) continue;
    const entityCells = m02.filter((cell) => cell.entityId === privacy.entityId);
    for (const entity of entityCells) {
      const hardDeleteClashesWithAudit =
        entity.immutableAudit === true && privacy.retentionAction === "hard_delete";
      const hardDeleteForbidden = entity.hardDelete === false && privacy.retentionAction === "hard_delete";
      const retainClashesWithHardDelete = entity.hardDelete === true && privacy.retentionAction === "retain";
      if (!hardDeleteClashesWithAudit && !hardDeleteForbidden && !retainClashesWithHardDelete) continue;
      conflicts.push(
        mismatch(
          "m10_conflicts_m02",
          [privacy.id, entity.id],
          `Retention rule ${privacy.id} (${privacy.retentionAction}) conflicts with entity lifecycle ${entity.id} for ${privacy.entityId}.`,
          `Applying ${privacy.retentionAction} to ${privacy.entityId} breaks M02 hard-delete/immutable-audit constraints on ${entity.id}.`,
        ),
      );
    }
  }
  return conflicts;
}

function notificationConflicts(m06: readonly MatrixCellRecord[], m08: readonly MatrixCellRecord[]): ConflictDraft[] {
  const transitions = new Set<string>();
  for (const cell of m06) {
    if (cell.fromState !== undefined && cell.toState !== undefined) {
      transitions.add(`${cell.fromState}->${cell.toState}`);
    }
  }
  const conflicts: ConflictDraft[] = [];
  for (const notice of m08) {
    const trigger = notice.notificationTrigger;
    if (trigger === undefined || trigger.length === 0) continue;
    if (transitions.has(trigger)) continue;
    const anchor = m06[0]?.id ?? "missing:M06";
    conflicts.push(
      mismatch(
        "m08_trigger_mismatch",
        [notice.id, anchor],
        `Notification ${notice.id} triggers on ${trigger}, which is not a state transition in M06.`,
        `The trigger ${trigger} never occurs in the state machine, so the notification cannot fire.`,
      ),
    );
  }
  return conflicts;
}

function mismatch(ruleId: string, nodeIds: readonly string[], plain: string, example: string): ConflictDraft {
  return {
    id: makeConflictId(3, ruleId, nodeIds),
    layer: 3,
    nodeIds: [...nodeIds].sort(),
    ruleId,
    plainEnglishConflict: plain,
    concreteCounterexample: example,
    resolutionOptions: buildResolutionOptions(nodeIds, []),
  };
}
