export interface Peer {
  id: string;
  host: string;
  port: number;
  since: number;
}

export interface ChatMessage {
  from: string;
  fromHost: string;
  text: string;
  timestamp: number;
}

export interface ChatConfig {
  port: number;
  agentId: string;
  allowedPeers: string[];
  historyPath: string;
  maxHistory: number;
}

export interface HistoryEntry {
  from: string;
  text: string;
  timestamp: number;
  direction: "inbound" | "outbound";
}
