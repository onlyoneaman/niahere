import { readRawConfig, updateRawConfig } from "../utils/config";

const USAGE = [
  "Usage: nia config <set|get|list>",
  "  nia config set <key> <value>  — set a config value",
  "  nia config get <key>          — get a config value",
  "  nia config list               — show all config",
].join("\n");

/** Booleans and integers are written as their real types, not strings. */
function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** Expand `a.b.c` into `{ a: { b: { c: value } } }` for a merging write. */
function nest(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return root;
}

function readPath(raw: unknown, key: string): unknown {
  let val = raw;
  for (const part of key.split(".")) {
    if (val && typeof val === "object") val = (val as Record<string, unknown>)[part];
    else return undefined;
  }
  return val;
}

export async function configCommand(sub?: string, key?: string, value?: string): Promise<void> {
  if (sub === "set" && key) {
    if (!value) {
      console.error("Usage: nia config set <key> <value>");
      process.exit(1);
    }
    updateRawConfig(nest(key, parseValue(value)));
    console.log(`${key} = ${value}`);
    return;
  }

  if (sub === "get" && key) {
    const val = readPath(readRawConfig(), key);
    if (val === undefined) {
      console.log(`${key}: (not set)`);
    } else if (typeof val === "object") {
      const yaml = (await import("js-yaml")).default;
      console.log(yaml.dump(val, { lineWidth: -1 }).trim());
    } else {
      console.log(`${key} = ${val}`);
    }
    return;
  }

  if (!sub || sub === "list") {
    const yaml = (await import("js-yaml")).default;
    console.log(yaml.dump(readRawConfig(), { lineWidth: -1 }).trim());
    return;
  }

  console.log(USAGE);
}
