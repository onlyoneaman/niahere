import { describe, expect, test } from "bun:test";
import { parseGuardFlags } from "../../src/core/engine-guard";

describe("parseGuardFlags", () => {
  test("returns defaults for empty args", () => {
    expect(parseGuardFlags([])).toEqual({ waitMinutes: 0, force: false });
  });

  test("--force sets force to true", () => {
    expect(parseGuardFlags(["--force"])).toEqual({ force: true, waitMinutes: 0 });
  });

  test("-f sets force to true", () => {
    expect(parseGuardFlags(["-f"])).toEqual({ force: true, waitMinutes: 0 });
  });

  test("--wait parses minutes", () => {
    expect(parseGuardFlags(["--wait", "5"])).toEqual({ waitMinutes: 5, force: false });
  });

  test("--wait with invalid value defaults to 0", () => {
    expect(parseGuardFlags(["--wait", "abc"])).toEqual({ waitMinutes: 0, force: false });
  });

  test("--force and --wait together", () => {
    expect(parseGuardFlags(["--force", "--wait", "3"])).toEqual({ force: true, waitMinutes: 3 });
  });
});
