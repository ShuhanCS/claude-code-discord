export { projectCommands, syncCommand } from "./command.ts";
export { createProjectHandler, type ProjectHandlerDeps } from "./handler.ts";
export { resolveChannelToProject } from "./channel-resolver.ts";
export { scanActiveProjects, syncChannelsToProjects, getProjectsDir, getBotProjectDir, SPECIAL_CHANNELS, type ProjectInfo, type SyncResult } from "./sync.ts";
export { loadProjectContext, buildContextEmbed, type ProjectContext } from "./context-loader.ts";
