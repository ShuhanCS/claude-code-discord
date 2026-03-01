/**
 * Structured error capture for the self-healing pipeline.
 *
 * Writes errors to error_log.json in the project root.
 * The gotham/healer/watcher.py reads this file locally and invokes Claude Code to fix.
 *
 * Schema matches Gotham's error_reporter.py for healer compatibility.
 */

import { createHash } from "node:crypto";

const ERROR_LOG = new URL("../error_log.json", import.meta.url).pathname
  .replace(/^\/([A-Z]:)/, "$1"); // Fix Windows path (remove leading /)
const MAX_LOG_ENTRIES = 50;

interface ErrorLogEntry {
  timestamp: string;
  fingerprint: string;
  exception_type: string;
  message: string;
  traceback: string[];
  context: string;
}

/**
 * Generate a dedup fingerprint from error type + filename + line number.
 * Parses JS/TS stack traces to extract the crash site.
 */
function fingerprint(error: Error): string {
  const stack = error.stack ?? "";
  // Match "at <something> (file:line:col)" or "at file:line:col"
  const frameMatch = stack.match(/at .+?[( ](?:file:\/\/\/?)?(.+?):(\d+):\d+/);
  let raw: string;
  if (frameMatch) {
    const file = frameMatch[1].replace(/\\/g, "/").split("/").pop() ?? "unknown";
    raw = `${error.constructor.name}:${file}:${frameMatch[2]}`;
  } else {
    raw = `${error.constructor.name}:${error.message.slice(0, 100)}`;
  }
  return createHash("md5").update(raw).digest("hex").slice(0, 12);
}

/**
 * Format stack trace into an array of lines (matches Gotham schema).
 */
function formatTraceback(error: Error): string[] {
  const stack = error.stack ?? `${error.constructor.name}: ${error.message}`;
  return stack.split("\n").map((line) => line + "\n");
}

/**
 * Append a structured error entry to error_log.json.
 * Never throws — error reporting must never crash the bot.
 */
export function reportError(error: Error, context = ""): void {
  try {
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      fingerprint: fingerprint(error),
      exception_type: error.constructor.name,
      message: error.message,
      traceback: formatTraceback(error),
      context,
    };

    // Load existing log
    let entries: ErrorLogEntry[] = [];
    try {
      const raw = Deno.readTextFileSync(ERROR_LOG);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      // File doesn't exist or is malformed — start fresh
    }

    entries.push(entry);

    // Trim to last N entries (FIFO)
    if (entries.length > MAX_LOG_ENTRIES) {
      entries = entries.slice(-MAX_LOG_ENTRIES);
    }

    Deno.writeTextFileSync(ERROR_LOG, JSON.stringify(entries, null, 2));
    console.log(`[error-reporter] Logged: ${entry.fingerprint} (${entry.exception_type})`);
  } catch (logErr) {
    // Never let error reporting crash the bot
    console.warn(`[error-reporter] Failed to write error log:`, logErr);
  }
}
