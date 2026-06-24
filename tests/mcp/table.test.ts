import { describe, expect, test } from "bun:test";
import { NIA_TOOLS } from "../../src/mcp/tools/table";

// The full tool set, asserted explicitly so the extraction is provably 1:1 with
// the previous in-process server (behavior preservation, not a loose count).
const EXPECTED_TOOLS = [
  "list_jobs",
  "add_job",
  "update_job",
  "remove_job",
  "enable_job",
  "disable_job",
  "archive_job",
  "unarchive_job",
  "run_job",
  "send_message",
  "list_messages",
  "list_sessions",
  "search_messages",
  "read_session",
  "add_watch_channel",
  "remove_watch_channel",
  "enable_watch_channel",
  "disable_watch_channel",
  "add_rule",
  "read_memory",
  "add_memory",
  "list_agents",
  "list_employees",
  "place_call",
];

describe("NIA_TOOLS", () => {
  test("exposes exactly the expected tool set, in order", () => {
    expect(NIA_TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  test("names are unique", () => {
    const names = NIA_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every tool has a description and a callable handler", () => {
    for (const t of NIA_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe("function");
      expect(typeof t.schema).toBe("object");
    }
  });
});
