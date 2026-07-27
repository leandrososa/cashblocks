import { createHash } from "node:crypto";

import type {
  JsonValue,
  RuntimeEvent,
  RuntimeEventType
} from "../../runtime-contracts/src/index.js";
import { inspectJournalText } from "../../journal-replay/src/index.js";

export type RecoveryAction =
  | "none"
  | "safe_retry"
  | "reverse_authorization"
  | "manual_reconciliation"
  | "operator_review";

export type CertificationSummary = {
  status: "completed" | "failed" | "cancelled" | "idle";
  failureCode?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  terminalCashBefore?: number;
  terminalCashAfter?: number;
};

export type CertificationExecution = {
  summary: CertificationSummary;
  events: RuntimeEvent[];
};

export type FinancialExpectation = {
  balanceDelta?: number;
  terminalCashDelta?: number;
};

export type CertificationExpectation = {
  status: CertificationSummary["status"];
  failureCode?: string;
  recovery: RecoveryAction;
  requiredEvents?: readonly RuntimeEventType[];
  forbiddenEvents?: readonly RuntimeEventType[];
  financial?: FinancialExpectation;
};

export type CertificationScenario<Request> = {
  id: string;
  description: string;
  request: Request;
  expected: CertificationExpectation;
};

export type CertificationCheck = {
  id: string;
  passed: boolean;
  expected: JsonValue;
  actual: JsonValue;
  message: string;
};

export type CertificationCaseResult = {
  scenarioId: string;
  description: string;
  passed: boolean;
  outcome: CertificationSummary["status"] | "execution_error";
  recovery: RecoveryAction;
  checks: CertificationCheck[];
  evidence: {
    digest: string;
    eventCount: number;
    journalValid: boolean;
    journalIssueCodes: string[];
  };
};

export type CertificationReport = {
  schemaVersion: 1;
  suiteId: string;
  profileId: string;
  reportId: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  totals: {
    scenarios: number;
    passed: number;
    failed: number;
  };
  cases: CertificationCaseResult[];
};

export type CertificationSuiteOptions<Request> = {
  suiteId: string;
  profileId: string;
  scenarios: readonly CertificationScenario<Request>[];
  execute(request: Request): Promise<CertificationExecution>;
  now?: () => Date;
  maxScenarios?: number;
  maxEventsPerScenario?: number;
  maxJournalBytes?: number;
  maxEvidenceBytes?: number;
};

const scenarioIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const recoveryCodes = new Set([
  "ACCEPTOR_OFFLINE",
  "ACCEPTOR_UNAVAILABLE",
  "CARD_READER_OFFLINE",
  "CARD_READER_UNAVAILABLE",
  "DISPENSER_OFFLINE",
  "DISPENSER_UNAVAILABLE",
  "HOST_UNAVAILABLE",
  "RECEIPT_PRINTER_OFFLINE",
  "RECEIPT_PRINTER_UNAVAILABLE"
]);

export async function runCertificationSuite<Request>(
  options: CertificationSuiteOptions<Request>
): Promise<CertificationReport> {
  const maxScenarios = positiveInteger(options.maxScenarios ?? 100, "maxScenarios");
  const maxEvents = positiveInteger(
    options.maxEventsPerScenario ?? 100_000,
    "maxEventsPerScenario"
  );
  const maxJournalBytes = positiveInteger(
    options.maxJournalBytes ?? 10 * 1024 * 1024,
    "maxJournalBytes"
  );
  const maxEvidenceBytes = positiveInteger(
    options.maxEvidenceBytes ?? 10 * 1024 * 1024,
    "maxEvidenceBytes"
  );
  validateSuite(
    options.suiteId,
    options.profileId,
    options.scenarios,
    maxScenarios,
    maxEvidenceBytes
  );
  const now = options.now ?? (() => new Date());
  const startedAt = validTimestamp(now(), "startedAt");
  const cases: CertificationCaseResult[] = [];

  for (const scenario of options.scenarios) {
    cases.push(
      await runScenario(
        scenario,
        options.execute,
        maxEvents,
        maxJournalBytes,
        maxEvidenceBytes
      )
    );
  }

  const finishedAt = validTimestamp(now(), "finishedAt");
  const passed = cases.filter((result) => result.passed).length;
  const reportIdentity = {
    schemaVersion: 1,
    suiteId: options.suiteId,
    profileId: options.profileId,
    cases: cases.map((result) => ({
      scenarioId: result.scenarioId,
      passed: result.passed,
      recovery: result.recovery,
      checks: result.checks,
      evidenceDigest: result.evidence.digest
    }))
  };

  return {
    schemaVersion: 1,
    suiteId: options.suiteId,
    profileId: options.profileId,
    reportId: `sha256:${digest(reportIdentity, 10 * 1024 * 1024)}`,
    startedAt,
    finishedAt,
    passed: passed === cases.length,
    totals: {
      scenarios: cases.length,
      passed,
      failed: cases.length - passed
    },
    cases
  };
}

export function classifyRecovery(execution: CertificationExecution): RecoveryAction {
  if (
    execution.events.some(
      (event) => event.type === "transaction.reconciliation_required"
    )
  ) {
    return "manual_reconciliation";
  }
  if (
    pendingAuthorizationTransactions(execution.events).size > 0
  ) {
    return "manual_reconciliation";
  }
  const outcome = journalOutcome(execution.events);
  const failureCode = terminalFailureCode(execution.events);
  if (
    outcome === "completed" ||
    outcome === "cancelled" ||
    failureCode === "HOST_DECLINED"
  ) {
    return "none";
  }
  const occurrence = lastTerminalOccurrence(execution.events);
  if (
    occurrence &&
    hasApprovedAuthorization(
      execution.events,
      occurrence.transaction,
      occurrence.startIndex,
      occurrence.terminalIndex
    )
  ) {
    return "reverse_authorization";
  }
  if (
    failureCode &&
    recoveryCodes.has(failureCode)
  ) {
    return "safe_retry";
  }
  return "operator_review";
}

async function runScenario<Request>(
  scenario: CertificationScenario<Request>,
  execute: (request: Request) => Promise<CertificationExecution>,
  maxEvents: number,
  maxJournalBytes: number,
  maxEvidenceBytes: number
): Promise<CertificationCaseResult> {
  const requestDigest = digest(scenario.request, maxEvidenceBytes);
  try {
    const execution = await execute(scenario.request);
    if (!Array.isArray(execution.events)) {
      throw new Error("Executor returned an invalid events collection.");
    }
    if (execution.events.length > maxEvents) {
      throw new Error(`Executor exceeded the ${maxEvents}-event scenario limit.`);
    }
    const journalText = serializeJournal(execution.events, maxJournalBytes);
    const journal = inspectJournalText(
      journalText,
      {
        mode: "strict",
        maxEvents,
        maxLines: maxEvents,
        maxIssues: 1_000,
        maxFileBytes: maxJournalBytes
      }
    );
    const recovery = classifyRecovery(execution);
    const checks = evaluateChecks(scenario.expected, execution, recovery);
    checks.push(
      check(
        "journal.valid",
        true,
        journal.valid,
        "Journal satisfies strict replay invariants."
      )
    );
    const evidence = {
      digest: digest(
        {
          requestDigest,
          events: execution.events.map(normalizeEvent),
          summary: normalizeSummary(execution.summary)
        },
        maxEvidenceBytes
      ),
      eventCount: execution.events.length,
      journalValid: journal.valid,
      journalIssueCodes: journal.issues.map((issue) => issue.code)
    };
    return {
      scenarioId: scenario.id,
      description: scenario.description,
      passed: checks.every((entry) => entry.passed),
      outcome: execution.summary.status,
      recovery,
      checks,
      evidence
    };
  } catch (error) {
    const rawMessage = errorMessage(error);
    const errorDigest = digestText(rawMessage);
    const message =
      Buffer.byteLength(rawMessage, "utf8") <= 4_096
        ? rawMessage
        : `Error message exceeded 4096 bytes (sha256:${errorDigest}).`;
    const failureCheck = check(
      "execution.completed",
      true,
      false,
      `Scenario executor failed: ${message}`
    );
    return {
      scenarioId: scenario.id,
      description: scenario.description,
      passed: false,
      outcome: "execution_error",
      recovery: "operator_review",
      checks: [failureCheck],
      evidence: {
        digest: digest(
          { scenarioId: scenario.id, requestDigest, errorDigest },
          64 * 1024
        ),
        eventCount: 0,
        journalValid: false,
        journalIssueCodes: ["EXECUTION_ERROR"]
      }
    };
  }
}

function evaluateChecks(
  expected: CertificationExpectation,
  execution: CertificationExecution,
  recovery: RecoveryAction
): CertificationCheck[] {
  const checks = [
    check(
      "outcome.status",
      expected.status,
      execution.summary.status,
      "Terminal outcome matches the conformance profile."
    ),
    check(
      "outcome.journal_status",
      expected.status,
      journalOutcome(execution.events),
      "Journal terminal outcome matches the conformance profile."
    ),
    check(
      "outcome.summary_matches_journal",
      journalOutcome(execution.events),
      execution.summary.status,
      "Summary and journal agree on the terminal outcome."
    ),
    check(
      "outcome.failure_summary_matches_journal",
      terminalFailureCode(execution.events) ?? null,
      execution.summary.failureCode ?? null,
      "Summary and journal agree on the failure code."
    ),
    check(
      "recovery.action",
      expected.recovery,
      recovery,
      "Recovery policy is deterministic for the observed evidence."
    )
  ];
  if (expected.failureCode !== undefined) {
    const journalCode = terminalFailureCode(execution.events) ?? null;
    checks.push(
      check(
        "outcome.failure_code",
        expected.failureCode,
        journalCode,
        "Journal failure code matches the expected operational outcome."
      )
    );
  }
  for (const type of expected.requiredEvents ?? []) {
    checks.push(
      check(
        `event.required.${type}`,
        true,
        execution.events.some((event) => event.type === type),
        `Required event ${type} is present.`
      )
    );
  }
  for (const type of expected.forbiddenEvents ?? []) {
    checks.push(
      check(
        `event.forbidden.${type}`,
        false,
        execution.events.some((event) => event.type === type),
        `Forbidden event ${type} is absent.`
      )
    );
  }
  if (expected.financial?.balanceDelta !== undefined) {
    const terminal = lastCompletedPayload(execution.events);
    checks.push(
      deltaCheck(
        "financial.balance_delta",
        expected.financial.balanceDelta,
        payloadNumber(terminal, "balanceBefore"),
        payloadNumber(terminal, "balanceAfter")
      ),
      check(
        "financial.balance_summary_matches_journal",
        financialPair(terminal, "balanceBefore", "balanceAfter"),
        financialPair(execution.summary, "balanceBefore", "balanceAfter"),
        "Summary and journal agree on the account balances."
      )
    );
  }
  if (expected.financial?.terminalCashDelta !== undefined) {
    const terminal = lastCompletedPayload(execution.events);
    checks.push(
      deltaCheck(
        "financial.terminal_cash_delta",
        expected.financial.terminalCashDelta,
        payloadNumber(terminal, "terminalCashBefore"),
        payloadNumber(terminal, "terminalCashAfter")
      ),
      check(
        "financial.terminal_cash_summary_matches_journal",
        financialPair(terminal, "terminalCashBefore", "terminalCashAfter"),
        financialPair(
          execution.summary,
          "terminalCashBefore",
          "terminalCashAfter"
        ),
        "Summary and journal agree on terminal cash."
      )
    );
  }
  return checks;
}

function deltaCheck(
  id: string,
  expected: number,
  before: number | undefined,
  after: number | undefined
): CertificationCheck {
  const actual =
    Number.isFinite(before) && Number.isFinite(after)
      ? Number(((after as number) - (before as number)).toFixed(10))
      : null;
  return check(id, expected, actual, `${id} matches the expected conservation rule.`);
}

function check(
  id: string,
  expected: JsonValue,
  actual: JsonValue,
  message: string
): CertificationCheck {
  return {
    id,
    passed: stableStringify(expected) === stableStringify(actual),
    expected,
    actual,
    message
  };
}

function hasApprovedAuthorization(
  events: readonly RuntimeEvent[],
  transaction: string,
  startIndex: number,
  terminalIndex: number
): boolean {
  return events
    .slice(startIndex, terminalIndex + 1)
    .some(
      (event) =>
      event.type === "host.authorization_result" &&
      event.payload?.transaction === transaction &&
      (event.payload?.ok === true || event.payload?.code === "HOST_APPROVED")
    );
}

function pendingAuthorizationTransactions(
  events: readonly RuntimeEvent[]
): ReadonlySet<string> {
  const pending = new Map<string, number>();
  for (const event of events) {
    const transaction = payloadString(event.payload, "transaction");
    if (!transaction) continue;
    const count = pending.get(transaction) ?? 0;
    if (event.type === "host.authorization_requested") {
      pending.set(transaction, count + 1);
    }
    if (event.type === "host.authorization_result" && count > 0) {
      if (count === 1) pending.delete(transaction);
      else pending.set(transaction, count - 1);
    }
  }
  return new Set(pending.keys());
}

function lastTerminalOccurrence(
  events: readonly RuntimeEvent[]
): { transaction: string; startIndex: number; terminalIndex: number } | undefined {
  const terminalTypes: readonly RuntimeEventType[] = [
    "transaction.completed",
    "transaction.cancelled",
    "transaction.failed",
    "transaction.reconciliation_required"
  ];
  let terminalIndex: number | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "flow.failed") {
      terminalIndex = previousTransactionTerminal(events, index);
      break;
    }
    if (terminalTypes.includes(event.type)) {
      terminalIndex = index;
      break;
    }
  }
  if (terminalIndex === undefined) return undefined;
  const terminal = events[terminalIndex]!;
  if (
    terminal.type === "transaction.completed" ||
    terminal.type === "transaction.cancelled"
  ) {
    return undefined;
  }
  const transaction = payloadString(terminal.payload, "transaction");
  if (!transaction) return undefined;
  for (let index = terminalIndex - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      terminalTypes.includes(event.type) &&
      payloadString(event.payload, "transaction") === transaction
    ) {
      return { transaction, startIndex: index + 1, terminalIndex };
    }
  }
  return { transaction, startIndex: 0, terminalIndex };
}

function normalizeEvent(event: RuntimeEvent): JsonValue {
  return {
    seq: event.seq,
    type: event.type,
    source: event.source,
    ...(event.payload ? { payload: event.payload } : {})
  };
}

function normalizeSummary(summary: CertificationSummary): JsonValue {
  return {
    status: summary.status,
    ...(summary.failureCode ? { failureCode: summary.failureCode } : {}),
    ...(summary.balanceBefore !== undefined
      ? { balanceBefore: summary.balanceBefore }
      : {}),
    ...(summary.balanceAfter !== undefined
      ? { balanceAfter: summary.balanceAfter }
      : {}),
    ...(summary.terminalCashBefore !== undefined
      ? { terminalCashBefore: summary.terminalCashBefore }
      : {}),
    ...(summary.terminalCashAfter !== undefined
      ? { terminalCashAfter: summary.terminalCashAfter }
      : {})
  };
}

function serializeJournal(
  events: readonly RuntimeEvent[],
  maxBytes: number
): string {
  const lines: string[] = [];
  let remaining = maxBytes;
  for (const event of events) {
    if (lines.length > 0) {
      if (remaining < 1) {
        throw new Error(`Journal exceeds the configured ${maxBytes}-byte limit.`);
      }
      remaining -= 1;
    }
    const line = stableStringify(event, remaining);
    remaining -= Buffer.byteLength(line, "utf8");
    lines.push(line);
  }
  return lines.join("\n");
}

function journalOutcome(
  events: readonly RuntimeEvent[]
): CertificationSummary["status"] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index]!.type;
    if (type === "transaction.completed") return "completed";
    if (type === "transaction.cancelled") return "cancelled";
    if (
      type === "transaction.failed" ||
      type === "transaction.reconciliation_required" ||
      type === "flow.failed"
    ) {
      return "failed";
    }
  }
  return "idle";
}

function terminalFailureCode(events: readonly RuntimeEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "transaction.completed" ||
      event.type === "transaction.cancelled"
    ) {
      return undefined;
    }
    if (
      event.type === "transaction.failed" ||
      event.type === "transaction.reconciliation_required"
    ) {
      return payloadString(event.payload, "code");
    }
    if (event.type === "flow.failed") {
      const code = payloadString(event.payload, "code");
      if (code) return code;
      const terminalIndex = previousTransactionTerminal(events, index);
      if (terminalIndex === undefined) return undefined;
      const terminal = events[terminalIndex]!;
      if (
        terminal.type === "transaction.failed" ||
        terminal.type === "transaction.reconciliation_required"
      ) {
        return payloadString(terminal.payload, "code");
      }
      return undefined;
    }
  }
  return undefined;
}

function previousTransactionTerminal(
  events: readonly RuntimeEvent[],
  beforeIndex: number
): number | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const type = events[index]!.type;
    if (
      type === "flow.failed" ||
      type === "flow.loaded" ||
      type === "session.started" ||
      type === "runtime.started"
    ) {
      return undefined;
    }
    if (
      type === "transaction.completed" ||
      type === "transaction.cancelled" ||
      type === "transaction.failed" ||
      type === "transaction.reconciliation_required"
    ) {
      return index;
    }
  }
  return undefined;
}

function lastCompletedPayload(
  events: readonly RuntimeEvent[]
): Record<string, JsonValue> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "transaction.completed") return event.payload;
  }
  return undefined;
}

function financialPair(
  source: Record<string, JsonValue> | CertificationSummary | undefined,
  beforeKey: "balanceBefore" | "terminalCashBefore",
  afterKey: "balanceAfter" | "terminalCashAfter"
): JsonValue {
  const before = source?.[beforeKey];
  const after = source?.[afterKey];
  return {
    before: typeof before === "number" && Number.isFinite(before) ? before : null,
    after: typeof after === "number" && Number.isFinite(after) ? after : null
  };
}

function payloadString(
  payload: Record<string, JsonValue> | undefined,
  key: string
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function payloadNumber(
  payload: Record<string, JsonValue> | undefined,
  key: string
): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function validateSuite<Request>(
  suiteId: string,
  profileId: string,
  scenarios: readonly CertificationScenario<Request>[],
  maxScenarios: number,
  maxEvidenceBytes: number
): void {
  for (const [label, value] of [
    ["suiteId", suiteId],
    ["profileId", profileId]
  ] as const) {
    if (!scenarioIdPattern.test(value) || value.length > 100) {
      throw new Error(`${label} must be a lowercase, bounded identifier.`);
    }
  }
  if (scenarios.length === 0 || scenarios.length > maxScenarios) {
    throw new Error(`scenarios must contain between 1 and ${maxScenarios} entries.`);
  }
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (!scenarioIdPattern.test(scenario.id) || scenario.id.length > 100) {
      throw new Error(`Invalid scenario id: ${scenario.id}`);
    }
    if (ids.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    if (!scenario.description.trim() || scenario.description.length > 500) {
      throw new Error(`Scenario ${scenario.id} requires a bounded description.`);
    }
    if (
      (scenario.expected.requiredEvents?.length ?? 0) > 100 ||
      (scenario.expected.forbiddenEvents?.length ?? 0) > 100
    ) {
      throw new Error(`Scenario ${scenario.id} has too many event expectations.`);
    }
    stableStringify(scenario.request, maxEvidenceBytes);
    ids.add(scenario.id);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function validTimestamp(value: Date, label: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} provider returned an invalid Date.`);
  }
  return value.toISOString();
}

function digest(value: unknown, maxBytes: number): string {
  return createHash("sha256")
    .update(stableStringify(value, maxBytes))
    .digest("hex");
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Executor threw an unprintable value.";
  }
}

function stableStringify(value: unknown, maxBytes = Number.MAX_SAFE_INTEGER): string {
  const seen = new Set<object>();
  const parts: string[] = [];
  let remaining = maxBytes;
  const append = (text: string): void => {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > remaining) {
      throw new Error(`Evidence exceeds the configured ${maxBytes}-byte limit.`);
    }
    remaining -= bytes;
    parts.push(text);
  };
  const appendJsonString = (input: string): void => {
    if (Buffer.byteLength(input, "utf8") > remaining) {
      throw new Error(`Evidence exceeds the configured ${maxBytes}-byte limit.`);
    }
    append(JSON.stringify(input));
  };
  const encode = (input: unknown): void => {
    if (input === null) {
      append("null");
      return;
    }
    if (typeof input === "string") {
      appendJsonString(input);
      return;
    }
    if (typeof input === "boolean") {
      append(input ? "true" : "false");
      return;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Evidence contains a non-finite number.");
      append(JSON.stringify(input));
      return;
    }
    if (Array.isArray(input)) {
      if (seen.has(input)) throw new Error("Evidence contains a circular reference.");
      seen.add(input);
      append("[");
      for (let index = 0; index < input.length; index += 1) {
        if (index > 0) append(",");
        if (!(index in input) || input[index] === undefined) {
          throw new Error("Evidence arrays cannot contain holes or undefined values.");
        }
        encode(input[index]);
      }
      append("]");
      seen.delete(input);
      return;
    }
    if (typeof input === "object") {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("Evidence must contain only plain JSON objects.");
      }
      if (seen.has(input)) throw new Error("Evidence contains a circular reference.");
      seen.add(input);
      if (Object.getOwnPropertySymbols(input).length > 0) {
        throw new Error("Evidence cannot contain symbol keys.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      append("{");
      let emitted = 0;
      for (const key of Object.keys(descriptors).sort(ordinalCompare)) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable) {
          throw new Error("Evidence cannot contain non-enumerable properties.");
        }
        if (!("value" in descriptor)) {
          throw new Error("Evidence cannot contain accessor properties.");
        }
        if (descriptor.value === undefined) {
          throw new Error("Evidence cannot contain undefined values.");
        }
        if (emitted > 0) append(",");
        appendJsonString(key);
        append(":");
        encode(descriptor.value);
        emitted += 1;
      }
      append("}");
      seen.delete(input);
      return;
    }
    throw new Error(`Evidence contains unsupported ${typeof input} data.`);
  };
  encode(value);
  return parts.join("");
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
