export interface SaveMessageParams {
  sessionId: string;
  room: string;
  sender: string;
  content: string;
  isFromAgent: boolean;
}

export interface RoomStats {
  room: string;
  sessions: number;
  messages: number;
  lastActivity: string | null;
}

export interface RecentMessage {
  room: string;
  sender: string;
  content: string;
  isFromAgent: boolean;
  createdAt: string;
}
