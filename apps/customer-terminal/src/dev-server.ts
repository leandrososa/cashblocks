import { join } from "node:path";

import { createCustomerTerminalServer } from "./server.js";

const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";
const origin =
  process.env.CASHBLOCKS_ORIGIN ?? `http://${host === "::1" ? "[::1]" : host}:${port}`;
const server = createCustomerTerminalServer({
  publicDir: join(process.cwd(), "apps/customer-terminal/public"),
  journalPath: process.env.CASHBLOCKS_JOURNAL_PATH,
  allowedHosts: [new URL(origin).host],
  allowedOrigins: [new URL(origin).origin]
});

server.listen(port, host, () => {
  console.log(
    `Cashblocks customer terminal listening on http://${host}:${port}`
  );
});
