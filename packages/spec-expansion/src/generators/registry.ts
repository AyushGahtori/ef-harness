import { evaluateApplicability } from "./applicability.js";
import { assertNoHallucinatedAxes, createDomainIndex, generateMatrix } from "./enumerate.js";
import { LocalKnowledgeGraphPort } from "./knowledge-graph-port.js";
import { LocalReadinessCalculator } from "./readiness-port.js";
import {
  assertKnownGraph,
  type GenerationRun,
  type MatrixId,
  MATRIX_IDS,
  type MatrixSlice,
  type RawMatrixCell,
  type SettledProjectGraph,
} from "./types.js";

/**
 * Deterministic generators for all 12 spec-expansion matrices.
 * `llmCalls` stays 0. There is no model adapter on this path.
 */
export class MatrixGeneratorRegistry {
  readonly llmCalls = 0 as const;

  constructor(private readonly readiness = new LocalReadinessCalculator()) {}

  generate(graph: SettledProjectGraph): GenerationRun {
    assertKnownGraph(graph);
    const snapshot = this.readiness.calculate(graph.readiness);
    const knowledge = new LocalKnowledgeGraphPort(graph);
    const settled = knowledge.listSettledAxes();
    for (const node of settled) {
      if (!knowledge.getNode(node.nodeId)) {
        throw new Error(`settled axis ${node.nodeId} disappeared from the knowledge port`);
      }
    }
    const applicability = evaluateApplicability(graph, settled);
    const matrices: MatrixSlice[] = [];
    const rawCells: RawMatrixCell[] = [];
    const domains = createDomainIndex();
    for (const matrixId of MATRIX_IDS) {
      const decision = applicability[MATRIX_IDS.indexOf(matrixId)];
      if (!decision || decision.matrixId !== matrixId) {
        throw new Error(`missing applicability for ${matrixId}`);
      }
      const cells = generateMatrix(matrixId, graph, settled, decision, domains);
      matrices.push({ matrixId, applicability: decision, cells });
      for (const cell of cells) rawCells.push(cell);
    }
    assertNoHallucinatedAxes(settled, rawCells);
    return {
      llmCalls: this.llmCalls,
      readinessReady: snapshot.isReadyToPlan,
      applicability,
      matrices,
      rawCells,
      domains: domains.freeze(),
    };
  }
}

export function matrixIds(): readonly MatrixId[] {
  return MATRIX_IDS;
}
