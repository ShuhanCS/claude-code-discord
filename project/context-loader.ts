/**
 * Project context loader — shows project info on first interaction in a channel.
 *
 * Loads git branch, uncommitted file count, recent commits, and todo status
 * and builds a Discord embed to greet the user with context.
 *
 * @module project/context-loader
 */

import type { EmbedData } from "../discord/types.ts";
import { SPECIAL_CHANNELS } from "./sync.ts";

// ================================
// Types
// ================================

export interface ProjectContext {
  projectName: string;
  projectPath: string;
  branch: string;
  uncommittedFiles: number;
  recentCommits: string[];
  hasTodo: boolean;
  todoPreview?: string;
  isSpecial: boolean;
}

// ================================
// Context Loading
// ================================

const specialChannelNames = new Set<string>(SPECIAL_CHANNELS.map((s) => s.name));

/**
 * Load project context from a project directory.
 *
 * Runs git commands to gather branch, status, and recent commit info.
 * Also checks for tasks/todo.md.
 *
 * @param projectDir - Path to the project directory
 * @param channelName - Channel name (to detect special channels)
 */
export async function loadProjectContext(
  projectDir: string,
  channelName?: string
): Promise<ProjectContext> {
  const projectName =
    projectDir.replace(/\\/g, "/").split("/").pop() || "unknown";
  const isSpecial = channelName
    ? specialChannelNames.has(channelName)
    : false;

  const ctx: ProjectContext = {
    projectName,
    projectPath: projectDir,
    branch: "unknown",
    uncommittedFiles: 0,
    recentCommits: [],
    hasTodo: false,
    isSpecial,
  };

  // For special channels like #general, return minimal context
  if (isSpecial) {
    return ctx;
  }

  // Check if it's a git repo
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  try {
    await Deno.stat(`${projectDir}${sep}.git`);
  } catch {
    // Not a git repo — return minimal context
    return ctx;
  }

  // Run git commands in parallel
  const [branchResult, statusResult, logResult] = await Promise.allSettled([
    runGit(["branch", "--show-current"], projectDir),
    runGit(["status", "--porcelain"], projectDir),
    runGit(["log", "--oneline", "-5"], projectDir),
  ]);

  if (branchResult.status === "fulfilled" && branchResult.value) {
    ctx.branch = branchResult.value.trim();
  }

  if (statusResult.status === "fulfilled" && statusResult.value) {
    const lines = statusResult.value
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    ctx.uncommittedFiles = lines.length;
  }

  if (logResult.status === "fulfilled" && logResult.value) {
    ctx.recentCommits = logResult.value
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 5);
  }

  // Check for tasks/todo.md
  try {
    const todoPath = `${projectDir}${sep}tasks${sep}todo.md`;
    const content = await Deno.readTextFile(todoPath);
    ctx.hasTodo = true;
    const lines = content.trim().split("\n").slice(0, 3);
    ctx.todoPreview = lines.join("\n");
  } catch {
    // No todo.md — that's fine
  }

  return ctx;
}

// ================================
// Embed Builder
// ================================

/**
 * Build a Discord embed from project context.
 *
 * - Green if working tree is clean
 * - Yellow if there are uncommitted changes
 * - Blue for special channels
 */
export function buildContextEmbed(ctx: ProjectContext): EmbedData {
  // Special channel embed
  if (ctx.isSpecial) {
    return {
      color: 0x5865f2, // Discord blurple
      title: `#${ctx.projectName}`,
      description: "No specific project — general workspace",
      fields: [
        {
          name: "Working Directory",
          value: `\`${ctx.projectPath}\``,
          inline: false,
        },
      ],
      footer: { text: "Context greeting" },
      timestamp: true,
    };
  }

  const color = ctx.uncommittedFiles > 0 ? 0xffaa00 : 0x00ff00;
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  fields.push({ name: "Branch", value: `\`${ctx.branch}\``, inline: true });
  fields.push({
    name: "Uncommitted",
    value: ctx.uncommittedFiles === 0
      ? "Clean"
      : `${ctx.uncommittedFiles} file${ctx.uncommittedFiles > 1 ? "s" : ""}`,
    inline: true,
  });

  if (ctx.recentCommits.length > 0) {
    const commitList = ctx.recentCommits
      .map((c) => `\`${c}\``)
      .join("\n");
    fields.push({
      name: "Recent Commits",
      value: commitList,
      inline: false,
    });
  }

  if (ctx.hasTodo && ctx.todoPreview) {
    fields.push({
      name: "Todo",
      value: `\`\`\`\n${ctx.todoPreview}\n\`\`\``,
      inline: false,
    });
  }

  return {
    color,
    title: `${ctx.projectName}`,
    description: `\`${ctx.projectPath}\``,
    fields,
    footer: { text: "Context greeting" },
    timestamp: true,
  };
}

// ================================
// Helpers
// ================================

async function runGit(args: string[], cwd: string): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "null",
  });
  const output = await cmd.output();
  return new TextDecoder().decode(output.stdout);
}
