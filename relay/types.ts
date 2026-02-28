export interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  project: string;
  sessionId: string;
  cwd: string;
  decision: "pending" | "allow" | "deny";
  createdAt: number;
}

export interface NotificationRequest {
  id: string;
  eventName: string;
  project: string;
  sessionId: string;
  cwd: string;
  rawInput: Record<string, unknown>;
  createdAt: number;
}
