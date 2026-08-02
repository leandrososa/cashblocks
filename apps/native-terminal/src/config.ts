import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type NativeTerminalConfig = {
  host: string;
  port: number;
  publicDir: string;
  journalPath: string;
  allowRemote: boolean;
  origin: string;
};

export function parseNativeTerminalConfig(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): NativeTerminalConfig {
  const argumentsByName = parseArguments(argv);
  const allowRemote =
    argumentsByName.has("allow-remote") ||
    environment.CASHBLOCKS_ALLOW_REMOTE === "true";
  const host =
    argumentsByName.get("host") ?? environment.CASHBLOCKS_HOST ?? "127.0.0.1";
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing non-loopback host ${host}; pass --allow-remote explicitly.`
    );
  }
  const portText =
    argumentsByName.get("port") ?? environment.CASHBLOCKS_PORT ?? "4174";
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Native terminal port must be between 1 and 65535.");
  }
  const configuredOrigin =
    argumentsByName.get("origin") ?? environment.CASHBLOCKS_ORIGIN;
  if (allowRemote && !configuredOrigin) {
    throw new Error(
      "Remote binding requires --origin with the externally visible origin."
    );
  }
  const origin = validateOrigin(
    configuredOrigin ?? `http://${formatHost(host)}:${port}`
  );

  return {
    host,
    port,
    allowRemote,
    origin,
    publicDir: resolve(
      cwd,
      argumentsByName.get("public-dir") ??
        environment.CASHBLOCKS_PUBLIC_DIR ??
        "apps/customer-terminal/public"
    ),
    journalPath: resolve(
      cwd,
      argumentsByName.get("journal") ??
        environment.CASHBLOCKS_JOURNAL_PATH ??
        "data/native-terminal.journal.jsonl"
    )
  };
}

export async function prepareNativeTerminal(
  config: NativeTerminalConfig
): Promise<void> {
  await Promise.all(
    ["index.html", "app.js", "style.css"].map(async (asset) => {
      const assetStat = await lstat(resolve(config.publicDir, asset));
      if (!assetStat.isFile() || assetStat.isSymbolicLink()) {
        throw new Error(`Native terminal asset ${asset} must be a file.`);
      }
    })
  );
  await validateCampaignAssets(config.publicDir);
  await mkdir(dirname(config.journalPath), { recursive: true });
  const journal = await open(config.journalPath, "a");
  await journal.close();
}

async function validateCampaignAssets(publicDir: string): Promise<void> {
  const manifestPath = resolve(publicDir, "campaigns", "campaigns.json");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("Native terminal campaign manifest must be a file.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("Native terminal campaign manifest must be valid JSON.");
  }
  if (
    !isRecord(manifest) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.campaigns) ||
    manifest.campaigns.length < 1 ||
    manifest.campaigns.length > 10
  ) {
    throw new Error("Native terminal campaign manifest is invalid.");
  }
  for (const campaign of manifest.campaigns) {
    if (
      !isRecord(campaign) ||
      typeof campaign.image !== "string" ||
      !/^\/campaigns\/[a-z0-9-]+\.(?:png|jpe?g)$/.test(campaign.image)
    ) {
      throw new Error("Native terminal campaign entry is invalid.");
    }
    const imagePath = resolve(publicDir, campaign.image.slice(1));
    const relativePath = relative(resolve(publicDir), imagePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Native terminal campaign image escapes publicDir.");
    }
    const imageStat = await lstat(imagePath);
    if (!imageStat.isFile() || imageStat.isSymbolicLink()) {
      throw new Error("Native terminal campaign image must be a file.");
    }
  }
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  const valueArguments = new Set([
    "host",
    "port",
    "public-dir",
    "journal",
    "origin"
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--allow-remote") {
      parsed.set("allow-remote", "true");
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected native terminal argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (!valueArguments.has(name)) {
      throw new Error(`Unknown native terminal option: --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Native terminal option --${name} requires a value.`);
    }
    parsed.set(name, value);
    index += 1;
  }
  return parsed;
}

function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase());
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function validateOrigin(value: string): string {
  const origin = new URL(value);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Native terminal origin must be an HTTP(S) origin.");
  }
  return origin.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
