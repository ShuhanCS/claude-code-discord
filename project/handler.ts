import { getProjectsDir } from "./sync.ts";

export interface ProjectHandlerDeps {
  getWorkDir: () => string;
  setWorkDir: (dir: string) => void;
  /** Optional: bot instance for resyncChannels. Injected after bot creation. */
  // deno-lint-ignore no-explicit-any
  getBot?: () => any;
}

export function createProjectHandler(deps: ProjectHandlerDeps) {
  return {
    // deno-lint-ignore no-explicit-any
    async onProject(_ctx: any, action: string, name?: string) {
      switch (action) {
        case 'list': {
          const entries: string[] = [];
          for await (const entry of Deno.readDir(getProjectsDir())) {
            if (entry.isDirectory) {
              entries.push(entry.name);
            }
          }
          entries.sort();
          const current = deps.getWorkDir().replace(/\\/g, '/').split('/').pop() || '';
          const list = entries.map(e =>
            e === current ? `**> ${e}** (current)` : `  ${e}`
          ).join('\n');

          return {
            embeds: [{
              color: 0x0099ff,
              title: 'Projects',
              description: list || 'No projects found',
              footer: { text: `${entries.length} projects in ${getProjectsDir()}` },
            }]
          };
        }

        case 'set': {
          if (!name) {
            return { content: 'Provide a project name: `/project action:set name:conductops`' };
          }
          const sep = Deno.build.os === 'windows' ? '\\' : '/';
          const newDir = `${getProjectsDir()}${sep}${name}`;
          try {
            const stat = await Deno.stat(newDir);
            if (!stat.isDirectory) {
              return { content: `\`${name}\` is not a directory.` };
            }
          } catch {
            return { content: `Project \`${name}\` not found in ${getProjectsDir()}` };
          }

          deps.setWorkDir(newDir);
          return {
            embeds: [{
              color: 0x00ff00,
              title: 'Project switched',
              description: `Now working in **${name}**\n\`${newDir}\``,
            }]
          };
        }

        case 'current': {
          const dir = deps.getWorkDir();
          const projectName = dir.replace(/\\/g, '/').split('/').pop() || 'unknown';
          return {
            embeds: [{
              color: 0x0099ff,
              title: 'Current Project',
              description: `**${projectName}**\n\`${dir}\``,
            }]
          };
        }

        default:
          return { content: `Unknown action: ${action}` };
      }
    },

    // deno-lint-ignore no-explicit-any
    async onSync(_ctx: any, maxAge?: number) {
      const bot = deps.getBot?.();
      if (!bot?.resyncChannels) {
        return {
          embeds: [{
            color: 0xff4444,
            title: 'Sync Error',
            description: 'Bot sync not available. Try again after startup.',
          }]
        };
      }

      const result = await bot.resyncChannels(maxAge ?? 30);
      const fields: { name: string; value: string; inline?: boolean }[] = [];

      if (result.created.length > 0) {
        fields.push({
          name: `Created (${result.created.length})`,
          value: result.created.map((c: string) => `#${c}`).join(', '),
          inline: false,
        });
      }

      fields.push({
        name: `Existing (${result.existing.length})`,
        value: result.existing.length > 0
          ? result.existing.slice(0, 20).map((c: string) => `#${c}`).join(', ') +
            (result.existing.length > 20 ? ` ... +${result.existing.length - 20} more` : '')
          : 'None',
        inline: false,
      });

      if (result.stale.length > 0) {
        fields.push({
          name: `Stale (${result.stale.length})`,
          value: result.stale.map((c: string) => `#${c}`).join(', '),
          inline: false,
        });
      }

      return {
        embeds: [{
          color: 0x00ff00,
          title: 'Channel Sync Complete',
          description: `Scanned projects with commits in last ${maxAge ?? 30} days`,
          fields,
          timestamp: true,
        }]
      };
    },

    async autocompleteProjectName(typed: string): Promise<{ name: string; value: string }[]> {
      const entries: string[] = [];
      try {
        for await (const entry of Deno.readDir(getProjectsDir())) {
          if (entry.isDirectory) {
            entries.push(entry.name);
          }
        }
      } catch { /* ignore */ }

      return entries
        .filter(e => e.toLowerCase().includes(typed.toLowerCase()))
        .sort()
        .slice(0, 25)
        .map(e => ({ name: e, value: e }));
    }
  };
}
