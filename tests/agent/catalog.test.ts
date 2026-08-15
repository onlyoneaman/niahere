import { describe, expect, it } from "bun:test";
import { codexModelSlugs, parseCodexModels } from "../../src/agent/catalog";

const CATALOG = JSON.stringify({
  models: [{ slug: "gpt-5.6-sol" }, { slug: "gpt-5.5" }, { slug: "codex-auto-review" }],
});

describe("parseCodexModels", () => {
  it("pulls the slugs out", () => {
    expect(parseCodexModels(CATALOG)).toEqual(["gpt-5.6-sol", "gpt-5.5", "codex-auto-review"]);
  });

  it("returns null for junk", () => {
    expect(parseCodexModels("not json")).toBeNull();
    expect(parseCodexModels("{}")).toBeNull();
  });

  it("drops entries with no usable slug", () => {
    expect(parseCodexModels(JSON.stringify({ models: [{ slug: "gpt-5.5" }, { slug: 7 }, {}] }))).toEqual(["gpt-5.5"]);
  });
});

describe("codexModelSlugs", () => {
  it("reads the catalog", async () => {
    expect(await codexModelSlugs(async () => ({ stdout: CATALOG, exitCode: 0 }))).toEqual([
      "gpt-5.6-sol",
      "gpt-5.5",
      "codex-auto-review",
    ]);
  });

  it("is unknown, not empty, when codex exits non-zero", async () => {
    expect(await codexModelSlugs(async () => ({ stdout: CATALOG, exitCode: 1 }))).toBeNull();
  });

  it("is unknown when the probe throws", async () => {
    expect(
      await codexModelSlugs(async () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});
