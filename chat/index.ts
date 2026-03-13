/**
 * Chat module — conversational message handling for Discord.
 * @module chat
 */

export { handleChatMessage, type MessageHandlerDeps } from "./message-handler.ts";
export { chatCommands, createChatHandlers } from "./commands.ts";
export {
  getChannelSession,
  setChannelSession,
  clearChannelSession,
  getAllSessions,
  touchChannelSession,
  type ChannelSession,
  type ChannelSessionMap,
} from "./session-store.ts";
