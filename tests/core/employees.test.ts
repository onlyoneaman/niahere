import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { scanEmployees, getEmployee } from "../../src/core/employees";
import { resetConfig } from "../../src/utils/config";

const TEST_DIR = "/tmp/test-nia-employees";

function niaEmployees() {
  return scanEmployees().filter((e) => e.source === "nia");
}

beforeEach(() => {
  mkdirSync(`${TEST_DIR}/employees/james`, { recursive: true });
  mkdirSync(`${TEST_DIR}/tmp`, { recursive: true });
  process.env.NIA_HOME = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NIA_HOME;
  resetConfig();
});

describe("scanEmployees", () => {
  test("discovers EMPLOYEE.md files with frontmatter", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: aicodeusage.com\nrepo: /tmp/aicodeusage\nrole: Chief of Staff\nmodel: opus\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nYou are James.`,
    );
    const employees = niaEmployees();
    expect(employees).toHaveLength(1);
    expect(employees[0].name).toBe("james");
    expect(employees[0].project).toBe("aicodeusage.com");
    expect(employees[0].repo).toBe("/tmp/aicodeusage");
    expect(employees[0].role).toBe("Chief of Staff");
    expect(employees[0].model).toBe("opus");
    expect(employees[0].status).toBe("active");
    expect(employees[0].maxSubEmployees).toBe(3);
    expect(employees[0].body).toBe("You are James.");
  });

  test("skips directories without EMPLOYEE.md", () => {
    mkdirSync(`${TEST_DIR}/employees/empty`, { recursive: true });
    const employees = niaEmployees();
    expect(employees).toHaveLength(0);
  });

  test("skips files with invalid frontmatter", () => {
    writeFileSync(`${TEST_DIR}/employees/james/EMPLOYEE.md`, "no frontmatter here");
    const employees = niaEmployees();
    expect(employees).toHaveLength(0);
  });
});

describe("getEmployee", () => {
  test("returns employee by name", () => {
    writeFileSync(
      `${TEST_DIR}/employees/james/EMPLOYEE.md`,
      `---\nname: james\nproject: test\nrepo: /tmp/test\nrole: Dev\nstatus: active\nmaxSubEmployees: 3\ncreated: 2026-04-12\n---\n\nBody.`,
    );
    const emp = getEmployee("james");
    expect(emp).toBeDefined();
    expect(emp!.name).toBe("james");
  });

  test("returns undefined for unknown employee", () => {
    const emp = getEmployee("nobody");
    expect(emp).toBeUndefined();
  });
});
