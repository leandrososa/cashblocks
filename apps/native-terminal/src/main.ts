import { createCustomerTerminalServer } from "../../customer-terminal/src/server.js";
import {
  parseNativeTerminalConfig,
  prepareNativeTerminal
} from "./config.js";
import { superviseNativeServer } from "./shutdown.js";

const config = parseNativeTerminalConfig(process.argv.slice(2));
await prepareNativeTerminal(config);

const server = createCustomerTerminalServer({
  publicDir: config.publicDir,
  journalPath: config.journalPath,
  allowedHosts: [new URL(config.origin).host],
  allowedOrigins: [config.origin]
});
const supervisor = superviseNativeServer(server);

server.listen(config.port, config.host, () => {
  console.log(
    `Cashblocks native terminal listening on http://${config.host}:${config.port}`
  );
  console.log(`Journal: ${config.journalPath}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Cashblocks native terminal received ${signal}; shutting down.`);
  try {
    await supervisor.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
