export type Xfs4IotFailureClassification =
  | "safe-to-retry"
  | "known"
  | "indeterminate";

export type Xfs4IotFailurePhase =
  | "connect"
  | "send"
  | "response"
  | "protocol"
  | "cancel"
  | "shutdown";

export type Xfs4IotClientErrorOptions = {
  code:
    | "ABORTED"
    | "ACKNOWLEDGE_REJECTED"
    | "CLIENT_CLOSED"
    | "CONNECTION_FAILED"
    | "CONNECTION_LOST"
    | "DEADLINE_EXCEEDED"
    | "PENDING_LIMIT_EXCEEDED"
    | "PROTOCOL_ERROR"
    | "SEND_FAILED";
  classification: Xfs4IotFailureClassification;
  phase: Xfs4IotFailurePhase;
  requestId?: number;
  commandName?: string;
  requestSent: boolean;
  cause?: unknown;
};

export class Xfs4IotClientError extends Error {
  readonly code: Xfs4IotClientErrorOptions["code"];
  readonly classification: Xfs4IotFailureClassification;
  readonly phase: Xfs4IotFailurePhase;
  readonly requestId?: number;
  readonly commandName?: string;
  readonly requestSent: boolean;

  constructor(message: string, options: Xfs4IotClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "Xfs4IotClientError";
    this.code = options.code;
    this.classification = options.classification;
    this.phase = options.phase;
    this.requestId = options.requestId;
    this.commandName = options.commandName;
    this.requestSent = options.requestSent;
  }
}

export function classifyTransportFailure(
  requestSent: boolean,
  stateChanging: boolean
): Xfs4IotFailureClassification {
  return requestSent && stateChanging ? "indeterminate" : "safe-to-retry";
}
