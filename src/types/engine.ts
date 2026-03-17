export interface SendResult {
  result: string;
  costUsd: number;
  turns: number;
}

export type StreamCallback = (textSoFar: string) => void;
export type ActivityCallback = (status: string) => void;

export interface SendCallbacks {
  onStream?: StreamCallback;
  onActivity?: ActivityCallback;
}

export interface ChatEngine {
  sessionId: string | null;
  room: string;
  send(userMessage: string, callbacks?: SendCallbacks, attachments?: import("./attachment").Attachment[]): Promise<SendResult>;
  close(): void;
}

export interface EngineOptions {
  room: string;
  channel: string;
  /** true = resume latest session, or pass a specific session ID */
  resume: boolean | string;
  mcpServers?: Record<string, unknown>;
}
