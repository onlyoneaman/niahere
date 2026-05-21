import { Message, Session } from "../../db/models";

export async function listMessages(limit = 20, room?: string): Promise<string> {
  const messages = await Message.getRecent(limit, room);
  if (messages.length === 0) return "No messages found.";
  return JSON.stringify(messages, null, 2);
}

export async function listSessions(limit = 10, room?: string): Promise<string> {
  const sessions = await Session.listRecent(limit, room);
  if (sessions.length === 0) return "No sessions found.";
  return JSON.stringify(sessions, null, 2);
}

export async function searchMessages(query: string, limit = 20, room?: string): Promise<string> {
  const results = await Message.search(query, limit, room);
  if (results.length === 0) return "No matching messages found.";
  return JSON.stringify(results, null, 2);
}

export async function readSession(sessionId: string): Promise<string> {
  const messages = await Message.getBySession(sessionId);
  if (messages.length === 0) return "Session not found or has no messages.";
  return JSON.stringify(messages, null, 2);
}
