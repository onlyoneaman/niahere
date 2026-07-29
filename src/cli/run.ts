import { withDb } from "../db/with-db";

/** `nia run <prompt>` — one-shot terminal turn with a spinner and streamed output. */
export async function runPrompt(prompt: string): Promise<void> {
  const { createChatEngine } = await import("../chat/engine");
  const { getMcpServers } = await import("../mcp");
  const { DIM, RESET, CLEAR_LINE, SPINNER } = await import("../utils/cli");

  let frame = 0;
  let statusText = "thinking";
  let spinTimer: ReturnType<typeof setInterval> | null = null;
  let streamedLen = 0;
  let streaming = false;

  const renderSpinner = () => {
    process.stderr.write(`${CLEAR_LINE}${DIM}  ${SPINNER[frame]} ${statusText}${RESET}`);
    frame = (frame + 1) % SPINNER.length;
  };
  const stopSpinner = () => {
    if (spinTimer) {
      clearInterval(spinTimer);
      spinTimer = null;
    }
  };

  await withDb(async () => {
    const engine = await createChatEngine({
      room: "cli-run",
      channel: "terminal",
      resume: false,
      mcpServers: getMcpServers(),
    });
    spinTimer = setInterval(renderSpinner, 80);
    renderSpinner();

    const { result, costUsd, turns } = await engine.send(prompt, {
      onStream(textSoFar) {
        if (!streaming) {
          stopSpinner();
          process.stderr.write("\x1b[2K\r");
          streaming = true;
        }
        const chunk = textSoFar.slice(streamedLen);
        if (chunk) {
          process.stdout.write(chunk);
          streamedLen = textSoFar.length;
        }
      },
      onActivity(text) {
        if (!streaming) statusText = text;
      },
    });

    stopSpinner();

    if (!streaming && result.trim()) {
      process.stderr.write("\x1b[2K\r");
      process.stdout.write(result.trim());
    } else if (streaming) {
      const rest = result.slice(streamedLen);
      if (rest.trim()) process.stdout.write(rest);
    } else {
      process.stderr.write("\x1b[2K\r");
    }

    const costStr = costUsd > 0 ? `$${costUsd.toFixed(4)}` : "";
    const turnsStr = turns > 0 ? `${turns} turn${turns !== 1 ? "s" : ""}` : "";
    const meta = [costStr, turnsStr].filter(Boolean).join(" · ");
    if (meta) process.stderr.write(`\n${DIM}${meta}${RESET}`);
    process.stdout.write("\n");

    await engine.close();
  });
}
