/**
 * Conversational Message Handler — makes Discord feel like a Claude Code terminal.
 *
 * Plain messages in project channels are treated as Claude prompts.
 * Each channel maintains its own session, persisted across bot restarts.
 *
 * @module chat/message-handler
 */

import { sendToClaudeCode, type ClaudeModelOptions } from "../claude/client.ts";
import { convertToClaudeMessages } from "../claude/message-converter.ts";
import type { ClaudeMessage } from "../claude/types.ts";
import { splitText } from "../discord/utils.ts";
import {
  getChannelSession,
  setChannelSession,
  touchChannelSession,
  type ChannelSession,
} from "./session-store.ts";

export interface MessageHandlerDeps {
  /** Resolve a channel name to its project directory */
  resolveProject: (channelName: string) => string;
  /** Get current model/runtime options from unified settings */
  getQueryOptions?: () => ClaudeModelOptions;
  /** Send structured Claude messages to the channel (embeds for tool use, etc.) */
  sendClaudeMessages: (messages: ClaudeMessage[]) => Promise<void>;
  /** Get/set the global claude controller (for cancellation) */
  getClaudeController: () => AbortController | null;
  setClaudeController: (controller: AbortController | null) => void;
  /** Set the global session ID (so /claude-cancel and status commands work) */
  setClaudeSessionId: (sessionId: string | undefined) => void;
}

/** Per-channel lock to prevent concurrent queries in the same channel */
const channelLocks = new Set<string>();

/**
 * Handle a plain message from a Discord channel.
 *
 * @param channelId - Discord channel ID
 * @param channelName - Discord channel name (used for project resolution)
 * @param content - The message text
 * @param sendReply - Callback to send a text reply to the channel
 * @param deps - Injected dependencies
 */
export async function handleChatMessage(
  channelId: string,
  channelName: string,
  content: string,
  sendReply: (text: string) => Promise<void>,
  deps: MessageHandlerDeps,
): Promise<void> {
  // Prevent concurrent queries in the same channel
  if (channelLocks.has(channelId)) {
    await sendReply("_Claude is still working on the previous message. Please wait or use `/claude-cancel` to stop it._");
    return;
  }

  channelLocks.add(channelId);

  try {
    // Resolve channel to project directory
    const projectDir = deps.resolveProject(channelName);

    // Look up existing session for this channel
    const existingSession = await getChannelSession(channelId);
    const sessionId = existingSession?.sessionId;

    // Cancel any existing global controller (only one query at a time)
    const existingController = deps.getClaudeController();
    if (existingController) {
      existingController.abort();
    }

    const controller = new AbortController();
    deps.setClaudeController(controller);

    // Show typing indicator via a brief status message
    await sendReply("_Thinking..._");

    // Send to Claude Code SDK
    const result = await sendToClaudeCode(
      projectDir,
      content,
      controller,
      sessionId,            // resume session if exists
      undefined,            // onChunk — not used, we use JSON streaming
      (jsonData) => {
        // Stream structured messages (tool use, thinking, etc.) to Discord
        const claudeMessages = convertToClaudeMessages(jsonData);
        if (claudeMessages.length > 0) {
          deps.sendClaudeMessages(claudeMessages).catch(() => {});
        }
      },
      false,                // continueMode
      deps.getQueryOptions?.(),
    );

    deps.setClaudeController(null);

    // Store/update session
    if (result.sessionId) {
      deps.setClaudeSessionId(result.sessionId);

      const now = new Date().toISOString();
      const session: ChannelSession = existingSession
        ? { ...existingSession, lastMessageAt: now }
        : {
            sessionId: result.sessionId,
            projectDir,
            startedAt: now,
            lastMessageAt: now,
          };

      // Update session ID in case SDK returned a new one (shouldn't normally happen)
      session.sessionId = result.sessionId;
      await setChannelSession(channelId, session);
    } else {
      await touchChannelSession(channelId);
    }

    // Send the final text response (split if >2000 chars for Discord limit)
    if (result.response && result.response !== "No response received") {
      const chunks = splitText(result.response, 1900);
      for (const chunk of chunks) {
        await sendReply(chunk);
      }
    }

    // Show cost/duration footer if available
    if (result.cost || result.duration) {
      const parts: string[] = [];
      if (result.cost) parts.push(`$${result.cost.toFixed(4)}`);
      if (result.duration) parts.push(`${(result.duration / 1000).toFixed(1)}s`);
      if (result.modelUsed && result.modelUsed !== "Default") parts.push(result.modelUsed);
      await sendReply(`-# ${parts.join(" | ")}`);
    }
  } catch (error) {
    deps.setClaudeController(null);
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[chat] Error handling message in #${channelName}:`, msg);
    await sendReply(`**Error:** ${msg.substring(0, 1800)}`);
  } finally {
    channelLocks.delete(channelId);
  }
}
