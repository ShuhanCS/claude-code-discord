import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

export const projectCommands = [
  new SlashCommandBuilder()
    .setName('project')
    .setDescription('Switch working directory to a different project')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Action to perform')
        .setRequired(true)
        .addChoices(
          { name: 'list', value: 'list' },
          { name: 'set', value: 'set' },
          { name: 'current', value: 'current' },
        ))
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Project folder name (for set action)')
        .setRequired(false)
        .setAutocomplete(true)),
];
