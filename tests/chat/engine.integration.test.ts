import { describe, test, expect, beforeAll } from "bun:test";
import { query } from "@anthropic-ai/claude-agent-sdk";

// Strip nested-session env vars so tests work inside Claude Code
beforeAll(() => {
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  delete process.env.CLAUDE_AGENT_SDK_VERSION;
});

/**
 * Integration tests for the SDK query() path used by Slack/Telegram/Terminal.
 */
describe("chat engine SDK integration", () => {
  test("query() spawns claude and gets a response", async () => {
    const handle = query({
      prompt: "Reply with exactly: PONG",
      options: {
        systemPrompt: "You are a test bot. Reply concisely.",
        cwd: process.env.HOME!,
        permissionMode: "bypassPermissions",
        continue: false,
        maxTurns: 1,
      } as any,
    });

    let result = "";
    let gotInit = false;
    let gotResult = false;

    try {
      for await (const message of handle) {
        if (message.type === "system" && (message as any).subtype === "init") {
          gotInit = true;
        }
        if (message.type === "result" && !message.is_error) {
          gotResult = true;
          result = (message as any).result || "";
        }
      }
    } catch (err: any) {
      throw new Error(
        `SDK query() threw: ${err.message}\n` +
          `  gotInit=${gotInit}, gotResult=${gotResult}\n` +
          `  CLAUDECODE=${process.env.CLAUDECODE || "(unset)"}\n` +
          `  Hint: if exit code 1, check 'claude --version' and ANTHROPIC_API_KEY`,
      );
    }

    expect(gotInit).toBe(true);
    expect(gotResult).toBe(true);
    expect(result.toLowerCase()).toContain("pong");
  }, 30_000);

  test("fresh session (continue: false) does not reference prior context", async () => {
    // First session: tell it a secret
    const session1 = query({
      prompt: 'Remember this secret code: BANANA42. Reply with "Got it."',
      options: {
        systemPrompt: "You are a test bot. Reply concisely.",
        cwd: process.env.HOME!,
        permissionMode: "bypassPermissions",
        continue: false,
        maxTurns: 1,
      } as any,
    });

    let session1Id = "";
    for await (const msg of session1) {
      if (msg.type === "system" && (msg as any).subtype === "init") {
        session1Id = (msg as any).session_id;
      }
      // drain to completion
    }
    expect(session1Id).toBeTruthy();

    // Second session: ask for the secret — should NOT know it
    const session2 = query({
      prompt: 'What is the secret code I told you? If you don\'t know, reply exactly "NO_CONTEXT".',
      options: {
        systemPrompt: "You are a test bot. Reply concisely. If you have no prior context, say NO_CONTEXT.",
        cwd: process.env.HOME!,
        permissionMode: "bypassPermissions",
        continue: false,
        maxTurns: 1,
      } as any,
    });

    let session2Id = "";
    let result = "";
    for await (const msg of session2) {
      if (msg.type === "system" && (msg as any).subtype === "init") {
        session2Id = (msg as any).session_id;
      }
      if (msg.type === "result" && !msg.is_error) {
        result = (msg as any).result || "";
      }
    }

    // Must be a different session
    expect(session2Id).toBeTruthy();
    expect(session2Id).not.toBe(session1Id);

    // Should NOT contain the secret from session 1
    expect(result.toUpperCase()).not.toContain("BANANA42");
  }, 60_000);
});
