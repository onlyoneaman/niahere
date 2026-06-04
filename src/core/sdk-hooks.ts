import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

const GH_MERGE_PATTERN = /(?:^|[\s;&|(])gh\s+pr\s+merge(?:\s|$)/;

const STAMP_WARNING_CONTEXT = [
  "PreToolUse warning: this Bash command merges a GitHub PR.",
  "If the user only wants to APPROVE the PR (LGTM), use the gh-stamp skill",
  '(`gh pr comment <pr> --body "LGTM, Stamped ✅"`) instead of merging.',
  "Confirm intent before proceeding.",
].join(" ");

const STAMP_WARNING_MESSAGE =
  "Heads up: about to run `gh pr merge`. Did you mean to STAMP (LGTM approval) instead? See the gh-stamp skill.";

const warnOnGhMerge: HookCallbackMatcher = {
  matcher: "Bash",
  hooks: [
    async (input): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const command = (input as PreToolUseHookInput).tool_input as { command?: unknown } | undefined;
      const cmd = command?.command;
      if (typeof cmd !== "string" || !GH_MERGE_PATTERN.test(cmd)) return {};
      return {
        systemMessage: STAMP_WARNING_MESSAGE,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: STAMP_WARNING_CONTEXT,
        },
      };
    },
  ],
};

export function getSdkHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [warnOnGhMerge],
  };
}
