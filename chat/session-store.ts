/**
 * Session Store — maps Discord channels to Claude session IDs.
 * Persisted to `.bot-data/channel-sessions.json` so sessions survive bot restarts.
 *
 * @module chat/session-store
 */

import { PersistenceManager } from "../util/persistence.ts";

export interface ChannelSession {
  sessionId: string;
  projectDir: string;
  startedAt: string;
  lastMessageAt: string;
}

export type ChannelSessionMap = Record<string, ChannelSession>;

const manager = new PersistenceManager<ChannelSessionMap>("channel-sessions");

/**
 * Get the current session for a channel, or null if none.
 */
export async function getChannelSession(channelId: string): Promise<ChannelSession | null> {
  const data = await manager.get({});
  return data[channelId] ?? null;
}

/**
 * Set/update the session for a channel.
 */
export async function setChannelSession(channelId: string, session: ChannelSession): Promise<void> {
  await manager.update({}, (data) => {
    data[channelId] = session;
    return data;
  });
}

/**
 * Clear the session for a channel (user starts fresh with `/new`).
 */
export async function clearChannelSession(channelId: string): Promise<void> {
  await manager.update({}, (data) => {
    delete data[channelId];
    return data;
  });
}

/**
 * Get all active sessions (for `/sessions` command).
 */
export async function getAllSessions(): Promise<ChannelSessionMap> {
  return await manager.get({});
}

/**
 * Update the lastMessageAt timestamp for a channel session.
 */
export async function touchChannelSession(channelId: string): Promise<void> {
  await manager.update({}, (data) => {
    if (data[channelId]) {
      data[channelId].lastMessageAt = new Date().toISOString();
    }
    return data;
  });
}
