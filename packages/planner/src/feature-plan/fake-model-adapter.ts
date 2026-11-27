import {
  deterministicFeaturePlan,
  deterministicOracle,
  deterministicOracleRepair,
} from "./deterministic-model.js";
import type { ModelRequest, PlannerOracleModel } from "./types.js";

/**
 * Offline model double. Scripted payloads win; otherwise planning and
 * oracle authoring are deterministic functions of the requirement input.
 */
export class FakeModelAdapter implements PlannerOracleModel {
  readonly calls: ModelRequest[] = [];
  private readonly plannerScripts: unknown[] = [];
  private readonly oracleScripts: unknown[] = [];
  private readonly repairScripts: unknown[] = [];

  pushPlanner(output: unknown): void {
    this.plannerScripts.push(output);
  }

  pushOracle(output: unknown): void {
    this.oracleScripts.push(output);
  }

  pushRepair(output: unknown): void {
    this.repairScripts.push(output);
  }

  complete(request: ModelRequest): unknown {
    this.calls.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    if (request.repair) {
      const scripted = this.repairScripts.shift();
      return scripted !== undefined ? scripted : deterministicOracleRepair(request.input);
    }
    if (request.role === "feature-planner@1") {
      const scripted = this.plannerScripts.shift();
      return scripted !== undefined ? scripted : deterministicFeaturePlan(request.input);
    }
    const scripted = this.oracleScripts.shift();
    return scripted !== undefined ? scripted : deterministicOracle(request.input);
  }
}
