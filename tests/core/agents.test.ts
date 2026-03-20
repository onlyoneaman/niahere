import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { scanAgents, getAgentsSummary, getAgentDefinitions } from "../../src/core/agents";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-agents";

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
      `---\nname: marketer\ndescription: Marketing specialist\nmodel: sonnet\n---\n\nYou handle marketing.`,
    );
    const agents = scanAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("marketer");
    expect(agents[0].description).toBe("Marketing specialist");
    expect(agents[0].body).toBe("You handle marketing.");
    expect(agents[0].model).toBe("sonnet");
  });

  test("skips directories without AGENT.md", () => {
    mkdirSync(`${TEST_DIR}/agents/empty`, { recursive: true });
    const agents = scanAgents();
    expect(agents).toHaveLength(0);
  });

  test("skips files with invalid frontmatter", () => {
    writeFileSync(`${TEST_DIR}/agents/marketer/AGENT.md`, "no frontmatter here");
    const agents = scanAgents();
    expect(agents).toHaveLength(0);
  });

  test("falls back to directory name if name not in frontmatter", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\ndescription: Marketing specialist\n---\n\nYou handle marketing.`,
    );
    const agents = scanAgents();
    expect(agents[0].name).toBe("marketer");
  });

  test("deduplicates by name (first wins)", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: marketer\ndescription: First\n---\n\nFirst.`,
    );
    const agents = scanAgents();
    expect(agents).toHaveLength(1);
  });
});

describe("getAgentsSummary", () => {
  test("returns empty string when no agents", () => {
    expect(getAgentsSummary()).toBe("");
  });

  test("returns formatted summary", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: marketer\ndescription: Marketing specialist\n---\n\nBody.`,
    );
    const summary = getAgentsSummary();
    expect(summary).toContain("marketer");
    expect(summary).toContain("Marketing specialist");
  });
});

describe("getAgentDefinitions", () => {
  test("returns SDK-compatible agent definitions", () => {
    writeFileSync(
      `${TEST_DIR}/agents/marketer/AGENT.md`,
      `---\nname: marketer\ndescription: Marketing specialist\nmodel: haiku\n---\n\nYou handle marketing.`,
    );
    const defs = getAgentDefinitions();
    expect(defs.marketer).toBeDefined();
    expect(defs.marketer.description).toBe("Marketing specialist");
    expect(defs.marketer.prompt).toBe("You handle marketing.");
    expect(defs.marketer.model).toBe("haiku");
  });
});
