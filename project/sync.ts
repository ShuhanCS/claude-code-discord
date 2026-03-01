/**
 * Project scanner and channel synchronization.
 *
 * Scans PROJECTS_DIR for git repos with recent activity and syncs
 * Discord channels to match, creating missing channels and reporting stale ones.
 *
 * @module project/sync
 */

import { sanitizeChannelName } from "../discord/utils.ts";
import { ChannelType, type TextChannel } from "npm:discord.js@14.14.1";

// ================================
// Types
// ================================

export interface ProjectInfo {
  /** Folder name */
  name: string;
  /** sanitizeChannelName(name) */
  channelName: string;
  /** Full path to the project directory */
  path: string;
  /** Current git branch */
  branch: string;
  /** Days since last commit */
  lastCommitDays: number;
}

export interface SyncResult {
  /** Channels created this run */
  created: string[];
  /** Channels that already existed */
  existing: string[];
  /** Channels with no matching project (report only, never delete) */
  stale: string[];
}

// ================================
// Constants
// ================================

export const SPECIAL_CHANNELS = [
  { name: "general", topic: "Cross-project discussions and infrastructure" },
  { name: "discord-bot", topic: "Discuss and improve this Discord bot" },
] as const;

/** Folders to skip when scanning projects */
const EXCLUSIONS = new Set([
  "__pycache__",
  "_temp",
  "tmp",
  "archive",
  "node_modules",
  ".claude",
  ".git",
  ".vscode",
  "daily-log",
]);

// ================================
// Shared Helpers
// ================================

/** Derive PROJECTS_DIR from environment — lazy to avoid reading env before .env is loaded */
export function getProjectsDir(): string {
  return (
    Deno.env.get("PROJECTS_DIR") ||
    Deno.env.get("WORK_DIR") ||
    `${Deno.env.get("USERPROFILE") || Deno.env.get("HOME")}${
      Deno.build.os === "windows" ? "\\" : "/"
    }projects`
  );
}

/** Derive the bot's own source directory from import.meta.url */
export function getBotProjectDir(): string {
  const url = new URL(".", import.meta.url);
  // import.meta.url for this file is something like file:///C:/Users/.../project/sync.ts
  // We want the parent directory (the bot repo root)
  let filePath = url.pathname;

  // On Windows, pathname starts with /C:/ — strip the leading slash
  if (Deno.build.os === "windows" && filePath.startsWith("/")) {
    filePath = filePath.slice(1);
  }

  // Decode URI components (e.g. %20 → space)
  filePath = decodeURIComponent(filePath);

  // This file is in project/ — go up one level to get the bot root
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  // Normalize separators
  filePath = filePath.replace(/\//g, sep);
  // Remove trailing separator
  if (filePath.endsWith(sep)) {
    filePath = filePath.slice(0, -1);
  }
  // Go up from project/ to bot root
  const lastSep = filePath.lastIndexOf(sep);
  if (lastSep > 0) {
    filePath = filePath.substring(0, lastSep);
  }

  return filePath;
}

// ================================
// Project Scanner
// ================================

/**
 * Scan a directory for git repos with recent commit activity.
 *
 * @param projectsDir - Directory containing project folders
 * @param maxAgeDays - Only include projects with commits within this many days (default: 30)
 * @returns Array of ProjectInfo sorted by lastCommitDays (most recent first)
 */
export async function scanActiveProjects(
  projectsDir: string,
  maxAgeDays = 7
): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  const now = Date.now();

  try {
    for await (const entry of Deno.readDir(projectsDir)) {
      if (!entry.isDirectory) continue;
      if (EXCLUSIONS.has(entry.name)) continue;
      // Skip hidden directories
      if (entry.name.startsWith(".")) continue;

      const projectPath = `${projectsDir}${sep}${entry.name}`;

      // Check if it's a git repo
      try {
        await Deno.stat(`${projectPath}${sep}.git`);
      } catch {
        // Not a git repo — skip
        continue;
      }

      // Get last commit timestamp
      let lastCommitDays = Infinity;
      let branch = "unknown";

      try {
        const logCmd = new Deno.Command("git", {
          args: ["log", "-1", "--format=%ct"],
          cwd: projectPath,
          stdout: "piped",
          stderr: "null",
        });
        const logOutput = await logCmd.output();
        const timestamp = parseInt(
          new TextDecoder().decode(logOutput.stdout).trim()
        );
        if (!isNaN(timestamp)) {
          lastCommitDays = Math.floor(
            (now - timestamp * 1000) / (1000 * 60 * 60 * 24)
          );
        }
      } catch {
        // Can't read git log — skip
        continue;
      }

      // Filter by recency
      if (lastCommitDays > maxAgeDays) continue;

      // Get current branch
      try {
        const branchCmd = new Deno.Command("git", {
          args: ["branch", "--show-current"],
          cwd: projectPath,
          stdout: "piped",
          stderr: "null",
        });
        const branchOutput = await branchCmd.output();
        const branchStr = new TextDecoder()
          .decode(branchOutput.stdout)
          .trim();
        if (branchStr) branch = branchStr;
      } catch {
        // branch stays "unknown"
      }

      projects.push({
        name: entry.name,
        channelName: sanitizeChannelName(entry.name),
        path: projectPath,
        branch,
        lastCommitDays,
      });
    }
  } catch (err) {
    console.error(`[sync] Cannot scan ${projectsDir}: ${err}`);
  }

  // Sort by most recently active first
  projects.sort((a, b) => a.lastCommitDays - b.lastCommitDays);
  return projects;
}

// ================================
// Channel Sync
// ================================

/** Discord allows max 50 text channels per category */
const DISCORD_CATEGORY_CHANNEL_LIMIT = 50;

/**
 * Sync Discord channels to match active projects.
 *
 * Creates special channels first (#general, #discord-bot), then fills
 * remaining slots with the most recently active projects. Respects
 * Discord's 50-channel-per-category limit. Reports stale channels
 * (channels with no matching project) but never deletes them.
 *
 * @param guild - Discord.js Guild object
 * @param categoryId - ID of the bot's category
 * @param projects - Active projects from scanActiveProjects() (already sorted by recency)
 * @returns SyncResult with created/existing/stale channel names
 */
// deno-lint-ignore no-explicit-any
export async function syncChannelsToProjects(
  guild: any,
  categoryId: string,
  projects: ProjectInfo[]
): Promise<SyncResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const stale: string[] = [];

  // Build set of desired channel names (projects + special)
  const desiredNames = new Set<string>();
  for (const p of projects) {
    desiredNames.add(p.channelName);
  }
  for (const s of SPECIAL_CHANNELS) {
    desiredNames.add(s.name);
  }

  // Get existing channels in the category
  const existingChannels = guild.channels.cache.filter(
    // deno-lint-ignore no-explicit-any
    (c: any) => c.type === ChannelType.GuildText && c.parentId === categoryId
  );

  const existingNames = new Set<string>();
  // deno-lint-ignore no-explicit-any
  existingChannels.forEach((ch: any) => {
    existingNames.add(ch.name);
  });

  // Track current channel count in category
  let channelCount = existingNames.size;

  // 1. Special channels FIRST — guaranteed slots
  for (const special of SPECIAL_CHANNELS) {
    if (existingNames.has(special.name)) {
      existing.push(special.name);
      continue;
    }

    if (channelCount >= DISCORD_CATEGORY_CHANNEL_LIMIT) {
      console.warn(`[sync] Hit ${DISCORD_CATEGORY_CHANNEL_LIMIT}-channel limit — cannot create #${special.name}`);
      break;
    }

    try {
      await guild.channels.create({
        name: special.name,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: special.topic,
      });
      created.push(special.name);
      channelCount++;
      console.log(`[sync] Created special channel #${special.name}`);
    } catch (err) {
      console.error(
        `[sync] Failed to create special channel #${special.name}: ${err}`
      );
    }
  }

  // 2. Project channels — fill remaining slots (projects already sorted by recency)
  for (const project of projects) {
    if (existingNames.has(project.channelName)) {
      existing.push(project.channelName);
      continue;
    }

    if (channelCount >= DISCORD_CATEGORY_CHANNEL_LIMIT) {
      console.log(`[sync] Hit ${DISCORD_CATEGORY_CHANNEL_LIMIT}-channel limit — skipping remaining ${projects.length - projects.indexOf(project)} projects`);
      break;
    }

    try {
      await guild.channels.create({
        name: project.channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Project: ${project.name} | Branch: ${project.branch} | Path: ${project.path}`,
      });
      created.push(project.channelName);
      channelCount++;
      console.log(`[sync] Created channel #${project.channelName}`);
    } catch (err) {
      console.error(
        `[sync] Failed to create channel #${project.channelName}: ${err}`
      );
    }
  }

  // Find stale channels (exist in Discord but no matching project or special)
  for (const name of existingNames) {
    if (!desiredNames.has(name)) {
      stale.push(name);
    }
  }

  return { created, existing, stale };
}
