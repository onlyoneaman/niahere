import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { scanAgents, getAgentsSummary, getAgentDefinitions } from "../../src/core/agents";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-agents";

// The scanner also picks up agents from cwd and PROJECT_ROOT.
// Tests filter by source="nia" to isolate test agents from project agents.
function niaAgents() {
  return scanAgents().filter((a) => a.source === "nia");
}

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/agents/marketer`, { recursive: true });
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("scanAgents", () => {
  test("discovers AGENT.md files with frontmatter", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: test-marketer\ndescription: Marketing specialist\nmodel: sonnet\n---\n\nYou handle marketing.`,
    );
    const agents = niaAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("test-marketer");
    expect(agents[0].description).toBe("Marketing specialist");
    expect(agents[0].body).toBe("You handle marketing.");
    expect(agents[0].model).toBe("sonnet");
  });

  test("skips directories without AGENT.md", () => {
    mkdirSync(`${TEST_DIR}/agents/empty`, { recursive: true });
    const agents = niaAgents();
    expect(agents).toHaveLength(0);
  });

  test("skips files with invalid frontmatter", () => {
    writeFileSync(`${TEST_DIR}/agents/marketer/AGENT.md`, "no frontmatter here");
    const agents = niaAgents();
    expect(agents).toHaveLength(0);
  });

  test("falls back to directory name if name not in frontmatter", () => {
    mkdirSync(`${TEST_DIR}/agents/test-fallback`, { recursive: true });
    writeFileSync(
      `${TEST_DIR}/agents/test-fallback/AGENT.md`,
      `---\ndescription: Fallback test\n---\n\nYou handle testing.`,
    );
    const agents = niaAgents();
    const fallback = agents.find((a) => a.name === "test-fallback");
    expect(fallback).toBeDefined();
    expect(fallback!.name).toBe("test-fallback");
  });
});

describe("getAgentsSummary", () => {
  test("returns formatted summary including test agent", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: test-marketer\ndescription: Test marketing specialist\n---\n\nBody.`,
    );
    const summary = getAgentsSummary();
    expect(summary).toContain("test-marketer");
    expect(summary).toContain("Test marketing specialist");
  });
});

describe("getAgentDefinitions", () => {
  test("returns SDK-compatible agent definitions", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: test-marketer\ndescription: Marketing specialist\nmodel: haiku\n---\n\nYou handle marketing.`,
    );
    const defs = getAgentDefinitions();
    expect(defs["test-marketer"]).toBeDefined();
    expect(defs["test-marketer"].description).toBe("Marketing specialist");
    expect(defs["test-marketer"].prompt).toBe("You handle marketing.");
    expect(defs["test-marketer"].model).toBe("haiku");
  });
});
