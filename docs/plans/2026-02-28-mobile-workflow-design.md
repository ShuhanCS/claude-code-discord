# Mobile-First Claude Code Workflow via Discord

**Date:** 2026-02-28
**Status:** Approved (design revised after technical research)
**Project:** claude-code-discord

## Problem

When Claude Code runs in the terminal and needs user input (AskUserQuestion, permission requests), the notification that reaches Discord mobile is a thin "needs attention" message with no context. You can't see WHAT Claude is asking or respond from your phone.

## Goal

Full mobile access to Claude Code sessions — whether started from Discord or from the terminal. See exactly what Claude needs, respond with buttons from your phone.

## Technical Constraints (discovered during research)

1. **AskUserQuestion CANNOT be intercepted by hooks.** It's not a matchable tool name in `PreToolUse`. Filed as feature request (issue #12605, closed). The `Notification` event fires with `elicitation_dialog` matcher, but it's read-only — you can see the question but can't answer programmatically.

2. **PermissionRequest CAN be intercepted.** The `PermissionRequest` hook event fires when the permission dialog appears and can return allow/deny decisions via JSON output.

3. **For full AskUserQuestion interactivity from mobile**, the only path is the Discord bot's `/claude` command (which handles it via the SDK's `canUseTool` callback).

4. **Windows hooks** require `CLAUDE_CODE_GIT_BASH_PATH` env var and LF line endings.

## Design

### Component 1: Rich Discord Notifications (Terminal Sessions)

Enhance the existing `discord-notify.sh` hook to extract and display full context.

#### 1a. Enhanced notification hook
- Detect `elicitation_dialog` notifications — extract question text and options from the notification payload
- Display rich Discord embeds showing the exact question Claude is asking, with all options listed
- Include project name, session ID, and working directory
- User sees full context on phone and knows whether they need to walk to the terminal

#### 1b. Permission request notifications
- Add a `PermissionRequest` hook that sends rich notifications showing the tool name, command/input, and project
- Include Allow/Deny buttons — these connect to the relay service (Component 3) to pipe the answer back
- This is the one interaction that CAN be fully bridged terminal → Discord → terminal

### Component 2: Discord Bot Enhancements

#### 2a. Multi-project `/project` command
- `/project list` — lists all directories in `C:\Users\Shuha\projects\`
- `/project set <name>` — switches the bot's working directory to that project
- Autocomplete from project folder names
- Current project shown in bot status / startup message

#### 2b. Default to interactive permissions
- Default permission mode: `acceptEdits` (auto-allows reads + edits)
- Interactive permission buttons for Bash commands (Allow/Deny)
- So Claude can work autonomously while you're on mobile, only stopping for shell commands

#### 2c. Auto-start on Shuputer boot
- Windows Task Scheduler runs `deno task start` on login
- Bot stays running 24/7

### Component 3: Permission Bridge (Relay Service)

For terminal permission requests ONLY (the one thing hooks CAN bridge):

```
Terminal Claude Code session
    ↓
[PermissionRequest hook] fires for Bash/Write/etc.
    ↓
Hook script → POST to relay API (localhost:8199/permission)
    ↓
Relay → sends Discord embed with Allow/Deny buttons
    → User taps button on phone
    → Discord bot → POST decision back to relay
    ↓
Hook script ← long-polls relay for decision
    ↓
Hook returns allow or deny JSON
    ↓
Terminal Claude Code continues or skips the tool
```

#### 3a. Relay service
- Location: `claude-code-discord/relay/`
- Tiny Deno HTTP server on `localhost:8199`
- Endpoints:
  - `POST /permission` — hook posts permission request, gets `permissionId`
  - `GET /permission/:id` — hook long-polls for decision (30s timeout, retry)
  - `POST /permission/:id/decide` — Discord bot posts allow/deny
- In-memory Map, auto-cleanup after 10 min

#### 3b. Permission hook script
- `~/.claude/hooks/permission-bridge.sh`
- Registered on `PermissionRequest` event (not `PreToolUse`)
- Posts tool name + input to relay, long-polls for decision
- Falls through to TUI if relay is unreachable

#### 3c. Discord bot integration
- Relay forwards to Discord webhook/bot channel
- Bot shows rich embed + Allow/Deny buttons (reuses existing permission embed code)
- Button click → POST to relay → hook gets answer

### Component 4: CLI wrapper (convenience)

- `cm "fix the bug in conductops"` — sends prompt to Discord bot
- Sessions run through Discord bot (full mobile interactivity including AskUserQuestion)
- For when you want to start from terminal but have mobile access

## Interaction Matrix

| Scenario | AskUserQuestion | Permission Requests | Start Session |
|----------|----------------|-------------------|--------------|
| Discord `/claude` (phone) | Full buttons + response | Full Allow/Deny buttons | `/claude prompt:...` |
| Terminal + rich notifications | See question on Discord, answer at terminal | Answer from Discord via relay bridge | Type in terminal |
| `cm` CLI wrapper | Full buttons (via Discord bot) | Full Allow/Deny (via Discord bot) | `cm "prompt"` |

## Phasing

### Phase 1: Rich notifications + bot enhancements
- [ ] Enhance `discord-notify.sh` for rich `elicitation_dialog` content
- [ ] Add `PermissionRequest` notification hook
- [ ] `/project` command with autocomplete
- [ ] Default to `acceptEdits` + interactive permissions
- [ ] Auto-start via Task Scheduler

### Phase 2: Permission bridge (relay service)
- [ ] Build relay server (`relay/server.ts`)
- [ ] Write `permission-bridge.sh` hook
- [ ] Wire Discord bot to POST decisions back to relay
- [ ] Test end-to-end: terminal → permission → Discord → tap Allow → terminal continues

### Phase 3: CLI wrapper + polish
- [ ] `cm` CLI wrapper
- [ ] Multi-session support (concurrent terminal sessions)
- [ ] Notification preferences per project

## Key Decisions

- **Relay on localhost:8199** — simple, no auth, no external exposure
- **Long-polling** — simpler than WebSockets for shell hook scripts
- **Graceful fallback** — if relay is down, TUI works normally
- **AskUserQuestion = notification only** — technical limitation of Claude Code hooks
- **Permissions = full bridge** — hooks CAN intercept and return decisions
- **For full mobile**: Use Discord bot `/claude` or `cm` wrapper (the only way to get AskUserQuestion interactivity remotely)
