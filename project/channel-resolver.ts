import { sanitizeChannelName } from "../discord/utils.ts";
import { getProjectsDir, getBotProjectDir } from "./sync.ts";

/** Strip everything except alphanumeric chars for fuzzy comparison */
function normalize(s: string): string {
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a Discord channel name to a project directory.
 *
 * Scans getProjectsDir() and uses multi-phase matching:
 *   0. Special channels: "general" → projects root, "discord-bot" → bot source dir
 *   1. Exact match: sanitized folder name === channel name
 *   2. Normalized prefix: channel (stripped) starts with folder (stripped)
 *      → takes the LONGEST match to avoid ambiguity
 *      → minimum 5 chars to prevent false positives on short folder names
 *
 * - If channelName is "main" → returns currentWorkDir (keep current project)
 * - If no match → returns currentWorkDir (logs a warning)
 */
export function resolveChannelToProject(channelName: string, currentWorkDir: string): string {
  // Special channels
  if (channelName === "general") {
    return getProjectsDir();
  }
  if (channelName === "discord-bot") {
    return getBotProjectDir();
  }

  // "main" channel always keeps the current project
  if (channelName === "main") {
    return currentWorkDir;
  }

  const sep = Deno.build.os === "windows" ? "\\" : "/";
  let bestPrefixMatch: { name: string; len: number } | null = null;
  const normChannel = normalize(channelName);

  try {
    for (const entry of Deno.readDirSync(getProjectsDir())) {
      if (!entry.isDirectory) continue;

      const sanitized = sanitizeChannelName(entry.name);

      // Phase 1: Exact match
      if (sanitized === channelName) {
        return `${getProjectsDir()}${sep}${entry.name}`;
      }

      // Phase 2: Normalized prefix match
      // e.g. channel "conductvisionai-rebuild" → "conductvisionairebuild"
      //      folder "conductvision.ai"         → "conductvisionai"
      //      "conductvisionairebuild" starts with "conductvisionai" → match
      const normFolder = normalize(sanitized);
      if (normFolder.length >= 5 && normChannel.startsWith(normFolder)) {
        if (!bestPrefixMatch || normFolder.length > bestPrefixMatch.len) {
          bestPrefixMatch = { name: entry.name, len: normFolder.length };
        }
      }
    }
  } catch (err) {
    console.warn(`[channel-resolver] Cannot read projects dir ${getProjectsDir()}: ${err}`);
  }

  // Return best prefix match if found
  if (bestPrefixMatch) {
    console.log(`[channel-resolver] Prefix match: #${channelName} → ${bestPrefixMatch.name}`);
    return `${getProjectsDir()}${sep}${bestPrefixMatch.name}`;
  }

  // No match — keep current project, log warning
  console.warn(`[channel-resolver] No project match for channel #${channelName} — using ${currentWorkDir}`);
  return currentWorkDir;
}
