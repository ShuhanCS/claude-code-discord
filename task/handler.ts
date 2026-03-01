/**
 * Task board handler — enforces 3 rules:
 * 1. Every task gets a unique auto-incrementing ID
 * 2. DONE requires proof (commit hash, URL, or text)
 * 3. Parent tasks cannot close while sub-tasks are open
 *
 * @module task/handler
 */

import type { Task, TaskProof, TaskStore } from "./types.ts";
import { getTaskStoreManager } from "../util/persistence.ts";

const DEFAULT_STORE: TaskStore = { nextId: 1, tasks: [] };

// ================================
// Helpers
// ================================

/** Format task ID: T-001, T-002, ... (expands beyond 999) */
function formatId(n: number): string {
  return `T-${String(n).padStart(3, "0")}`;
}

/** Detect proof type from raw string */
function detectProofType(value: string): TaskProof["type"] {
  // URL pattern
  if (/^https?:\/\//i.test(value)) return "url";
  // Commit hash pattern: 7-40 hex chars
  if (/^[0-9a-f]{7,40}$/i.test(value)) return "commit";
  return "text";
}

/** Status color for embeds */
function statusColor(status: Task["status"]): number {
  switch (status) {
    case "open": return 0xffffff;
    case "in-progress": return 0xffaa00;
    case "done": return 0x00cc00;
  }
}

/** Status emoji */
function statusEmoji(status: Task["status"]): string {
  switch (status) {
    case "open": return "\u26aa";       // white circle
    case "in-progress": return "\ud83d\udfe1"; // yellow circle
    case "done": return "\u2705";       // green check
  }
}

/** Format a single task line for list view */
function taskLine(task: Task, indent = false): string {
  const prefix = indent ? "  \u2514 " : "";
  const assignee = task.assignee ? ` <@${task.assignee}>` : "";
  return `${prefix}${statusEmoji(task.status)} **${task.id}** ${task.title}${assignee}`;
}

// ================================
// Handler factory
// ================================

export function createTaskHandlers() {
  const pm = getTaskStoreManager();

  async function getStore(): Promise<TaskStore> {
    return pm.get(DEFAULT_STORE);
  }

  async function saveStore(store: TaskStore): Promise<void> {
    await pm.save(store);
  }

  return {
    // deno-lint-ignore no-explicit-any
    async onTask(ctx: any, action: string, id?: string, title?: string, proof?: string, parent?: string, status?: string) {
      switch (action) {
        // --------------------------------
        // CREATE
        // --------------------------------
        case "create": {
          if (!title) {
            return { content: "Title is required. Usage: `/task action:create title:My task`" };
          }
          const store = await getStore();
          const taskId = formatId(store.nextId);
          const now = new Date().toISOString();

          // Validate parent exists if provided
          if (parent) {
            const parentTask = store.tasks.find(t => t.id === parent);
            if (!parentTask) {
              return {
                embeds: [{
                  color: 0xff4444,
                  title: "Parent not found",
                  description: `No task with ID **${parent}** exists.`,
                }]
              };
            }
          }

          const task: Task = {
            id: taskId,
            title,
            status: "open",
            parentId: parent,
            assignee: ctx.getUserId?.() ?? undefined,
            createdAt: now,
            updatedAt: now,
          };

          store.tasks.push(task);
          store.nextId++;
          await saveStore(store);

          const parentNote = parent ? `\nParent: **${parent}**` : "";
          return {
            embeds: [{
              color: 0x0099ff,
              title: `Task created: ${taskId}`,
              description: `**${title}**${parentNote}`,
              footer: { text: `Status: open | Created by ${task.assignee ? `<@${task.assignee}>` : "unknown"}` },
              timestamp: true,
            }]
          };
        }

        // --------------------------------
        // LIST
        // --------------------------------
        case "list": {
          const store = await getStore();
          const filter = status || "active"; // default: open + in-progress
          let filtered: Task[];

          if (filter === "all") {
            filtered = store.tasks;
          } else if (filter === "active") {
            filtered = store.tasks.filter(t => t.status !== "done");
          } else {
            filtered = store.tasks.filter(t => t.status === filter);
          }

          if (filtered.length === 0) {
            return {
              embeds: [{
                color: 0x808080,
                title: "Task Board",
                description: `No tasks found (filter: ${filter}).`,
              }]
            };
          }

          // Build hierarchical display: top-level first, then children indented
          const topLevel = filtered.filter(t => !t.parentId);
          const children = filtered.filter(t => t.parentId);
          const lines: string[] = [];

          for (const task of topLevel) {
            lines.push(taskLine(task));
            const kids = children.filter(c => c.parentId === task.id);
            for (const kid of kids) {
              lines.push(taskLine(kid, true));
            }
          }

          // Orphan children (parent not in filtered set)
          const shownChildIds = new Set(topLevel.flatMap(t =>
            children.filter(c => c.parentId === t.id).map(c => c.id)
          ));
          const orphans = children.filter(c => !shownChildIds.has(c.id));
          for (const o of orphans) {
            lines.push(taskLine(o));
          }

          return {
            embeds: [{
              color: 0x0099ff,
              title: "Task Board",
              description: lines.join("\n"),
              footer: { text: `${filtered.length} task(s) | Filter: ${filter}` },
            }]
          };
        }

        // --------------------------------
        // SHOW
        // --------------------------------
        case "show": {
          if (!id) return { content: "Task ID required. Usage: `/task action:show id:T-001`" };
          const store = await getStore();
          const task = store.tasks.find(t => t.id === id);
          if (!task) return { embeds: [{ color: 0xff4444, title: "Not found", description: `No task with ID **${id}**.` }] };

          const children = store.tasks.filter(t => t.parentId === id);
          const fields: { name: string; value: string; inline: boolean }[] = [
            { name: "Status", value: `${statusEmoji(task.status)} ${task.status}`, inline: true },
            { name: "Created", value: `<t:${Math.floor(new Date(task.createdAt).getTime() / 1000)}:R>`, inline: true },
          ];

          if (task.assignee) {
            fields.push({ name: "Assignee", value: `<@${task.assignee}>`, inline: true });
          }
          if (task.parentId) {
            fields.push({ name: "Parent", value: task.parentId, inline: true });
          }
          if (task.proof) {
            fields.push({ name: `Proof (${task.proof.type})`, value: task.proof.value, inline: false });
          }
          if (task.closedAt) {
            fields.push({ name: "Closed", value: `<t:${Math.floor(new Date(task.closedAt).getTime() / 1000)}:R>`, inline: true });
          }
          if (children.length > 0) {
            fields.push({
              name: `Sub-tasks (${children.length})`,
              value: children.map(c => taskLine(c, true)).join("\n"),
              inline: false,
            });
          }

          return {
            embeds: [{
              color: statusColor(task.status),
              title: `${task.id}: ${task.title}`,
              description: task.description || undefined,
              fields,
              timestamp: true,
            }]
          };
        }

        // --------------------------------
        // START
        // --------------------------------
        case "start": {
          if (!id) return { content: "Task ID required. Usage: `/task action:start id:T-001`" };
          const store = await getStore();
          const task = store.tasks.find(t => t.id === id);
          if (!task) return { embeds: [{ color: 0xff4444, title: "Not found", description: `No task with ID **${id}**.` }] };
          if (task.status === "done") return { content: `**${id}** is already done. Use \`reopen\` first.` };
          if (task.status === "in-progress") return { content: `**${id}** is already in progress.` };

          task.status = "in-progress";
          task.updatedAt = new Date().toISOString();
          await saveStore(store);

          return {
            embeds: [{
              color: 0xffaa00,
              title: `Started: ${id}`,
              description: task.title,
              timestamp: true,
            }]
          };
        }

        // --------------------------------
        // DONE — enforces Rule 2 (proof) and Rule 3 (children)
        // --------------------------------
        case "done": {
          if (!id) return { content: "Task ID required. Usage: `/task action:done id:T-001 proof:https://...`" };
          const store = await getStore();
          const task = store.tasks.find(t => t.id === id);
          if (!task) return { embeds: [{ color: 0xff4444, title: "Not found", description: `No task with ID **${id}**.` }] };
          if (task.status === "done") return { content: `**${id}** is already done.` };

          // Rule 2: proof required
          if (!proof) {
            return {
              embeds: [{
                color: 0xff4444,
                title: "Proof required",
                description: "Provide a commit hash, URL, or description of what was done.\n\n`/task action:done id:" + id + " proof:<your evidence>`",
              }]
            };
          }

          // Rule 3: check open sub-tasks
          const openChildren = store.tasks.filter(t => t.parentId === id && t.status !== "done");
          if (openChildren.length > 0) {
            return {
              embeds: [{
                color: 0xff4444,
                title: "Cannot close \u2014 open sub-tasks",
                description: openChildren.map(c => `${statusEmoji(c.status)} **${c.id}**: ${c.title} (${c.status})`).join("\n"),
                footer: { text: "Close all sub-tasks before closing the parent." },
              }]
            };
          }

          const now = new Date().toISOString();
          task.status = "done";
          task.proof = { type: detectProofType(proof), value: proof };
          task.updatedAt = now;
          task.closedAt = now;
          await saveStore(store);

          return {
            embeds: [{
              color: 0x00cc00,
              title: `Done: ${id}`,
              description: task.title,
              fields: [
                { name: `Proof (${task.proof.type})`, value: task.proof.value, inline: false },
              ],
              timestamp: true,
            }]
          };
        }

        // --------------------------------
        // REOPEN
        // --------------------------------
        case "reopen": {
          if (!id) return { content: "Task ID required. Usage: `/task action:reopen id:T-001`" };
          const store = await getStore();
          const task = store.tasks.find(t => t.id === id);
          if (!task) return { embeds: [{ color: 0xff4444, title: "Not found", description: `No task with ID **${id}**.` }] };
          if (task.status !== "done") return { content: `**${id}** is not done (current: ${task.status}).` };

          task.status = "open";
          task.proof = undefined;
          task.closedAt = undefined;
          task.updatedAt = new Date().toISOString();
          await saveStore(store);

          return {
            embeds: [{
              color: 0xffffff,
              title: `Reopened: ${id}`,
              description: task.title,
              timestamp: true,
            }]
          };
        }

        default:
          return { content: `Unknown action: \`${action}\`. Valid: create, list, show, start, done, reopen.` };
      }
    },

    /** Autocomplete for task ID — returns open/in-progress tasks */
    async autocompleteTaskId(typed: string): Promise<{ name: string; value: string }[]> {
      const store = await getStore();
      return store.tasks
        .filter(t => t.status !== "done")
        .filter(t =>
          t.id.toLowerCase().includes(typed.toLowerCase()) ||
          t.title.toLowerCase().includes(typed.toLowerCase())
        )
        .slice(0, 25)
        .map(t => ({ name: `${t.id}: ${t.title}`.slice(0, 100), value: t.id }));
    },

    /** Autocomplete for parent ID — returns all non-done tasks */
    async autocompleteParentId(typed: string): Promise<{ name: string; value: string }[]> {
      const store = await getStore();
      return store.tasks
        .filter(t => t.status !== "done")
        .filter(t =>
          t.id.toLowerCase().includes(typed.toLowerCase()) ||
          t.title.toLowerCase().includes(typed.toLowerCase())
        )
        .slice(0, 25)
        .map(t => ({ name: `${t.id}: ${t.title}`.slice(0, 100), value: t.id }));
    },
  };
}
