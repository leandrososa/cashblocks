# Journal Replay

`@cashblocks/journal-replay` safely inspects JSONL runtime journals and
reconstructs session state from their ordered events.

Replay is deliberately side-effect free. It never calls adapters, hosts, or
devices; it applies recorded facts to a projection and can retain a frame after
each event. This makes it suitable for incident inspection without risking a
second dispense, deposit, print, or authorization.

## CLI

```sh
bun run replay -- ./data/runtime.journal.jsonl --pretty
bun run replay -- ./data/runtime.journal.jsonl \
  --session session-550e8400-e29b-41d4-a716-446655440000 \
  --frames --pretty
bun run replay -- ./data/in-progress.journal.jsonl --partial --pretty
```

The CLI writes JSON to stdout. Exit status is `0` for a structurally valid
journal, `2` when validation errors are present, and `1` for invocation or I/O
failure.

Strict mode is the default. It requires each session to begin with
`flow.loaded`, use canonical UTC ISO timestamps, satisfy event-specific payload
schemas, and end with a terminal outcome. `--partial` downgrades missing anchors,
empty input, and incomplete sessions to warnings for inspecting an actively
written or deliberately sliced journal; it does not suppress structural,
sequence, or schema errors.

## Validation

The inspector:

- preserves source line numbers
- bounds file and line sizes
- applies global line, issue, event, and full-state frame budgets
- validates event shape, types, timestamps, sources, payload JSON, and IDs
- checks contiguous sequence numbers within each session
- detects reversed timestamps, unmatched host requests/results, open
  transactions, overlapping starts, and ambiguous repetitions
- reports incomplete sessions without inventing a successful result

Unscoped `runtime.started` records are retained in aggregate counts. Other
unscoped events are errors because they cannot be attributed safely.

## API

```ts
const report = await inspectJournalFile("./data/runtime.journal.jsonl", {
  includeFrames: true,
  maxFileBytes: 50 * 1024 * 1024,
  maxLineBytes: 1024 * 1024,
  maxEvents: 100_000,
  maxFrames: 1_000,
  maxLines: 200_000,
  maxIssues: 10_000
});

for (const session of report.sessions) {
  console.log(session.sessionId, session.state.status);
}
```

`inspectJournalText` supports in-memory diagnostics and tests. `replaySession`
projects a known event array for one session. Frames and final state are
isolated snapshots, so consumers cannot mutate earlier replay history.
