import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { getPaths } from "./paths";

describe("getPaths", () => {
  test("returns all expected path keys", () => {
    const workspace = "/tmp/test-nia";
    const paths = getPaths(workspace);

    expect(paths.workspace).toBe(workspace);
    expect(paths.pid).toBe(resolve(workspace, "tmp/nia.pid"));
    expect(paths.daemonLog).toBe(resolve(workspace, "tmp/daemon.log"));
    expect(paths.cronState).toBe(resolve(workspace, "tmp/cron-state.json"));
    expect(paths.cronAudit).toBe(resolve(workspace, "tmp/cron-audit.jsonl"));
    expect(paths.config).toBe(resolve(workspace, "nia.yaml"));
    expect(paths.jobsDir).toBe(resolve(workspace, "jobs"));
    expect(paths.selfDir).toBe(resolve(workspace, "self"));
  });
});
