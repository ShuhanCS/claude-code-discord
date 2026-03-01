/**
 * Slash command definition for /task.
 *
 * @module task/command
 */

import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

export const taskCommand = new SlashCommandBuilder()
  .setName("task")
  .setDescription("Task board — create, track, and close tasks with enforced rules")
  .addStringOption(option =>
    option
      .setName("action")
      .setDescription("Action to perform")
      .setRequired(true)
      .addChoices(
        { name: "create", value: "create" },
        { name: "list", value: "list" },
        { name: "show", value: "show" },
        { name: "start", value: "start" },
        { name: "done", value: "done" },
        { name: "reopen", value: "reopen" },
      ))
  .addStringOption(option =>
    option
      .setName("id")
      .setDescription("Task ID (e.g. T-001)")
      .setRequired(false)
      .setAutocomplete(true))
  .addStringOption(option =>
    option
      .setName("title")
      .setDescription("Task title (for create)")
      .setRequired(false))
  .addStringOption(option =>
    option
      .setName("proof")
      .setDescription("Proof of completion — commit hash, URL, or description (for done)")
      .setRequired(false))
  .addStringOption(option =>
    option
      .setName("parent")
      .setDescription("Parent task ID (for create)")
      .setRequired(false)
      .setAutocomplete(true))
  .addStringOption(option =>
    option
      .setName("status")
      .setDescription("Status filter (for list)")
      .setRequired(false)
      .addChoices(
        { name: "active (open + in-progress)", value: "active" },
        { name: "open", value: "open" },
        { name: "in-progress", value: "in-progress" },
        { name: "done", value: "done" },
        { name: "all", value: "all" },
      ));
