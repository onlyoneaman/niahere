import { describe, expect, test } from "bun:test";
import { parseGuardFlags, withDefaultWait } from "../../src/core/engine-guard";

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

describe("withDefaultWait", () => {
  test("applies default wait when no wait or force was provided", () => {
    expect(withDefaultWait(parseGuardFlags([]), 1)).toEqual({ waitMinutes: 1, force: false });
  });

  test("preserves explicit wait", () => {
    expect(withDefaultWait(parseGuardFlags(["--wait", "3"]), 1)).toEqual({ waitMinutes: 3, force: false });
  });

  test("does not add wait when force is set", () => {
    expect(withDefaultWait(parseGuardFlags(["--force"]), 1)).toEqual({ waitMinutes: 0, force: true });
  });
});
