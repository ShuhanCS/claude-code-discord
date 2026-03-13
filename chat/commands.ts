/**
 * Chat slash commands — /new (clear session) and /sessions (list active sessions).
 *
 * @module chat/commands
 */

import { SlashCommandBuilder } from "npm:discord.js@14.14.1";
import type { InteractionContext } from "../discord/types.ts";
import { clearChannelSession, getAllSessions } from "./session-store.ts";

export const chatCommands = [
  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Start a fresh Claude session in this channel (clears current session)'),

  new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('List active Claude sessions across all channels'),
];

export function createChatHandlers() {
  return {
    async onNew(ctx: InteractionContext, channelId: string, channelName: string): Promise<void> {
      await clearChannelSession(channelId);
      await ctx.reply({
        content: `Session cleared for #${channelName}. Your next message will start a fresh conversation.`,
        ephemeral: true,
      });
    },

    async onSessions(ctx: InteractionContext): Promise<void> {
      const sessions = await getAllSessions();
      const entries = Object.entries(sessions);

      if (entries.length === 0) {
        await ctx.reply({
          content: "_No active sessions. Type a message in any project channel to start one._",
          ephemeral: true,
        });
        return;
      }

      const lines = entries.map(([_channelId, session]) => {
        const age = timeSince(new Date(session.lastMessageAt));
        const shortId = session.sessionId.substring(0, 8);
        return `**${session.projectDir.split(/[\\/]/).pop()}** — \`${shortId}...\` (${age} ago)`;
      });

      await ctx.reply({
        embeds: [{
          color: 0x5865F2,
          title: 'Active Sessions',
          description: lines.join('\n'),
          footer: { text: `${entries.length} session(s) | Use /new to clear a session` },
        }],
        ephemeral: true,
      });
    },
  };
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
