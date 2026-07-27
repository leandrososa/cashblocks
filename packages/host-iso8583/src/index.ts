import type {
  AdapterOperationContext,
  AdapterResult,
  HostAuthorizationAdapter,
  HostAuthorizationRequest,
  JsonValue
} from "../../runtime-contracts/src/index.js";

export type Iso8583SupportedField = 2 | 3 | 4 | 7 | 11 | 39 | 41 | 49;

export type Iso8583Message = {
  mti: string;
  fields: Partial<Record<Iso8583SupportedField, string>>;
};

export type Iso8583Transport = {
  exchange(message: string, context?: AdapterOperationContext): Promise<string>;
};

export type Iso8583HostAdapterOptions = {
  id?: string;
  terminalId: string;
  transport: Iso8583Transport;
  currencyNumericCodes: Record<string, string>;
  minorUnitScales: Record<string, number>;
  processingCodes?: Record<string, string>;
  responseCodeMap?: Record<string, HostResponseCategory>;
  now?: () => Date;
  nextTrace?: () => number;
};

export type HostResponseCategory =
  | "approved"
  | "declined"
  | "retryable"
  | "error";

type FieldSpec = {
  format: "fixed" | "llvar";
  length: number;
  numeric: boolean;
};

const supportedFields: readonly Iso8583SupportedField[] = [
  2,
  3,
  4,
  7,
  11,
  39,
  41,
  49
];

const fieldSpecs: Record<Iso8583SupportedField, FieldSpec> = {
  2: { format: "llvar", length: 19, numeric: true },
  3: { format: "fixed", length: 6, numeric: true },
  4: { format: "fixed", length: 12, numeric: true },
  7: { format: "fixed", length: 10, numeric: true },
  11: { format: "fixed", length: 6, numeric: true },
  39: { format: "fixed", length: 2, numeric: true },
  41: { format: "fixed", length: 8, numeric: false },
  49: { format: "fixed", length: 3, numeric: true }
};

export function encodeIso8583(message: Iso8583Message): string {
  validateMti(message.mti);
  const presentFields = supportedFields.filter(
    (field) => message.fields[field] !== undefined
  );
  let bitmap = 0n;
  for (const field of presentFields) {
    bitmap |= 1n << BigInt(64 - field);
  }

  const body = presentFields
    .map((field) => encodeField(field, message.fields[field] ?? ""))
    .join("");
  return `${message.mti}${bitmap.toString(16).toUpperCase().padStart(16, "0")}${body}`;
}

export function decodeIso8583(payload: string): Iso8583Message {
  if (payload.length < 20) {
    throw new Error("ISO8583 payload is shorter than MTI and primary bitmap.");
  }
  const mti = payload.slice(0, 4);
  validateMti(mti);
  const bitmapText = payload.slice(4, 20);
  if (!/^[0-9A-Fa-f]{16}$/.test(bitmapText)) {
    throw new Error("ISO8583 primary bitmap must be 16 hexadecimal characters.");
  }
  const bitmap = BigInt(`0x${bitmapText}`);
  if (hasBitmapField(bitmap, 1)) {
    throw new Error("ISO8583 secondary bitmaps are not supported.");
  }

  const fields: Partial<Record<Iso8583SupportedField, string>> = {};
  let offset = 20;
  for (let field = 2; field <= 64; field += 1) {
    if (!hasBitmapField(bitmap, field)) {
      continue;
    }
    if (!isSupportedField(field)) {
      throw new Error(`ISO8583 field ${field} is not supported.`);
    }
    const decoded = decodeField(field, payload, offset);
    fields[field] = decoded.value;
    offset = decoded.offset;
  }
  if (offset !== payload.length) {
    throw new Error("ISO8583 payload contains trailing data.");
  }
  return { mti, fields };
}

export class Iso8583HostAuthorizationAdapter implements HostAuthorizationAdapter {
  readonly id: string;
  readonly kind = "host-authorization" as const;
  readonly capabilities = ["authorize"] as const;
  private trace = 0;
  private readonly terminalId: string;
  private readonly transport: Iso8583Transport;
  private readonly currencyNumericCodes: Record<string, string>;
  private readonly minorUnitScales: Record<string, number>;
  private readonly processingCodes: Record<string, string>;
  private readonly responseCodeMap: Record<string, HostResponseCategory>;
  private readonly now: () => Date;
  private readonly nextTrace: () => number;

  constructor(options: Iso8583HostAdapterOptions) {
    this.id = options.id ?? "iso8583-host";
    this.terminalId = normalizeTerminalId(options.terminalId);
    this.transport = options.transport;
    this.currencyNumericCodes = { ...options.currencyNumericCodes };
    this.minorUnitScales = { ...options.minorUnitScales };
    this.processingCodes = {
      BalanceInquiry: "310000",
      CardlessCashWithdrawal: "010000",
      CashDeposit: "210000",
      CashWithdrawal: "010000",
      FastCash: "010000",
      ...(options.processingCodes ?? {})
    };
    for (const [transaction, code] of Object.entries(this.processingCodes)) {
      if (!transaction.trim() || !/^\d{6}$/.test(code)) {
        throw new Error(
          "processingCodes must map non-empty transaction names to six digits."
        );
      }
    }
    this.responseCodeMap = {
      "00": "approved",
      "05": "declined",
      "12": "declined",
      "13": "declined",
      "14": "declined",
      "51": "declined",
      "54": "declined",
      "55": "declined",
      "57": "declined",
      "61": "declined",
      "62": "declined",
      "65": "declined",
      "68": "retryable",
      "75": "declined",
      "91": "retryable",
      "96": "retryable",
      ...(options.responseCodeMap ?? {})
    };
    for (const [code, category] of Object.entries(this.responseCodeMap)) {
      if (!/^\d{2}$/.test(code) || !isResponseCategory(category)) {
        throw new Error(
          "responseCodeMap must map two digits to a valid response category."
        );
      }
    }
    if (this.responseCodeMap["00"] !== "approved") {
      throw new Error("ISO8583 response code 00 must remain approved.");
    }
    for (const [currency, numericCode] of Object.entries(
      this.currencyNumericCodes
    )) {
      if (!currency.trim() || !/^\d{3}$/.test(numericCode)) {
        throw new Error(
          "currencyNumericCodes must map non-empty currency codes to three digits."
        );
      }
      const scale = this.minorUnitScales[currency];
      if (
        !Number.isSafeInteger(scale) ||
        scale <= 0 ||
        !isPowerOfTen(scale)
      ) {
        throw new Error(
          `minorUnitScales must define a positive power of ten for ${currency}.`
        );
      }
    }
    for (const currency of Object.keys(this.minorUnitScales)) {
      if (!this.currencyNumericCodes[currency]) {
        throw new Error(
          `minorUnitScales contains unconfigured currency ${currency}.`
        );
      }
    }
    this.now = options.now ?? (() => new Date());
    this.nextTrace =
      options.nextTrace ??
      (() => {
        this.trace = (this.trace % 999_999) + 1;
        return this.trace;
      });
  }

  async authorize(
    request: HostAuthorizationRequest,
    context?: AdapterOperationContext
  ): Promise<AdapterResult> {
    context?.signal.throwIfAborted();
    const requestMessage = this.createAuthorizationRequest(request);
    const requestPayload = encodeIso8583(requestMessage);
    const responsePayload = await this.transport.exchange(requestPayload, context);
    context?.signal.throwIfAborted();

    let response: Iso8583Message;
    try {
      response = decodeIso8583(responsePayload);
    } catch (error) {
      return protocolFailure(
        error instanceof Error ? error.message : String(error),
        context
      );
    }

    const trace = requestMessage.fields[11];
    if (
      response.mti !== "0110" ||
      !response.fields[39] ||
      response.fields[11] !== trace
    ) {
      return protocolFailure(
        "ISO8583 response MTI, response code, or trace is invalid.",
        context
      );
    }

    const responseCode = response.fields[39];
    const details: Record<string, JsonValue> = {
      responseCode,
      trace: trace ?? "",
      operationId: context?.operationId ?? null
    };
    const category = this.responseCodeMap[responseCode] ?? "error";
    details.category = category;
    details.retryable = category === "retryable";
    if (category === "approved") {
      return {
        ok: true,
        code: "HOST_APPROVED",
        message: "ISO8583 host approved transaction.",
        details
      };
    }
    if (category === "declined") {
      return {
        ok: false,
        code: "HOST_DECLINED",
        message: `ISO8583 host declined transaction with response code ${responseCode}.`,
        details
      };
    }
    if (category === "retryable") {
      return {
        ok: false,
        code: "HOST_UNAVAILABLE",
        message: `ISO8583 host returned retryable response code ${responseCode}.`,
        details
      };
    }
    return {
      ok: false,
      code: "HOST_RESPONSE_ERROR",
      message: `ISO8583 host returned unclassified response code ${responseCode}.`,
      details
    };
  }

  private createAuthorizationRequest(
    request: HostAuthorizationRequest
  ): Iso8583Message {
    const currencyCode = this.currencyNumericCodes[request.currencyCode];
    if (!currencyCode) {
      throw new Error(`No ISO8583 numeric code configured for ${request.currencyCode}.`);
    }
    const amount = request.amount ?? 0;
    const minorAmount = toMinorUnits(
      amount,
      this.minorUnitScales[request.currencyCode]
    );
    const trace = this.nextTrace();
    if (!Number.isSafeInteger(trace) || trace < 1 || trace > 999_999) {
      throw new Error("ISO8583 trace must be between 1 and 999999.");
    }

    return {
      mti: "0100",
      fields: {
        3: this.processingCode(request.transaction),
        4: String(minorAmount).padStart(12, "0"),
        7: transmissionDateTime(this.now()),
        11: String(trace).padStart(6, "0"),
        41: this.terminalId,
        49: currencyCode
      }
    };
  }

  private processingCode(transaction: string): string {
    const code = this.processingCodes[transaction];
    if (!code) {
      throw new Error(
        `No ISO8583 processing code configured for transaction ${transaction}.`
      );
    }
    return code;
  }
}

function encodeField(field: Iso8583SupportedField, value: string): string {
  const spec = fieldSpecs[field];
  validateFieldValue(field, value, spec);
  if (spec.format === "llvar") {
    return `${String(value.length).padStart(2, "0")}${value}`;
  }
  if (value.length !== spec.length) {
    throw new Error(`ISO8583 field ${field} must have length ${spec.length}.`);
  }
  return value;
}

function decodeField(
  field: Iso8583SupportedField,
  payload: string,
  offset: number
): { value: string; offset: number } {
  const spec = fieldSpecs[field];
  let length = spec.length;
  let valueOffset = offset;
  if (spec.format === "llvar") {
    const prefix = payload.slice(offset, offset + 2);
    if (!/^\d{2}$/.test(prefix)) {
      throw new Error(`ISO8583 field ${field} has an invalid LLVAR prefix.`);
    }
    length = Number(prefix);
    valueOffset += 2;
    if (length > spec.length) {
      throw new Error(`ISO8583 field ${field} exceeds maximum length ${spec.length}.`);
    }
  }
  const value = payload.slice(valueOffset, valueOffset + length);
  if (value.length !== length) {
    throw new Error(`ISO8583 field ${field} is truncated.`);
  }
  validateFieldValue(field, value, { ...spec, length });
  return { value, offset: valueOffset + length };
}

function validateFieldValue(
  field: Iso8583SupportedField,
  value: string,
  spec: FieldSpec
): void {
  if (value.length > spec.length) {
    throw new Error(`ISO8583 field ${field} exceeds maximum length ${spec.length}.`);
  }
  if (spec.numeric && !/^\d+$/.test(value)) {
    throw new Error(`ISO8583 field ${field} must be numeric.`);
  }
  if (!spec.numeric && !/^[\x20-\x7E]+$/.test(value)) {
    throw new Error(`ISO8583 field ${field} must contain printable ASCII.`);
  }
}

function hasBitmapField(bitmap: bigint, field: number): boolean {
  return (bitmap & (1n << BigInt(64 - field))) !== 0n;
}

function isSupportedField(field: number): field is Iso8583SupportedField {
  return (supportedFields as readonly number[]).includes(field);
}

function validateMti(mti: string): void {
  if (!/^\d{4}$/.test(mti)) {
    throw new Error("ISO8583 MTI must contain four digits.");
  }
}

function normalizeTerminalId(terminalId: string): string {
  const normalized = terminalId.trim().toUpperCase();
  if (!/^[\x20-\x7E]{1,8}$/.test(normalized)) {
    throw new Error("terminalId must contain 1 to 8 printable ASCII characters.");
  }
  return normalized.padEnd(8, " ");
}

function transmissionDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("ISO8583 transmission date is invalid.");
  }
  return [
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
}

function toMinorUnits(amount: number, scale: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("ISO8583 amount must be a finite non-negative number.");
  }
  const decimalPlaces = Math.round(Math.log10(scale));
  const scaledAmount = amount * scale;
  const minorAmount = Math.round(scaledAmount);
  const tolerance = unitInLastPlace(scaledAmount);
  if (Math.abs(scaledAmount - minorAmount) > tolerance) {
    throw new Error(
      `ISO8583 amount has more than ${decimalPlaces} decimal places.`
    );
  }
  if (
    !Number.isSafeInteger(minorAmount) ||
    minorAmount > 999_999_999_999
  ) {
    throw new Error("ISO8583 amount is outside the supported 12-digit range.");
  }
  return minorAmount;
}

function unitInLastPlace(value: number): number {
  if (value === 0) {
    return Number.MIN_VALUE;
  }
  return 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52);
}

function isPowerOfTen(value: number): boolean {
  const exponent = Math.log10(value);
  return Number.isInteger(exponent);
}

function isResponseCategory(value: string): value is HostResponseCategory {
  return ["approved", "declined", "retryable", "error"].includes(value);
}

function protocolFailure(
  message: string,
  context?: AdapterOperationContext
): AdapterResult {
  return {
    ok: false,
    code: "HOST_PROTOCOL_ERROR",
    message,
    details: {
      operationId: context?.operationId ?? null
    }
  };
}
