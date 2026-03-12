import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

export const log = pino({
  level,
  transport:
    process.stdout.isTTY
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;
