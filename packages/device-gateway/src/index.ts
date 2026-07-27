import type {
  AdapterOperationContext,
  AdapterResult,
  CardReaderAdapter,
  CashAcceptorAdapter,
  CashDispenserAdapter,
  JsonValue,
  ReceiptPrinterAdapter,
  ReceiptPrinterStatus,
  TerminalAdapters
} from "../../runtime-contracts/src/index.js";

export type DeviceGatewayCommandName =
  | "getStatus"
  | "printReceipt"
  | "dispense"
  | "accept"
  | "readCard";

export type DeviceGatewayRequest = {
  requestId: string;
  serviceId: string;
  command: string;
  payload: Record<string, JsonValue>;
  correlation?: {
    operationId: string;
    sessionId: string;
    transactionName?: string;
    deadlineAt: string;
  };
};

export type DeviceGatewayTransport = {
  exchange(
    request: DeviceGatewayRequest,
    context?: AdapterOperationContext
  ): Promise<unknown>;
};

export type DeviceGatewayBinding = {
  adapterId: string;
  serviceId: string;
  capabilities?: readonly string[];
  commands?: Partial<Record<DeviceGatewayCommandName, string>>;
};

export type DeviceGatewayOptions = {
  transport: DeviceGatewayTransport;
  bindings: {
    receiptPrinter: DeviceGatewayBinding;
    cashDispenser: DeviceGatewayBinding;
    cashAcceptor: DeviceGatewayBinding;
    cardReader: DeviceGatewayBinding;
  };
  nextRequestId?: () => string;
};

export type DeviceGatewayAdapters = Pick<
  TerminalAdapters,
  "receiptPrinter" | "cashDispenser" | "cashAcceptor" | "cardReader"
>;

type ParsedGatewayResponse = {
  ok: boolean;
  code: string;
  message: string;
  details?: Record<string, JsonValue>;
};

const defaultCommands: Record<DeviceGatewayCommandName, string> = {
  getStatus: "status",
  printReceipt: "print",
  dispense: "dispense",
  accept: "accept",
  readCard: "read"
};

export class DeviceGatewayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceGatewayProtocolError";
  }
}

export class DeviceGatewayClient {
  private readonly transport: DeviceGatewayTransport;
  private readonly nextRequestId: () => string;

  constructor(options: Pick<DeviceGatewayOptions, "transport" | "nextRequestId">) {
    this.transport = options.transport;
    this.nextRequestId = options.nextRequestId ?? defaultRequestId;
  }

  async execute(
    binding: DeviceGatewayBinding,
    commandName: DeviceGatewayCommandName,
    payload: Record<string, JsonValue>,
    context?: AdapterOperationContext
  ): Promise<ParsedGatewayResponse> {
    context?.signal.throwIfAborted();
    const requestId = this.nextRequestId().trim();
    if (!requestId) {
      throw new DeviceGatewayProtocolError("Device request id cannot be empty.");
    }
    const request: DeviceGatewayRequest = {
      requestId,
      serviceId: binding.serviceId,
      command: binding.commands?.[commandName] ?? defaultCommands[commandName],
      payload,
      correlation: context
        ? {
            operationId: context.operationId,
            sessionId: context.sessionId,
            transactionName: context.transactionName,
            deadlineAt: context.deadlineAt
          }
        : undefined
    };
    const response = await this.transport.exchange(request, context);
    context?.signal.throwIfAborted();
    return parseGatewayResponse(response, requestId);
  }
}

export class GatewayReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly id: string;
  readonly kind = "receipt-printer" as const;
  readonly capabilities: readonly string[];

  constructor(
    private readonly client: DeviceGatewayClient,
    private readonly binding: DeviceGatewayBinding
  ) {
    validateBinding(binding, "receipt printer");
    this.id = binding.adapterId;
    this.capabilities = capabilities(["status", "print"], binding.capabilities);
  }

  async getStatus(
    context?: AdapterOperationContext
  ): Promise<ReceiptPrinterStatus> {
    const response = await this.client.execute(
      this.binding,
      "getStatus",
      {},
      context
    );
    if (!response.ok) {
      throw new DeviceGatewayProtocolError(
        `Receipt printer status failed with ${response.code}: ${response.message}`
      );
    }
    const health = response.details?.health;
    const paper = response.details?.paper;
    if (!isDeviceHealth(health) || !isPaperStatus(paper)) {
      throw new DeviceGatewayProtocolError(
        "Receipt printer status requires valid health and paper details."
      );
    }
    return { health, paper };
  }

  async printReceipt(
    lines: string[],
    context?: AdapterOperationContext
  ): Promise<AdapterResult> {
    validateReceiptLines(lines);
    return this.client.execute(
      this.binding,
      "printReceipt",
      { lines },
      context
    );
  }
}

export class GatewayCashDispenserAdapter implements CashDispenserAdapter {
  readonly id: string;
  readonly kind = "cash-dispenser" as const;
  readonly capabilities: readonly string[];

  constructor(
    private readonly client: DeviceGatewayClient,
    private readonly binding: DeviceGatewayBinding
  ) {
    validateBinding(binding, "cash dispenser");
    this.id = binding.adapterId;
    this.capabilities = capabilities(["dispense"], binding.capabilities);
  }

  async dispense(
    input: { amount: number; currencyCode: string },
    context?: AdapterOperationContext
  ): Promise<AdapterResult> {
    validatePositiveAmount(input.amount, "Dispense");
    validateCurrencyCode(input.currencyCode);
    return this.client.execute(
      this.binding,
      "dispense",
      input,
      context
    );
  }
}

export class GatewayCashAcceptorAdapter implements CashAcceptorAdapter {
  readonly id: string;
  readonly kind = "cash-acceptor" as const;
  readonly capabilities: readonly string[];

  constructor(
    private readonly client: DeviceGatewayClient,
    private readonly binding: DeviceGatewayBinding
  ) {
    validateBinding(binding, "cash acceptor");
    this.id = binding.adapterId;
    this.capabilities = capabilities(["accept"], binding.capabilities);
  }

  async accept(
    input: { expectedAmount?: number; currencyCode: string },
    context?: AdapterOperationContext
  ): Promise<AdapterResult> {
    if (input.expectedAmount !== undefined) {
      validatePositiveAmount(input.expectedAmount, "Expected deposit");
    }
    validateCurrencyCode(input.currencyCode);
    return this.client.execute(
      this.binding,
      "accept",
      {
        expectedAmount: input.expectedAmount ?? null,
        currencyCode: input.currencyCode
      },
      context
    );
  }
}

export class GatewayCardReaderAdapter implements CardReaderAdapter {
  readonly id: string;
  readonly kind = "card-reader" as const;
  readonly capabilities: readonly string[];

  constructor(
    private readonly client: DeviceGatewayClient,
    private readonly binding: DeviceGatewayBinding
  ) {
    validateBinding(binding, "card reader");
    this.id = binding.adapterId;
    this.capabilities = capabilities(["read"], binding.capabilities);
  }

  async readCard(
    context?: AdapterOperationContext
  ): Promise<AdapterResult> {
    return this.client.execute(this.binding, "readCard", {}, context);
  }
}

export function createDeviceGatewayAdapters(
  options: DeviceGatewayOptions
): DeviceGatewayAdapters {
  validateUniqueBindings(options.bindings);
  const client = new DeviceGatewayClient(options);
  return {
    receiptPrinter: new GatewayReceiptPrinterAdapter(
      client,
      options.bindings.receiptPrinter
    ),
    cashDispenser: new GatewayCashDispenserAdapter(
      client,
      options.bindings.cashDispenser
    ),
    cashAcceptor: new GatewayCashAcceptorAdapter(
      client,
      options.bindings.cashAcceptor
    ),
    cardReader: new GatewayCardReaderAdapter(
      client,
      options.bindings.cardReader
    )
  };
}

function parseGatewayResponse(
  value: unknown,
  expectedRequestId: string
): ParsedGatewayResponse {
  if (!isRecord(value)) {
    throw new DeviceGatewayProtocolError(
      "Device gateway response must be an object."
    );
  }
  if (value.requestId !== expectedRequestId) {
    throw new DeviceGatewayProtocolError(
      `Device gateway response id does not match ${expectedRequestId}.`
    );
  }
  if (
    typeof value.ok !== "boolean" ||
    typeof value.code !== "string" ||
    !value.code.trim() ||
    typeof value.message !== "string" ||
    !value.message.trim()
  ) {
    throw new DeviceGatewayProtocolError(
      "Device gateway response requires ok, code, and message."
    );
  }
  if (value.details !== undefined && !isJsonRecord(value.details)) {
    throw new DeviceGatewayProtocolError(
      "Device gateway response details must contain JSON values."
    );
  }
  return {
    ok: value.ok,
    code: value.code,
    message: value.message,
    details: value.details
  };
}

function validateBinding(binding: DeviceGatewayBinding, label: string): void {
  if (!binding.adapterId.trim()) {
    throw new Error(`${label} adapterId is required.`);
  }
  if (!binding.serviceId.trim()) {
    throw new Error(`${label} serviceId is required.`);
  }
  for (const command of Object.values(binding.commands ?? {})) {
    if (!command.trim()) {
      throw new Error(`${label} command names cannot be empty.`);
    }
  }
}

function validateUniqueBindings(
  bindings: DeviceGatewayOptions["bindings"]
): void {
  const adapterIds = Object.values(bindings).map((binding) =>
    binding.adapterId.trim()
  );
  if (new Set(adapterIds).size !== adapterIds.length) {
    throw new Error("Device gateway adapter ids must be unique.");
  }
}

function capabilities(
  required: readonly string[],
  configured: readonly string[] = []
): readonly string[] {
  return [...new Set([...required, ...configured])];
}

function validatePositiveAmount(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${label} amount must be a positive safe integer.`);
  }
}

function validateCurrencyCode(currencyCode: string): void {
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("Currency code must contain three uppercase letters.");
  }
}

function validateReceiptLines(lines: string[]): void {
  if (lines.length === 0 || lines.length > 100) {
    throw new Error("Receipt must contain between 1 and 100 lines.");
  }
  if (
    lines.some(
      (line) =>
        line.length > 512 || /[\u0000-\u001F\u007F-\u009F]/.test(line)
    )
  ) {
    throw new Error(
      "Receipt lines must exclude control characters and contain at most 512 characters."
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

function isJsonValue(
  value: unknown,
  depth = 0,
  seen = new Set<object>()
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || depth >= 20 || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, depth + 1, seen))
    : isRecord(value) &&
      Object.values(value).every((item) =>
        isJsonValue(item, depth + 1, seen)
      );
  seen.delete(value);
  return valid;
}

function isDeviceHealth(
  value: JsonValue | undefined
): value is ReceiptPrinterStatus["health"] {
  return (
    typeof value === "string" &&
    ["HEALTHY", "DEGRADED", "FATAL", "MISSING"].includes(value)
  );
}

function isPaperStatus(
  value: JsonValue | undefined
): value is ReceiptPrinterStatus["paper"] {
  return (
    typeof value === "string" && ["OK", "LOW", "OUT"].includes(value)
  );
}

function defaultRequestId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new DeviceGatewayProtocolError(
      "A cryptographic request id generator is required."
    );
  }
  return `device-${globalThis.crypto.randomUUID()}`;
}
