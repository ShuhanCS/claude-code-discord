/**
 * Task board types — structured task management with enforced rules.
 *
 * Rules:
 * 1. Every task gets a unique auto-incrementing ID (T-001, T-002, ...)
 * 2. DONE requires proof (commit hash, URL, or text evidence)
 * 3. Parent tasks cannot close while sub-tasks are still open
 *
 * @module task/types
 */

export interface TaskProof {
  type: "commit" | "url" | "text";
  value: string;
}

export interface Task {
  id: string;              // T-001, T-002, ...
  title: string;
  description?: string;
  status: "open" | "in-progress" | "done";
  parentId?: string;       // T-xxx — creates hierarchy
  proof?: TaskProof;       // REQUIRED to move to "done"
  assignee?: string;       // Discord user ID
  createdAt: string;       // ISO
  updatedAt: string;       // ISO
  closedAt?: string;       // ISO — when status moved to "done"
}

export interface TaskStore {
  nextId: number;          // auto-increment counter (never resets)
  tasks: Task[];
}
