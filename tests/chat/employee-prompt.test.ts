import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { buildEmployeePrompt } from "../../src/chat/employee-prompt";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-emp-prompt";

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/employees/james/onboarding`, { recursive: true });
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("buildEmployeePrompt", () => {
  test("builds prompt from employee body and state files", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Chief of Staff\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    writeFileSync(`${TEST_DIR}/employees/james/goals.md`, "# Goals\n- Grow the project");
    writeFileSync(`${TEST_DIR}/employees/james/memory.md`, "# Memory\n- Learned X");

    const prompt = buildEmployeePrompt("james");
    expect(prompt).toContain("You are James.");
    expect(prompt).toContain("Grow the project");
    expect(prompt).toContain("Learned X");
  });

  test("includes onboarding context if present", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Dev\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    writeFileSync(`${TEST_DIR}/employees/james/onboarding/brief.md`, "The project does X.");
    writeFileSync(`${TEST_DIR}/employees/james/onboarding/discovery.md`, "Found Y in repo.");

    const prompt = buildEmployeePrompt("james");
    expect(prompt).toContain("The project does X.");
    expect(prompt).toContain("Found Y in repo.");
  });

  test("returns empty string for unknown employee", () => {
    const prompt = buildEmployeePrompt("nobody");
    expect(prompt).toBe("");
  });
});
