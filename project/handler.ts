/** Derive PROJECTS_DIR from environment — lazy to avoid reading env before .env is loaded */
function getProjectsDir(): string {
  return Deno.env.get("PROJECTS_DIR")
    || Deno.env.get("WORK_DIR")
    || `${Deno.env.get("USERPROFILE") || Deno.env.get("HOME")}${Deno.build.os === "windows" ? "\\" : "/"}projects`;
}

export interface ProjectHandlerDeps {
  getWorkDir: () => string;
  setWorkDir: (dir: string) => void;
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
