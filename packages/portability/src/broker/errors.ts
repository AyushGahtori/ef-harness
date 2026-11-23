export class BrokerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
  }
}

export class InsufficientGrantPoolError extends BrokerError {
  constructor(connectionId: string, requested: number, available: number) {
    super(
      "insufficient_pool",
      `Connection ${connectionId}: requested ${requested} but only ${available} remains in the shared pool.`,
    );
  }
}

export class PortLeaseCollisionError extends BrokerError {
  constructor(port: number, projectId: string) {
    super("port_collision", `Port ${port} is already leased to project ${projectId}.`);
  }
}

export class PortOutOfRangeError extends BrokerError {
  constructor(port: number) {
    super("port_out_of_range", `Port ${port} is outside the global lease range 41000–48999.`);
  }
}

export class MachineCapacityExceededError extends BrokerError {
  constructor(kind: "pool2" | "heavy_lane" | "session_process") {
    super("capacity_exceeded", `Machine-wide ${kind} capacity is already saturated.`);
  }
}