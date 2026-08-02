import { readFile, stat } from "node:fs/promises";

import type {
  JsonValue,
  RuntimeEvent,
  RuntimeEventType
} from "../../runtime-contracts/src/index.js";

export type JournalReplayIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  line?: number;
  sessionId?: string;
  seq?: number;
};

export type ReplayedTransactionStatus =
  | "started"
  | "completed"
  | "cancelled"
  | "failed"
  | "reconciliation_required";

export type ReplayedSessionStatus =
  | "recorded"
  | "active"
  | "completed"
  | "cancelled"
  | "failed"
  | "reconciliation_required";

export type ReplayedSessionState = {
  sessionId: string;
  seq: number;
  ts: string;
  status: ReplayedSessionStatus;
  selectedTransaction?: string;
  selectedAccount?: string;
  selectedAmount?: number;
  currencyCode?: string;
  terminalCash?: number;
  accounts: Record<string, number>;
  devices: Record<string, JsonValue>;
  transactions: Array<{
    transaction: string;
    occurrence: number;
    status: ReplayedTransactionStatus;
  }>;
  hostRequests: number;
  hostResults: number;
  requiresReconciliation: boolean;
};

export type JournalReplayFrame = {
  line: number;
  event: RuntimeEvent;
  state: ReplayedSessionState;
};

export type ReplayedSession = {
  sessionId: string;
  valid: boolean;
  eventCount: number;
  firstTs: string;
  lastTs: string;
  state: ReplayedSessionState;
  frames: JournalReplayFrame[];
  issues: JournalReplayIssue[];
};

export type JournalReplayReport = {
  source: string;
  valid: boolean;
  lineCount: number;
  eventCount: number;
  unscopedEventCount: number;
  sessions: ReplayedSession[];
  issues: JournalReplayIssue[];
};

export type JournalReplayOptions = {
  includeFrames?: boolean;
  mode?: "strict" | "partial";
  maxFileBytes?: number;
  maxLineBytes?: number;
  maxEvents?: number;
  maxFrames?: number;
  maxLines?: number;
  maxIssues?: number;
};

type JournalRecord = {
  line: number;
  event: RuntimeEvent;
};

type ReplayContext = {
  activeTransactions: Map<string, number>;
  occurrenceCounts: Map<string, number>;
  pendingHostRequests: Map<string, number>;
  transactionIndexes: Map<string, Map<number, number>>;
};

type ReplayBudget = {
  framesRemaining: number;
  issuesRemaining: number;
  issueLimitReached: boolean;
};

type TrackedTransaction = {
  transaction: string;
  occurrence: number;
  status: ReplayedTransactionStatus;
};

const runtimeEventTypes: readonly RuntimeEventType[] = [
  "runtime.started",
  "flow.loaded",
  "flow.failed",
  "session.started",
  "transaction.selected",
  "transaction.started",
  "transaction.completed",
  "transaction.cancelled",
  "transaction.failed",
  "transaction.reconciliation_required",
  "device.status_changed",
  "host.authorization_requested",
  "host.authorization_result",
  "journal.line_logged",
  "transaction.detail_recorded",
  "ui.input_received",
  "ui.prompt"
];

const eventSources = [
  "runtime",
  "flow",
  "module",
  "simulator",
  "ui"
] as const;

export async function inspectJournalFile(
  filePath: string,
  options: JournalReplayOptions = {}
): Promise<JournalReplayReport> {
  const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  validatePositiveLimit(maxFileBytes, "maxFileBytes");
  const file = await stat(filePath);
  if (!file.isFile()) {
    throw new Error("Journal path must reference a file.");
  }
  if (file.size > maxFileBytes) {
    throw new Error(
      `Journal file exceeds the configured ${maxFileBytes}-byte limit.`
    );
  }
  return inspectJournalText(await readFile(filePath, "utf8"), {
    ...options,
    source: filePath
  });
}

export function inspectJournalText(
  text: string,
  options: JournalReplayOptions & { source?: string } = {}
): JournalReplayReport {
  const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  const maxLineBytes = options.maxLineBytes ?? 1024 * 1024;
  const maxEvents = options.maxEvents ?? 100_000;
  const maxFrames = options.maxFrames ?? 1_000;
  const maxLines = options.maxLines ?? 200_000;
  const maxIssues = options.maxIssues ?? 10_000;
  validatePositiveLimit(maxFileBytes, "maxFileBytes");
  validatePositiveLimit(maxLineBytes, "maxLineBytes");
  validatePositiveLimit(maxEvents, "maxEvents");
  validatePositiveLimit(maxFrames, "maxFrames");
  validatePositiveLimit(maxLines, "maxLines");
  validatePositiveLimit(maxIssues, "maxIssues");
  if (Buffer.byteLength(text, "utf8") > maxFileBytes) {
    throw new Error(
      `Journal text exceeds the configured ${maxFileBytes}-byte limit.`
    );
  }
  const issues: JournalReplayIssue[] = [];
  const records: JournalRecord[] = [];
  let lineCount = 0;
  let parsingIssueLimitReached = false;
  const addParsingIssues = (...incoming: JournalReplayIssue[]) => {
    if (parsingIssueLimitReached || incoming.length === 0) return;
    const capacity = maxIssues - issues.length;
    if (incoming.length <= capacity) {
      issues.push(...incoming);
      return;
    }
    const keep = Math.max(0, capacity - 1);
    issues.push(...incoming.slice(0, keep));
    const limitIssue: JournalReplayIssue = {
      severity: "error",
      code: "ISSUE_LIMIT_EXCEEDED",
      message: `Journal exceeds the configured ${maxIssues}-issue limit.`
    };
    if (capacity > 0) {
      issues.push(limitIssue);
    } else if (issues.length > 0) {
      issues[issues.length - 1] = limitIssue;
    }
    parsingIssueLimitReached = true;
  };

  for (const { lineNumber, line } of journalLines(text)) {
    lineCount = lineNumber;
    if (lineNumber > maxLines) {
      addParsingIssues({
        severity: "error",
        code: "LINE_LIMIT_EXCEEDED",
        message: `Journal exceeds the configured ${maxLines}-line limit.`,
        line: lineNumber
      });
      break;
    }
    if (issues.length >= maxIssues) {
      addParsingIssues({
        severity: "error",
        code: "ISSUE_LIMIT_EXCEEDED",
        message: `Journal exceeds the configured ${maxIssues}-issue limit.`,
        line: lineNumber
      });
      break;
    }
    if (!line.trim()) {
      addParsingIssues({
        severity: "warning",
        code: "EMPTY_LINE",
        message: "Journal contains an empty line.",
        line: lineNumber
      });
      continue;
    }
    if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
      addParsingIssues({
        severity: "error",
        code: "LINE_TOO_LARGE",
        message: `Journal line exceeds the ${maxLineBytes}-byte limit.`,
        line: lineNumber
      });
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      addParsingIssues({
        severity: "error",
        code: "INVALID_JSON",
        message: "Journal line is not valid JSON.",
        line: lineNumber
      });
      continue;
    }
    const eventIssues = validateRuntimeEvent(value, lineNumber);
    addParsingIssues(...eventIssues);
    if (parsingIssueLimitReached) break;
    if (!eventIssues.some((issue) => issue.severity === "error")) {
      if (records.length >= maxEvents) {
        addParsingIssues({
          severity: "error",
          code: "EVENT_LIMIT_EXCEEDED",
          message: `Journal exceeds the configured ${maxEvents}-event limit.`,
          line: lineNumber
        });
        break;
      }
      records.push({ line: lineNumber, event: value as RuntimeEvent });
    }
  }

  if (lineCount === 0) {
    addParsingIssues({
      severity: options.mode === "partial" ? "warning" : "error",
      code: "EMPTY_JOURNAL",
      message: "Journal contains no events."
    });
  }

  const unscoped = records.filter((record) => !record.event.sessionId);
  for (const record of unscoped) {
    if (record.event.type !== "runtime.started") {
      addParsingIssues({
        severity: "error",
        code: "UNSCOPED_EVENT",
        message: `${record.event.type} must include a sessionId.`,
        line: record.line,
        seq: record.event.seq
      });
      if (parsingIssueLimitReached) break;
    }
  }

  const grouped = new Map<string, JournalRecord[]>();
  for (const record of records) {
    if (!record.event.sessionId) {
      continue;
    }
    const events = grouped.get(record.event.sessionId) ?? [];
    events.push(record);
    grouped.set(record.event.sessionId, events);
  }

  const mode = options.mode ?? "strict";
  const runtimeStarts = unscoped.filter(
    (record) => record.event.type === "runtime.started"
  );
  const completenessSeverity =
    mode === "partial" ? ("warning" as const) : ("error" as const);
  if (grouped.size === 0 && lineCount > 0) {
    addParsingIssues({
      severity: completenessSeverity,
      code: "NO_SESSIONS",
      message: "Journal contains no scoped runtime sessions."
    });
  }
  if (runtimeStarts.length !== grouped.size) {
    addParsingIssues({
      severity: completenessSeverity,
      code: "RUNTIME_SESSION_MISMATCH",
      message:
        `Journal has ${runtimeStarts.length} runtime.started events and ` +
        `${grouped.size} scoped sessions.`
    });
  }
  for (const record of runtimeStarts) {
    if (record.event.seq !== 1 || record.event.source !== "runtime") {
      addParsingIssues({
        severity: completenessSeverity,
        code: "INVALID_RUNTIME_ANCHOR",
        message: "runtime.started must use seq 1 and source runtime.",
        line: record.line,
        seq: record.event.seq
      });
    }
  }
  const orderedSessionStarts = [...grouped.values()]
    .map((sessionRecords) => sessionRecords[0])
    .filter((record): record is JournalRecord => record !== undefined)
    .sort((left, right) => left.line - right.line);
  for (
    let index = 0;
    index < Math.min(runtimeStarts.length, orderedSessionStarts.length);
    index += 1
  ) {
    const runtimeStart = runtimeStarts[index];
    const sessionStart = orderedSessionStarts[index];
    if (
      runtimeStart &&
      sessionStart &&
      runtimeStart.line >= sessionStart.line
    ) {
      addParsingIssues({
        severity: completenessSeverity,
        code: "ANCHOR_ORDER_INVALID",
        message:
          "Each scoped session must follow an unused runtime.started anchor.",
        line: sessionStart.line,
        sessionId: sessionStart.event.sessionId,
        seq: sessionStart.event.seq
      });
    }
  }

  const budget: ReplayBudget = {
    framesRemaining: maxFrames,
    issuesRemaining: Math.max(0, maxIssues - issues.length),
    issueLimitReached: parsingIssueLimitReached
  };
  const sessions = [...grouped.entries()]
    .map(([sessionId, sessionRecords]) =>
      replaySessionRecords(
        sessionId,
        sessionRecords,
        issues,
        {
          includeFrames: options.includeFrames ?? false,
          mode,
          requireAnchor: true,
          budget
        }
      )
    )
    .sort((left, right) => left.firstTs.localeCompare(right.firstTs));

  return {
    source: options.source ?? "<memory>",
    valid: !issues.some((issue) => issue.severity === "error"),
    lineCount,
    eventCount: records.length,
    unscopedEventCount: unscoped.length,
    sessions,
    issues
  };
}

export function replaySession(
  sessionId: string,
  events: RuntimeEvent[],
  includeFrames = true
): ReplayedSession {
  if (events.length > 100_000) {
    throw new Error("Session replay exceeds the 100000-event limit.");
  }
  const issues: JournalReplayIssue[] = [];
  const records: JournalRecord[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const record = { line: index + 1, event: events[index]! };
    const eventIssues = validateRuntimeEvent(record.event, record.line);
    const remaining = 10_000 - issues.length;
    if (eventIssues.length > remaining) {
      const limitIssue: JournalReplayIssue = {
        severity: "error",
        code: "ISSUE_LIMIT_EXCEEDED",
        message: "Session replay exceeded the 10000-issue limit."
      };
      if (remaining > 0) {
        issues.push(...eventIssues.slice(0, Math.max(0, remaining - 1)));
        issues.push(limitIssue);
      } else if (issues.length > 0) {
        issues[issues.length - 1] = limitIssue;
      }
      break;
    }
    issues.push(...eventIssues);
    if (!eventIssues.some((issue) => issue.severity === "error")) {
      records.push(record);
    }
  }
  return replaySessionRecords(
    sessionId,
    records,
    issues,
    {
      includeFrames,
      mode: "partial",
      requireAnchor: false,
      budget: {
        framesRemaining: 1_000,
        issuesRemaining: Math.max(0, 10_000 - issues.length),
        issueLimitReached: issues.some(
          (issue) => issue.code === "ISSUE_LIMIT_EXCEEDED"
        )
      }
    }
  );
}

function replaySessionRecords(
  sessionId: string,
  records: JournalRecord[],
  allIssues: JournalReplayIssue[],
  options: {
    includeFrames: boolean;
    mode: "strict" | "partial";
    requireAnchor: boolean;
    budget: ReplayBudget;
  }
): ReplayedSession {
  const issues = allIssues.filter((issue) => issue.sessionId === sessionId);
  let hasError = issues.some((issue) => issue.severity === "error");
  const addIssue = (issue: JournalReplayIssue) => {
    if (issue.severity === "error") hasError = true;
    if (options.budget.issuesRemaining > 0) {
      issues.push(issue);
      allIssues.push(issue);
      options.budget.issuesRemaining -= 1;
      return;
    }
    if (options.budget.issueLimitReached) return;
    const limitIssue: JournalReplayIssue = {
      severity: "error",
      code: "ISSUE_LIMIT_EXCEEDED",
      message: "Journal replay exceeded the global issue budget."
    };
    hasError = true;
    if (allIssues.length > 0) {
      allIssues[allIssues.length - 1] = limitIssue;
    } else {
      allIssues.push(limitIssue);
    }
    if (issues.length > 0) {
      issues[issues.length - 1] = limitIssue;
    } else {
      issues.push(limitIssue);
    }
    options.budget.issueLimitReached = true;
  };
  const state = initialState(sessionId);
  const frames: JournalReplayFrame[] = [];
  let previous: RuntimeEvent | undefined;
  const context: ReplayContext = {
    activeTransactions: new Map(),
    occurrenceCounts: new Map(),
    pendingHostRequests: new Map(),
    transactionIndexes: new Map()
  };
  let includeFrames = options.includeFrames;
  if (includeFrames && records.length > options.budget.framesRemaining) {
    addIssue({
      severity: "error",
      code: "FRAME_LIMIT_EXCEEDED",
      message:
        `Session frames exceed the remaining global budget of ` +
        `${options.budget.framesRemaining}.`,
      sessionId
    });
    includeFrames = false;
  } else if (includeFrames) {
    options.budget.framesRemaining -= records.length;
  }
  if (options.requireAnchor && records[0]?.event.type !== "flow.loaded") {
    addIssue({
      severity: options.mode === "partial" ? "warning" : "error",
      code: "SESSION_ANCHOR_MISSING",
      message: "Session must begin with a flow.loaded event.",
      sessionId,
      line: records[0]?.line,
      seq: records[0]?.event.seq
    });
  }
  if (
    options.requireAnchor &&
    records[0]?.event.type === "flow.loaded" &&
    records[0].event.seq !== 2
  ) {
    addIssue({
      severity: options.mode === "partial" ? "warning" : "error",
      code: "SESSION_SEQUENCE_START",
      message: "A scoped session must begin at sequence 2.",
      sessionId,
      line: records[0].line,
      seq: records[0].event.seq
    });
  }

  for (const record of records) {
    const event = record.event;
    if (event.sessionId !== sessionId) {
      addIssue(issueFor(record, "error", "SESSION_ID_MISMATCH",
        `Event belongs to ${event.sessionId ?? "no session"}, not ${sessionId}.`));
      continue;
    }
    if (previous) {
      if (event.seq !== previous.seq + 1) {
        addIssue(issueFor(record, "error", "SEQUENCE_GAP",
          `Expected sequence ${previous.seq + 1}, received ${event.seq}.`));
      }
      if (Date.parse(event.ts) < Date.parse(previous.ts)) {
        addIssue(issueFor(record, "warning", "TIMESTAMP_REVERSED",
          "Event timestamp is earlier than the preceding session event."));
      }
    }
    const tracked = validateLifecycle(record, state, context, addIssue);
    applyEvent(state, event, tracked, context);
    if (includeFrames) {
      frames.push({
        line: record.line,
        event: structuredClone(event),
        state: structuredClone(state)
      });
    }
    previous = event;
  }

  if (
    !["completed", "cancelled", "failed", "reconciliation_required"].includes(
      state.status
    )
  ) {
    addIssue({
      severity: options.mode === "partial" ? "warning" : "error",
      code: "SESSION_INCOMPLETE",
      message: "Session has no terminal outcome.",
      sessionId
    });
  }
  const pendingSeverity =
    options.mode === "partial" ? ("warning" as const) : ("error" as const);
  for (const [transaction, occurrence] of context.activeTransactions) {
    addIssue({
      severity: pendingSeverity,
      code: "OPEN_TRANSACTION",
      message:
        `Transaction ${transaction} occurrence ${occurrence} has no terminal outcome.`,
      sessionId
    });
  }
  for (const [transaction, count] of context.pendingHostRequests) {
    if (count > 0) {
      addIssue({
        severity: pendingSeverity,
        code: "HOST_REQUEST_UNRESOLVED",
        message:
          `Transaction ${transaction} has ${count} unmatched host request(s).`,
        sessionId
      });
    }
  }
  return {
    sessionId,
    valid: !hasError,
    eventCount: records.length,
    firstTs: records[0]?.event.ts ?? "",
    lastTs: records.at(-1)?.event.ts ?? "",
    state,
    frames,
    issues
  };
}

function validateLifecycle(
  record: JournalRecord,
  state: ReplayedSessionState,
  context: ReplayContext,
  addIssue: (issue: JournalReplayIssue) => void
): TrackedTransaction | undefined {
  const event = record.event;
  const eventTransaction = payloadString(event.payload, "transaction");
  if (event.type === "host.authorization_requested" && eventTransaction) {
    context.pendingHostRequests.set(
      eventTransaction,
      (context.pendingHostRequests.get(eventTransaction) ?? 0) + 1
    );
  }
  if (event.type === "host.authorization_result" && eventTransaction) {
    const pending = context.pendingHostRequests.get(eventTransaction) ?? 0;
    if (pending === 0) {
      addIssue(issueFor(record, "error", "HOST_RESULT_WITHOUT_REQUEST",
        `Host result for ${eventTransaction} has no matching request.`));
    } else if (pending === 1) {
      context.pendingHostRequests.delete(eventTransaction);
    } else {
      context.pendingHostRequests.set(eventTransaction, pending - 1);
    }
  }
  const status = transactionStatus(event.type);
  if (!status) return undefined;
  const transaction = eventTransaction ??
    state.selectedTransaction ??
    "<unknown>";
  if (status === "started") {
    if (context.activeTransactions.has(transaction)) {
      addIssue(issueFor(record, "error", "OVERLAPPING_TRANSACTION",
        `Transaction ${transaction} started while a prior occurrence is active.`));
    }
    const occurrence = (context.occurrenceCounts.get(transaction) ?? 0) + 1;
    context.occurrenceCounts.set(transaction, occurrence);
    context.activeTransactions.set(transaction, occurrence);
    return { transaction, occurrence, status };
  }
  const active = context.activeTransactions.get(transaction);
  if (active !== undefined) {
    context.activeTransactions.delete(transaction);
    return { transaction, occurrence: active, status };
  }
  const priorCount = context.occurrenceCounts.get(transaction) ?? 0;
  const occurrence = priorCount + 1;
  context.occurrenceCounts.set(transaction, occurrence);
  if (priorCount > 0) {
    addIssue(issueFor(record, "warning", "AMBIGUOUS_REPEATED_OUTCOME",
      `Transaction ${transaction} repeated without occurrence identifiers.`));
  }
  return { transaction, occurrence, status };
}

function applyEvent(
  state: ReplayedSessionState,
  event: RuntimeEvent,
  tracked: TrackedTransaction | undefined,
  context: ReplayContext
): void {
  state.seq = event.seq;
  state.ts = event.ts;
  const transaction = payloadString(event.payload, "transaction");
  const account = payloadString(event.payload, "account");
  const amount = payloadNumber(event.payload, "amount");
  const currencyCode = payloadString(event.payload, "currencyCode");
  if (event.type === "session.started" || event.type === "flow.loaded") {
    state.status = "active";
  }
  if (event.type === "transaction.selected" && transaction) {
    state.selectedTransaction = transaction;
    state.status = "active";
  }
  if (
    !state.selectedTransaction &&
    transaction &&
    !["CustomerIdentification", "TerminalStatus"].includes(transaction)
  ) {
    state.selectedTransaction = transaction;
  }
  if (account) state.selectedAccount = account;
  if (amount !== undefined) state.selectedAmount = amount;
  if (currencyCode) state.currencyCode = currencyCode;

  if (tracked) {
    const occurrenceIndexes =
      context.transactionIndexes.get(tracked.transaction) ?? new Map();
    const existingIndex = occurrenceIndexes.get(tracked.occurrence);
    if (existingIndex !== undefined) {
      const existing = state.transactions[existingIndex];
      if (existing) existing.status = tracked.status;
    } else {
      state.transactions.push({ ...tracked });
      occurrenceIndexes.set(
        tracked.occurrence,
        state.transactions.length - 1
      );
      context.transactionIndexes.set(
        tracked.transaction,
        occurrenceIndexes
      );
    }
    if (tracked.status !== "started") {
      state.status = tracked.status;
    } else {
      state.status = "active";
    }
  }
  if (event.type === "flow.failed") {
    state.status = "failed";
  }
  if (event.type === "host.authorization_requested") state.hostRequests += 1;
  if (event.type === "host.authorization_result") state.hostResults += 1;
  if (event.type === "transaction.reconciliation_required") {
    state.requiresReconciliation = true;
  }

  const terminalCash = payloadNumber(event.payload, "terminalCashAfter") ??
    payloadNumber(event.payload, "terminalCash");
  if (terminalCash !== undefined) state.terminalCash = terminalCash;
  const balanceAfter = payloadNumber(event.payload, "balanceAfter") ??
    payloadNumber(event.payload, "balance");
  if (account && balanceAfter !== undefined) {
    state.accounts[account] = balanceAfter;
  }
  const accounts = event.payload?.accounts;
  if (isNumberRecord(accounts)) {
    state.accounts = numberDictionary(accounts);
  }
  if (event.type === "device.status_changed") {
    const device = payloadString(event.payload, "device") ??
      payloadString(event.payload, "adapter");
    const deviceStatus = event.payload?.status ?? event.payload?.health;
    if (device && deviceStatus !== undefined) {
      state.devices[device] = structuredClone(deviceStatus);
    }
  }
}

function initialState(sessionId: string): ReplayedSessionState {
  return {
    sessionId,
    seq: 0,
    ts: "",
    status: "recorded",
    accounts: numberDictionary(),
    devices: jsonDictionary(),
    transactions: [],
    hostRequests: 0,
    hostResults: 0,
    requiresReconciliation: false
  };
}

function validateRuntimeEvent(
  value: unknown,
  line: number
): JournalReplayIssue[] {
  const issues: JournalReplayIssue[] = [];
  if (!isRecord(value)) {
    return [{
      severity: "error",
      code: "INVALID_EVENT",
      message: "Journal event must be a plain object.",
      line
    }];
  }
  const sessionId =
    typeof value.sessionId === "string" ? value.sessionId : undefined;
  const seq = typeof value.seq === "number" ? value.seq : undefined;
  const add = (code: string, message: string) =>
    issues.push({ severity: "error", code, message, line, sessionId, seq });
  if (!Number.isSafeInteger(value.seq) || Number(value.seq) <= 0) {
    add("INVALID_SEQUENCE", "Event seq must be a positive safe integer.");
  }
  if (
    typeof value.type !== "string" ||
    !(runtimeEventTypes as readonly string[]).includes(value.type)
  ) {
    add("INVALID_EVENT_TYPE", "Event type is not supported.");
  }
  if (
    typeof value.source !== "string" ||
    !(eventSources as readonly string[]).includes(value.source)
  ) {
    add("INVALID_EVENT_SOURCE", "Event source is not supported.");
  }
  if (
    typeof value.ts !== "string" ||
    !value.ts ||
    !isCanonicalIsoTimestamp(value.ts)
  ) {
    add(
      "INVALID_TIMESTAMP",
      "Event ts must be a canonical UTC ISO timestamp."
    );
  }
  if (
    value.sessionId !== undefined &&
    (typeof value.sessionId !== "string" || !value.sessionId.trim())
  ) {
    add("INVALID_SESSION_ID", "Event sessionId must be a non-empty string.");
  }
  if (value.payload !== undefined && !isJsonRecord(value.payload)) {
    add("INVALID_PAYLOAD", "Event payload must be a JSON object.");
  } else if (
    typeof value.type === "string" &&
    (runtimeEventTypes as readonly string[]).includes(value.type)
  ) {
    validateEventPayload(
      value.type as RuntimeEventType,
      value.payload as Record<string, JsonValue> | undefined,
      add
    );
  }
  return issues;
}

function validateEventPayload(
  type: RuntimeEventType,
  payload: Record<string, JsonValue> | undefined,
  add: (code: string, message: string) => void
): void {
  const requirePayload = () => {
    if (!payload) {
      add("MISSING_PAYLOAD", `${type} requires a payload object.`);
      return false;
    }
    return true;
  };
  const requireString = (key: string) => {
    if (!payload || typeof payload[key] !== "string" || !payload[key]) {
      add(
        "INVALID_PAYLOAD_FIELD",
        `${type} payload.${key} must be a non-empty string.`
      );
    }
  };
  const optionalString = (key: string) => {
    if (payload?.[key] !== undefined && typeof payload[key] !== "string") {
      add(
        "INVALID_PAYLOAD_FIELD",
        `${type} payload.${key} must be a string when present.`
      );
    }
  };
  const optionalNumber = (key: string) => {
    if (
      payload?.[key] !== undefined &&
      (typeof payload[key] !== "number" ||
        !Number.isFinite(payload[key] as number))
    ) {
      add(
        "INVALID_PAYLOAD_FIELD",
        `${type} payload.${key} must be a finite number when present.`
      );
    }
  };
  const optionalBoolean = (key: string) => {
    if (payload?.[key] !== undefined && typeof payload[key] !== "boolean") {
      add(
        "INVALID_PAYLOAD_FIELD",
        `${type} payload.${key} must be a boolean when present.`
      );
    }
  };

  if (type === "flow.loaded") {
    if (requirePayload()) requireString("entrypoint");
  }
  if (
    [
      "transaction.selected",
      "transaction.started",
      "transaction.completed",
      "transaction.failed",
      "transaction.reconciliation_required",
      "host.authorization_requested",
      "host.authorization_result"
    ].includes(type)
  ) {
    if (requirePayload()) requireString("transaction");
  }
  if (type === "transaction.cancelled") {
    if (requirePayload()) {
      requireString("reason");
      optionalString("transaction");
    }
  }
  if (type === "transaction.detail_recorded") {
    if (requirePayload()) requireString("detail");
  }
  if (type === "device.status_changed" && requirePayload()) {
    const device = payload?.device;
    const adapter = payload?.adapter;
    if (
      (typeof device !== "string" || !device) &&
      (typeof adapter !== "string" || !adapter)
    ) {
      add(
        "INVALID_PAYLOAD_FIELD",
        "device.status_changed requires payload.device or payload.adapter."
      );
    }
  }
  if (type === "host.authorization_result") optionalBoolean("ok");

  for (const key of [
    "account",
    "currencyCode",
    "device",
    "adapter",
    "status",
    "health"
  ]) {
    optionalString(key);
  }
  for (const key of [
    "amount",
    "balance",
    "balanceBefore",
    "balanceAfter",
    "terminalCash",
    "terminalCashBefore",
    "terminalCashAfter"
  ]) {
    optionalNumber(key);
  }
  if (payload?.accounts !== undefined && !isNumberRecord(payload.accounts)) {
    add(
      "INVALID_PAYLOAD_FIELD",
      `${type} payload.accounts must contain finite numeric balances.`
    );
  }
}

function transactionStatus(
  type: RuntimeEventType
): ReplayedTransactionStatus | undefined {
  if (type === "transaction.started") return "started";
  if (type === "transaction.completed") return "completed";
  if (type === "transaction.cancelled") return "cancelled";
  if (type === "transaction.failed") return "failed";
  if (type === "transaction.reconciliation_required") {
    return "reconciliation_required";
  }
  return undefined;
}

function issueFor(
  record: JournalRecord,
  severity: JournalReplayIssue["severity"],
  code: string,
  message: string
): JournalReplayIssue {
  return {
    severity,
    code,
    message,
    line: record.line,
    sessionId: record.event.sessionId,
    seq: record.event.seq
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

function isNumberRecord(value: JsonValue | undefined): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item)
    )
  );
}

function numberDictionary(
  values: Record<string, number> = {}
): Record<string, number> {
  return Object.assign(Object.create(null) as Record<string, number>, values);
}

function jsonDictionary(): Record<string, JsonValue> {
  return Object.create(null) as Record<string, JsonValue>;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function* journalLines(
  text: string
): Generator<{ lineNumber: number; line: string }> {
  let start = 0;
  let lineNumber = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    lineNumber += 1;
    const end = index > start && text[index - 1] === "\r" ? index - 1 : index;
    yield { lineNumber, line: text.slice(start, end) };
    start = index + 1;
  }
  if (start < text.length) {
    lineNumber += 1;
    const end =
      text.endsWith("\r") && text.length > start
        ? text.length - 1
        : text.length;
    yield { lineNumber, line: text.slice(start, end) };
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
  return isRecord(value) &&
    Object.values(value).every((item) => isJsonValue(item));
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
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth >= 20 || seen.has(value)) return false;
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

function validatePositiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}
