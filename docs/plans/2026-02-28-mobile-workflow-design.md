# Mobile-First Claude Code Workflow via Discord

**Date:** 2026-02-28
**Status:** Approved
**Project:** claude-code-discord

## Problem

When Claude Code runs in the terminal and needs user input (AskUserQuestion, permission requests), the notification that reaches Discord mobile is a thin "needs attention" message with no context. You can't see WHAT Claude is asking or respond from your phone.

## Goal

Full mobile access to Claude Code sessions — whether started from Discord or from the terminal. See exactly what Claude needs, respond with buttons from your phone.

## Design

### Component 1: Discord Bot Enhancements

#### 1a. Auto-start on Shuputer boot
- Windows Task Scheduler runs `deno task start` in `C:\Users\Shuha\projects\claude-code-discord` on login
- Bot stays running 24/7 as long as Shuputer is on

#### 1b. Multi-project `/project` command
- `/project list` — lists all directories in `C:\Users\Shuha\projects\`
- `/project set <name>` — switches the bot's working directory to that project
- Autocomplete from project folder names
- Current project shown in bot status / startup message

#### 1c. Default to interactive permissions
- Default permission mode: `acceptEdits` (auto-allows reads + edits)
- Interactive permission buttons for Bash commands (Allow/Deny)
- So Claude can work autonomously while you're on mobile, only stopping for shell commands

### Component 2: Terminal-to-Discord Bridge (the relay)

#### Architecture

```
Terminal Claude Code session
    ↓
[PreToolUse hook] intercepts AskUserQuestion / tool permission requests
    ↓
Hook script → POST to relay API (localhost:8199)
    ↓
Relay API → posts to Discord channel via webhook
    → Discord shows question embed + buttons
    → User taps button on phone
    → Discord bot → POST answer back to relay API
    ↓
Hook script ← long-polls relay API for answer
    ↓
Hook returns { decision: "allow", updatedInput: { answers: {...} } }
    ↓
Terminal Claude Code continues (TUI prompt never shown)
```

#### 2a. Relay service (`claude-relay`)
- Location: `C:\Users\Shuha\projects\claude-code-discord\relay\`
- Tiny Deno HTTP server on `localhost:8199`
- Endpoints:
  - `POST /question` — hook posts question, gets back `questionId`
  - `GET /answer/:questionId` — hook long-polls for answer (30s timeout, retry)
  - `POST /answer/:questionId` — Discord bot posts user's button selection
  - `POST /permission` — hook posts tool permission request, gets back `permissionId`
  - `GET /permission/:permissionId` — hook long-polls for allow/deny
  - `POST /permission/:permissionId` — Discord bot posts allow/deny decision
- In-memory store (Map), no database
- Auto-cleanup of stale requests after 10 minutes
- Runs alongside the Discord bot (can be started together)

#### 2b. Claude Code hooks
- Location: `C:\Users\Shuha\.claude\hooks\`
- Two hook scripts:

**`pre-tool-use-ask-user.sh`** — intercepts `AskUserQuestion` tool:
1. Reads hook input JSON from stdin (contains `tool_name` and `tool_input`)
2. If `tool_name` is `AskUserQuestion`, extracts questions + options
3. POSTs to `localhost:8199/question` with full question data
4. Gets back `questionId`
5. Long-polls `localhost:8199/answer/:questionId` until answer arrives
6. Returns JSON: `{ "decision": "allow", "updatedInput": { "questions": [...], "answers": {...} } }`
7. If relay is unreachable, falls through to TUI (returns `{ "decision": "allow" }` without updatedInput)

**`pre-tool-use-permissions.sh`** — intercepts tool permission requests:
1. Reads hook input JSON from stdin
2. For tools that need permission (Bash, Write, etc.), POSTs to `localhost:8199/permission`
3. Long-polls for allow/deny response
4. Returns `{ "decision": "allow" }` or `{ "decision": "block", "reason": "Denied from Discord" }`
5. If relay unreachable, falls through to TUI

#### 2c. Discord bot integration
- When relay receives a question/permission, it forwards to Discord via webhook URL
- The Discord bot (or a webhook listener) creates the same rich embeds + buttons used for `/claude` sessions
- When user clicks a button, the bot POSTs the answer back to the relay
- The relay resolves the long-poll, and the hook script gets the answer

### Component 3: CLI wrapper (convenience)

- `cm "fix the bug in conductops"` — bash alias/script
- Sends the prompt to the Discord bot (via relay API or Discord slash command API)
- Runs the session through the Discord bot, not terminal TUI
- For when you want to start from terminal but interact via Discord

## Phasing

### Phase 1: Discord bot enhancements (quick wins)
- [ ] Auto-start via Task Scheduler
- [ ] `/project` command with autocomplete
- [ ] Default to `acceptEdits` + interactive permissions

### Phase 2: Relay service + hooks (core bridge)
- [ ] Build relay server (`relay/server.ts`)
- [ ] Build Discord webhook integration in relay
- [ ] Write `pre-tool-use-ask-user` hook script
- [ ] Write `pre-tool-use-permissions` hook script
- [ ] Wire Discord bot to POST answers back to relay
- [ ] Test end-to-end: terminal session → Discord question → phone answer → terminal continues

### Phase 3: Polish + CLI wrapper
- [ ] `cm` CLI wrapper alias/script
- [ ] Multi-session support (multiple terminal sessions, each with its own Discord thread)
- [ ] Notification preferences (which projects to notify for)
- [ ] Graceful fallback when relay is down (TUI takes over)

## Key Decisions

- **Relay on localhost:8199** — keeps it simple, no auth needed, no external exposure
- **Long-polling** (not WebSockets) — simpler to implement in shell hooks, Deno server, and Discord bot
- **Graceful fallback** — if relay is down, hooks return `allow` without modification and TUI works normally
- **Same Discord channel** — terminal bridge messages go to the same bot channel, so all context is in one place
- **PreToolUse hooks** — this is the only hook type that can intercept and modify tool behavior before execution

## Risks

- **Hook script timeout**: If Discord answer takes too long, the hook might time out. Mitigation: generous timeout (5 min), retry logic.
- **Multiple sessions**: If two terminal sessions both send questions, the relay needs to handle concurrent requests. Mitigation: unique IDs per request.
- **Hook shell environment**: Claude Code hooks run as shell scripts. On Windows, this means Git Bash. Need to ensure `curl` is available for HTTP calls from hooks.
