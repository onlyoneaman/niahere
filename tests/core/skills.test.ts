import { describe, expect, test } from "bun:test";
import { getSdkSkillsSetting } from "../../src/core/skills";

describe("SDK skill configuration", () => {
  test("enables all SDK-discovered skills", () => {
    expect(getSdkSkillsSetting()).toBe("all");
  });
});
