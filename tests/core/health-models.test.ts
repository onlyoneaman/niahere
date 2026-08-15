import { describe, expect, it } from "bun:test";
import { auditModelPlan, auditFailover, FAILOVER_INCIDENT_MS } from "../../src/core/health";
import { createProviderHealth } from "../../src/agent/health";
import { planChain } from "../../src/agent/models";

const all = { available: () => true };
type Codex = { available: boolean; slugs: string[] | null };
const codexHere: Codex = { available: true, slugs: ["gpt-5.6-sol", "gpt-5.5"] };

function audit(configured: string[], codex: Codex = codexHere) {
  return auditModelPlan(configured, planChain(configured[0]!, configured.slice(1), all), codex);
}

describe("auditModelPlan", () => {
  it("reports the chain it will actually walk", () => {
    const check = audit(["sonnet", "gpt-5.6-sol"]);
    expect(check).toEqual({ name: "models", status: "ok", detail: "claude:sonnet → codex:gpt-5.6-sol" });
  });

  it("names the implicit tail a bare config falls back to", () => {
    expect(audit(["sonnet"]).detail).toBe("claude:sonnet → codex:default");
  });

  it("warns when a fallback model has been retired upstream", () => {
    const check = audit(["sonnet", "gpt-5-codex"]);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("gpt-5-codex: retired");
  });

  it("fails when the primary model has been retired upstream", () => {
    const check = audit(["gpt-5-codex"]);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("gpt-5-codex: retired");
  });

  it("never calls a model retired on an unreadable catalog", () => {
    expect(audit(["sonnet", "gpt-5-codex"], { available: true, slugs: null }).status).toBe("ok");
  });

  it("warns when a configured codex model has no codex to run on", () => {
    const check = audit(["sonnet", "gpt-5.6-sol"], { available: false, slugs: null });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("codex CLI not installed");
  });

  it("warns when config names a provider with no adapter", () => {
    const check = audit(["sonnet", "gemini-2.5-pro"]);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("no gemini adapter");
  });

  it("leaves an unnamed codex entry alone — it picks its own model", () => {
    expect(audit(["sonnet", "codex"]).status).toBe("ok");
  });
});

describe("auditFailover", () => {
  it("says nothing while the primary is serving", () => {
    expect(auditFailover(null, "claude")).toEqual({ name: "failover", status: "ok", detail: "primary serving" });
  });

  it("warns on a fresh failover — a blip is not an incident", () => {
    const c = auditFailover(5 * 60_000, "codex");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("5m");
    expect(c.detail).toContain("codex");
  });

  it("fails once the chain has simply moved", () => {
    const c = auditFailover(16 * 24 * 3_600_000, "codex");
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("primary has not served");
  });

  it("draws the line at an hour", () => {
    expect(auditFailover(FAILOVER_INCIDENT_MS - 1, "codex").status).toBe("warn");
    expect(auditFailover(FAILOVER_INCIDENT_MS, "codex").status).toBe("fail");
  });
});

describe("providerHealth failover tracking", () => {
  it("starts the clock when a fallback covers, stops it when the primary returns", () => {
    let t = 1_000_000;
    const h = createProviderHealth(1000, () => t);
    expect(h.fallbackStreakMs()).toBeNull();

    h.markServed("codex", false);
    t += 90 * 60_000;
    expect(h.fallbackStreakMs()).toBe(90 * 60_000);
    expect(h.lastServer()).toBe("codex");

    h.markServed("claude", true);
    expect(h.fallbackStreakMs()).toBeNull();
  });

  it("keeps the original failover time across repeated fallback turns", () => {
    let t = 0;
    const h = createProviderHealth(1000, () => t);
    h.markServed("codex", false);
    t += 60_000;
    h.markServed("codex", false);
    t += 60_000;
    expect(h.fallbackStreakMs()).toBe(120_000);
  });
});
