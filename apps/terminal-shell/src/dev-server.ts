import { createServer } from "node:http";

import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import * as flow from "../../../examples/atm-basic/src/flow.js";

const server = createServer(async (_request, response) => {
  const result = await runFlow(flow, {
    simulator: { customerSelections: ["BalanceInquiry"] },
    configure(globals) {
      flow.bindFlow(globals);
    }
  });

  const journal = JSON.stringify(result.runtime.Journal.all(), null, 2);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Cashblocks Terminal Shell</title>
    <style>
      body { margin: 0; background: #101820; color: #f7efe5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
      h1 { font-size: 40px; margin: 0 0 8px; }
      p { color: #d8c9b7; }
      pre { overflow: auto; padding: 24px; border: 1px solid #405466; background: #17232d; border-radius: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cashblocks Terminal Shell</h1>
      <p>Simulator journal from the ATM basic flow.</p>
      <pre>${escapeHtml(journal)}</pre>
    </main>
  </body>
</html>`);
});

server.listen(4173, () => {
  console.log("Cashblocks terminal shell listening on http://localhost:4173");
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
