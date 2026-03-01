import { 
  Client, 
  GatewayIntentBits, 
  Events, 
  ChannelType, 
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  CommandInteraction,
  ButtonInteraction,
  AutocompleteInteraction,
  TextChannel,
  EmbedBuilder
} from "npm:discord.js@14.14.1";

import { sanitizeChannelName } from "./utils.ts";
import { handlePaginationInteraction } from "./pagination.ts";
import { checkCommandPermission } from "../core/rbac.ts";
import { SETTINGS_ACTIONS, SETTINGS_VALUES } from "../settings/unified-settings.ts";
import { BOT_VERSION } from "../util/version-check.ts";
import { scanActiveProjects, syncChannelsToProjects, getProjectsDir, type SyncResult } from "../project/sync.ts";
import type {
  BotConfig,
  CommandHandlers,
  ButtonHandlers,
  MessageContent,
  InteractionContext,
  BotDependencies
} from "./types.ts";


// ================================
// Helper Functions
// ================================

// deno-lint-ignore no-explicit-any
function convertMessageContent(content: MessageContent): any {
  // deno-lint-ignore no-explicit-any
  const payload: any = {};
  
  if (content.content) payload.content = content.content;
  
  if (content.embeds) {
    payload.embeds = content.embeds.map(e => {
      const embed = new EmbedBuilder();
      if (e.color !== undefined) embed.setColor(e.color);
      if (e.title) embed.setTitle(e.title);
      if (e.description) embed.setDescription(e.description);
      if (e.fields) e.fields.forEach(f => embed.addFields(f));
      if (e.footer) embed.setFooter(e.footer);
      if (e.timestamp) embed.setTimestamp();
      return embed;
    });
  }
  
  if (content.components) {
    payload.components = content.components.map(row => {
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      row.components.forEach(comp => {
        const button = new ButtonBuilder()
          .setCustomId(comp.customId)
          .setLabel(comp.label);
        
        switch (comp.style) {
          case 'primary': button.setStyle(ButtonStyle.Primary); break;
          case 'secondary': button.setStyle(ButtonStyle.Secondary); break;
          case 'success': button.setStyle(ButtonStyle.Success); break;
          case 'danger': button.setStyle(ButtonStyle.Danger); break;
          case 'link': button.setStyle(ButtonStyle.Link); break;
        }
        
        actionRow.addComponents(button);
      });
      return actionRow;
    });
  }
  
  // Handle file attachments
  if (content.files && content.files.length > 0) {
    payload.files = content.files.map(f => ({
      attachment: f.path,
      name: f.name || 'attachment',
      description: f.description,
    }));
  }
  
  return payload;
}

// ================================
// Main Bot Creation Function
// ================================

export async function createDiscordBot(
  config: BotConfig, 
  handlers: CommandHandlers,
  buttonHandlers: ButtonHandlers,
  dependencies: BotDependencies,
  crashHandler?: any
) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName } = config;
  const actualCategoryName = categoryName || repoName;
  
  let myChannel: TextChannel | null = null;
  // deno-lint-ignore no-explicit-any
  let myCategory: any = null;
  let myCategoryId: string | null = null;
  /** Channel override for multi-channel routing — set during command dispatch
   *  so streaming callbacks (sendMessage, onAskUser, etc.) send to the right channel */
  let activeChannelId: string | null = null;
  
  const botSettings = dependencies.botSettings || {
    mentionEnabled: !!config.defaultMentionUserId,
    mentionUserId: config.defaultMentionUserId || null,
  };
  
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  
  // Use commands from dependencies
  const commands = dependencies.commands;
  
  // Channel activation tracking — session-scoped set of channel IDs.
  // When a channel is first interacted with, the context greeting is shown.
  const activatedChannels = new Set<string>();

  // Channel management — ensures category exists and syncs all project channels
  // deno-lint-ignore no-explicit-any
  async function ensureAllChannelsExist(guild: any, maxAgeDays = 7): Promise<{ channel: TextChannel; syncResult: SyncResult }> {
    const channelName = sanitizeChannelName(branchName);

    console.log(`Checking category "${actualCategoryName}"...`);

    let category = guild.channels.cache.find(
      // deno-lint-ignore no-explicit-any
      (c: any) => c.type === ChannelType.GuildCategory && c.name === actualCategoryName
    );

    if (!category) {
      console.log(`Creating category "${actualCategoryName}"...`);
      try {
        category = await guild.channels.create({
          name: actualCategoryName,
          type: ChannelType.GuildCategory,
        });
        console.log(`Created category "${actualCategoryName}"`);
      } catch (error) {
        console.error(`Category creation error: ${error}`);
        throw new Error(`Cannot create category. Please ensure the bot has "Manage Channels" permission.`);
      }
    }

    myCategory = category;
    myCategoryId = category.id;

    // Scan active projects and sync channels
    console.log(`[sync] Scanning projects in ${getProjectsDir()} (max age: ${maxAgeDays} days)...`);
    const projects = await scanActiveProjects(getProjectsDir(), maxAgeDays);
    console.log(`[sync] Found ${projects.length} active projects`);

    const syncResult = await syncChannelsToProjects(guild, category.id, projects);
    console.log(`[sync] Created: ${syncResult.created.length}, Existing: ${syncResult.existing.length}, Stale: ${syncResult.stale.length}`);
    if (syncResult.stale.length > 0) {
      console.log(`[sync] Stale channels (no matching project): ${syncResult.stale.join(', ')}`);
    }

    // Find the primary channel (current branch channel, or #general as fallback)
    let channel = guild.channels.cache.find(
      // deno-lint-ignore no-explicit-any
      (c: any) => c.type === ChannelType.GuildText && c.name === channelName && c.parentId === category.id
    );

    if (!channel) {
      // Fallback to #general
      channel = guild.channels.cache.find(
        // deno-lint-ignore no-explicit-any
        (c: any) => c.type === ChannelType.GuildText && c.name === 'general' && c.parentId === category.id
      );
    }

    if (!channel) {
      // Last resort: create the branch channel
      console.log(`Creating channel "${channelName}"...`);
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `Repository: ${repoName} | Branch: ${branchName} | Machine: ${Deno.hostname()} | Path: ${workDir}`,
        });
        console.log(`Created channel "${channelName}"`);
      } catch (error) {
        console.error(`Channel creation error: ${error}`);
        throw new Error(`Cannot create channel. Please ensure the bot has "Manage Channels" permission.`);
      }
    }

    return { channel: channel as TextChannel, syncResult };
  }
  
  // Create interaction context wrapper
  function createInteractionContext(interaction: CommandInteraction | ButtonInteraction): InteractionContext {
    return {
      async deferReply(): Promise<void> {
        await interaction.deferReply();
      },
      
      async editReply(content: MessageContent): Promise<void> {
        await interaction.editReply(convertMessageContent(content));
      },
      
      async followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.followUp(payload);
      },
      
      async reply(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.reply(payload);
      },
      
      async update(content: MessageContent): Promise<void> {
        if ('update' in interaction) {
          await (interaction as ButtonInteraction).update(convertMessageContent(content));
        }
      },
      
      getString(name: string, required?: boolean): string | null {
        if (interaction.isCommand && interaction.isCommand()) {
          // deno-lint-ignore no-explicit-any
          return (interaction as any).options.getString(name, required ?? false);
        }
        return null;
      },
      
      getInteger(name: string, required?: boolean): number | null {
        if (interaction.isCommand && interaction.isCommand()) {
          // deno-lint-ignore no-explicit-any
          return (interaction as any).options.getInteger(name, required ?? false);
        }
        return null;
      },
      
      getBoolean(name: string, required?: boolean): boolean | null {
        if (interaction.isCommand && interaction.isCommand()) {
          // deno-lint-ignore no-explicit-any
          return (interaction as any).options.getBoolean(name, required ?? false);
        }
        return null;
      },

      getMemberRoleIds(): Set<string> {
        const member = interaction.member;
        if (member && 'roles' in member && member.roles && 'cache' in member.roles) {
          // deno-lint-ignore no-explicit-any
          const cache = (member.roles as any).cache;
          if (cache && typeof cache.keys === 'function') {
            return new Set([...cache.keys()]);
          }
        }
        return new Set();
      },

      getUserId(): string {
        return interaction.user?.id ?? '';
      }
    };
  }
  
  // Check if a channel belongs to our category.
  // Uses cache first, falls back to API fetch for newly created channels.
  async function isInOurCategory(channelId: string): Promise<boolean> {
    // Fast path: it's our default channel
    if (myChannel && channelId === myChannel.id) return true;
    if (!myCategoryId) return false;
    // Look up the channel in the guild's channel cache
    const guild = client.guilds.cache.first();
    if (!guild) return false;
    let ch = guild.channels.cache.get(channelId);
    // Fallback: fetch from API if not in cache (e.g. newly created channels)
    if (!ch) {
      try {
        const fetched = await guild.channels.fetch(channelId);
        if (fetched) ch = fetched;
      } catch {
        return false;
      }
    }
    if (!ch) return false;
    return ch.parentId === myCategoryId;
  }

  // Notify the caller when the interaction comes from a non-default channel.
  // Also fires onChannelActivated on first interaction per channel per session.
  async function notifyChannelSwitch(interaction: CommandInteraction | ButtonInteraction): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // Resolve the channel name
    let channelName: string | null = null;
    let ch = guild.channels.cache.get(interaction.channelId);
    if (!ch) {
      try {
        const fetched = await guild.channels.fetch(interaction.channelId);
        if (fetched) ch = fetched;
      } catch { /* cache miss + fetch fail — skip */ }
    }
    if (ch && 'name' in ch && typeof ch.name === 'string') {
      channelName = ch.name;
    }

    // Notify channel switch (project directory resolution)
    if (myChannel && dependencies.onChannelSwitch && interaction.channelId !== myChannel.id && channelName) {
      dependencies.onChannelSwitch(channelName);
    }

    // Activation tracking — fire onChannelActivated once per channel per session
    if (channelName && !activatedChannels.has(interaction.channelId)) {
      activatedChannels.add(interaction.channelId);
      if (dependencies.onChannelActivated) {
        // Fire-and-forget — don't block command execution
        dependencies.onChannelActivated(channelName, interaction.channelId).catch((err) => {
          console.error(`[context-greeting] Error for #${channelName}:`, err);
        });
      }
    }
  }

  // Command handler - completely generic
  async function handleCommand(interaction: CommandInteraction) {
    if (!await isInOurCategory(interaction.channelId)) {
      return;
    }

    // If the command came from a project channel, update workDir
    await notifyChannelSwitch(interaction);
    
    const ctx = createInteractionContext(interaction);

    // RBAC check for restricted commands
    const allowed = await checkCommandPermission(interaction.commandName, ctx);
    if (!allowed) return;

    const handler = handlers.get(interaction.commandName);
    
    if (!handler) {
      await ctx.reply({
        content: `Unknown command: ${interaction.commandName}`,
        ephemeral: true
      });
      return;
    }
    
    // Route streaming callbacks (sendMessage, onAskUser, etc.) to THIS channel.
    // We intentionally do NOT clear activeChannelId after the handler completes —
    // fire-and-forget sendClaudeMessages calls may still be in flight and need
    // the correct channel. The next command will set it to its own channel.
    activeChannelId = interaction.channelId;
    try {
      await handler.execute(ctx);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      // Try to send error message if possible
      try {
        if (interaction.deferred) {
          await ctx.editReply({
            content: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        } else {
          await ctx.reply({
            content: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        }
      } catch {
        // Ignore errors when sending error message
      }
    }
  }

  // Autocomplete handler for /settings action & value fields + extra handlers
  async function handleAutocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    const typed = focused.value.toLowerCase();

    // Built-in: /settings autocomplete
    if (interaction.commandName === 'settings') {
      const category = interaction.options.getString('category') ?? '';
      const action = interaction.options.getString('action') ?? '';

      let choices: { name: string; value: string }[] = [];

      if (focused.name === 'action') {
        choices = SETTINGS_ACTIONS[category] ?? [];
      } else if (focused.name === 'value') {
        choices = SETTINGS_VALUES[action] ?? [];
      }

      // Filter by what the user has typed so far
      const filtered = choices
        .filter(c => c.name.toLowerCase().includes(typed) || c.value.toLowerCase().includes(typed))
        .slice(0, 25); // Discord max 25 choices

      await interaction.respond(filtered);
      return;
    }

    // Delegate to extra autocomplete handlers (e.g. /project)
    const extraHandler = dependencies.autocompleteHandlers?.get(interaction.commandName);
    if (extraHandler) {
      // Collect all option values for context
      const allOptions: Record<string, string | null> = {};
      for (const opt of interaction.options.data) {
        allOptions[opt.name] = typeof opt.value === 'string' ? opt.value : null;
      }

      const choices = await extraHandler(
        interaction.commandName,
        focused.name,
        focused.value,
        allOptions,
      );
      await interaction.respond(choices.slice(0, 25));
    }
  }
  
  // Button handler - completely generic
  async function handleButton(interaction: ButtonInteraction) {
    if (!await isInOurCategory(interaction.channelId)) {
      return;
    }

    // If the button came from a project channel, update workDir
    await notifyChannelSwitch(interaction);

    // Route streaming callbacks to the button's channel
    activeChannelId = interaction.channelId;

    const ctx = createInteractionContext(interaction);

    try {
    // Handle pagination buttons first
    if (interaction.customId.startsWith('pagination:')) {
      try {
        const paginationResult = handlePaginationInteraction(interaction.customId);
        if (paginationResult) {
          await ctx.update({
            embeds: [paginationResult.embed],
            components: paginationResult.components ? [{ type: 'actionRow', components: paginationResult.components }] : []
          });
          return;
        }
      } catch (error) {
        console.error('Error handling pagination:', error);
        if (crashHandler) {
          await crashHandler.reportCrash('main', error instanceof Error ? error : new Error(String(error)), 'pagination', 'Button interaction');
        }
      }
    }
    
    const handler = buttonHandlers.get(interaction.customId);
    
    if (handler) {
      try {
        await handler(ctx);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId}:`, error);
        if (crashHandler) {
          await crashHandler.reportCrash('main', error instanceof Error ? error : new Error(String(error)), 'button', `ID: ${interaction.customId}`);
        }
        try {
          await ctx.followUp({
            content: `Error handling button: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
      return;
    }
    
    // Handle dynamic button IDs with patterns
    const buttonId = interaction.customId;
    
    // Handle continue with session ID pattern: "continue:sessionId"
    if (buttonId.startsWith('continue:')) {
      if (dependencies.onContinueSession) {
        try {
          await dependencies.onContinueSession(ctx);
        } catch (error) {
          console.error('Error handling continue button:', error);
          try {
            await ctx.followUp({
              content: `Error continuing session: ${error instanceof Error ? error.message : 'Unknown error'}`,
              ephemeral: true
            });
          } catch { /* ignore follow-up errors */ }
        }
      } else {
        // Fallback: show session ID text if callback not wired
        const sessionId = buttonId.split(':')[1];
        try {
          await ctx.update({
            embeds: [{
              color: 0xffff00,
              title: '\u27a1\ufe0f Continue Session',
              description: `Use \`/continue\` or \`/claude session_id:${sessionId}\` to continue this conversation.`,
              fields: [
                { name: 'Session ID', value: `\`${sessionId}\``, inline: false }
              ],
              timestamp: true
            }]
          });
        } catch (error) {
          console.error(`Error handling continue button fallback:`, error);
        }
      }
      return;
    }
    
    // Handle copy session ID pattern: "copy-session:sessionId" (legacy — kept for old messages)
    if (buttonId.startsWith('copy-session:')) {
      const sessionId = buttonId.split(':')[1];
      try {
        await ctx.update({
          embeds: [{
            color: 0x00ff00,
            title: '\ud83d\udccb Session ID',
            description: `\`${sessionId}\``,
            fields: [
              { name: 'Usage', value: 'Copy this ID to use with `/claude session_id:...`', inline: false }
            ],
            timestamp: true
          }]
        });
      } catch (error) {
        console.error(`Error handling copy-session button:`, error);
      }
      return;
    }
    
    // Handle expand content pattern: "expand:contentId" 
    if (buttonId.startsWith('expand:')) {
      const expandId = buttonId.substring(7);
      
      // Try to find a handler that can process expand buttons
      for (const [handlerName, handler] of handlers.entries()) {
        if (handler.handleButton) {
          try {
            await handler.handleButton(ctx, buttonId);
            return;
          } catch (error) {
            console.error(`Error in ${handlerName} handleButton for expand:`, error);
          }
        }
      }
      
      // If no handler found, show default message
      try {
        await ctx.update({
          embeds: [{
            color: 0xffaa00,
            title: '📖 Content Not Available',
            description: 'The full content is no longer available for expansion.',
            timestamp: true
          }],
          components: []
        });
      } catch (error) {
        console.error(`Error handling expand button fallback:`, error);
      }
      return;
    }
    
    // If no specific handler found, try to delegate to command handlers with handleButton method
    const commandHandler = Array.from(handlers.values()).find(h => h.handleButton);
    if (commandHandler?.handleButton) {
      try {
        await commandHandler.handleButton(ctx, interaction.customId);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId} via command handler:`, error);
        try {
          await ctx.followUp({
            content: `Error handling button: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
    } else {
      console.warn(`No handler found for button: ${interaction.customId}`);
    }
    } finally {
      // activeChannelId intentionally NOT cleared — fire-and-forget
      // sendClaudeMessages calls may still be in flight. The next
      // command/button will set it to its own channel.
    }
  }
  
  // Register commands
  const rest = new REST({ version: '10' }).setToken(discordToken);
  
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(applicationId),
      { body: commands.map(cmd => cmd.toJSON()) },
    );
    console.log('Slash commands registered');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
    throw error;
  }
  
  // Event handlers
  client.once(Events.ClientReady, async () => {
    console.log(`Bot logged in: ${client.user?.tag}`);
    console.log(`Category: ${actualCategoryName}`);
    console.log(`Branch: ${branchName}`);
    console.log(`Working directory: ${workDir}`);
    
    const guilds = client.guilds.cache;
    if (guilds.size === 0) {
      console.error('Error: Bot is not in any servers');
      return;
    }
    
    const guild = guilds.first();
    if (!guild) {
      console.error('Error: Guild not found');
      return;
    }
    
    try {
      const { channel, syncResult } = await ensureAllChannelsExist(guild);
      myChannel = channel;
      console.log(`Using channel "${myChannel.name}" (category ID: ${myCategoryId})`);

      // Mark primary channel as activated
      activatedChannels.add(myChannel.id);

      const totalSynced = syncResult.created.length + syncResult.existing.length;
      const syncSummary = syncResult.created.length > 0
        ? `Synced ${totalSynced} channels (${syncResult.created.length} new)`
        : `Synced ${totalSynced} channels`;

      await myChannel.send(convertMessageContent({
        embeds: [{
          color: 0x00ff00,
          title: `🚀 v${BOT_VERSION} — Startup Complete`,
          description: `Claude Code bot for branch ${branchName} has started`,
          fields: [
            { name: 'Category', value: actualCategoryName, inline: true },
            { name: 'Repository', value: repoName, inline: true },
            { name: 'Branch', value: branchName, inline: true },
            { name: 'Channels', value: syncSummary, inline: true },
            { name: 'Working Directory', value: `\`${workDir}\``, inline: false }
          ],
          timestamp: true
        }],
        components: [{
          type: 'actionRow',
          components: [
            { type: 'button', customId: 'startup:continue', label: '▶️ Resume Last', style: 'primary' },
            { type: 'button', customId: 'startup:sessions', label: '📂 Sessions', style: 'secondary' },
            { type: 'button', customId: 'workflow:git-status', label: '📋 Git Status', style: 'secondary' },
            { type: 'button', customId: 'startup:system-info', label: '💻 System Info', style: 'secondary' },
          ]
        }]
      }));

      // Send context greeting for the primary channel
      if (dependencies.onChannelActivated && myChannel.name) {
        dependencies.onChannelActivated(myChannel.name, myChannel.id).catch((err) => {
          console.error(`[context-greeting] Error for startup channel:`, err);
        });
      }
    } catch (error) {
      console.error('Channel creation/retrieval error:', error);
    }
  });
  
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isCommand()) {
      await handleCommand(interaction as CommandInteraction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction as AutocompleteInteraction);
    } else if (interaction.isButton()) {
      await handleButton(interaction as ButtonInteraction);
    }
  });
  
  // Login
  await client.login(discordToken);
  
  // Return bot control functions
  return {
    client,
    /** Returns the active command channel (for streaming output) or falls back to main */
    getChannel() {
      if (activeChannelId) {
        const ch = client.channels.cache.get(activeChannelId);
        if (ch) return ch as TextChannel;
      }
      return myChannel;
    },
    /** Always returns the main/default channel — for notifications, startup messages, etc. */
    getMainChannel() {
      return myChannel;
    },
    setActiveChannel(channelId: string | null) {
      activeChannelId = channelId;
    },
    updateBotSettings(settings: { mentionEnabled: boolean; mentionUserId: string | null }) {
      botSettings.mentionEnabled = settings.mentionEnabled;
      botSettings.mentionUserId = settings.mentionUserId;
    },
    getBotSettings() {
      return { ...botSettings };
    },
    /** Re-scan projects and sync channels. Returns SyncResult. */
    async resyncChannels(maxAgeDays = 7): Promise<SyncResult> {
      const guild = client.guilds.cache.first();
      if (!guild || !myCategoryId) {
        return { created: [], existing: [], stale: [] };
      }
      const projects = await scanActiveProjects(getProjectsDir(), maxAgeDays);
      return await syncChannelsToProjects(guild, myCategoryId, projects);
    },
  };
}