# SDK Upgrade & Fix Plan (0.2.45 → 0.2.74)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Claude Agent SDK from 0.2.45 to 0.2.74, fix all breaking changes, handle new message types, fix dead code, and remove `delegate` permission mode.

**Architecture:** Mechanical update — fix type mismatches in the `claude/` layer, update message converter for new SDK message types, remove dead code in `util/`, fix signal handler.

**Tech Stack:** Deno 2.x, TypeScript, @anthropic-ai/claude-agent-sdk 0.2.74, discord.js 14.14.1

---

## Task 1: SDK Version Bump

**Files:**
- Modify: `deno.json:31`

- [ ] **Step 1: Update SDK version in deno.json**
Change `0.2.45` to `0.2.74`

- [ ] **Step 2: Clear Deno cache and verify resolution**
Run: `cd C:/Users/Shuha/projects/claude-code-discord && deno cache --reload index.ts`

---

## Task 2: Fix PermissionMode — Remove `delegate`

SDK 0.2.74 no longer has `delegate` in PermissionMode union.

**Files:**
- Modify: `claude/client.ts:77` — remove `delegate` from SDKPermissionMode type
- Modify: `claude/info-commands.ts:390` — remove `delegate` from validModes array
- Modify: `settings/unified-settings.ts:272-278` — remove `delegate` entry from OPERATION_MODES

---

## Task 3: Fix `canUseTool` Callback Signature

SDK 0.2.74 changed `canUseTool` from `(toolName, input) => Promise<PermissionResult>` to `(toolName, input, options) => Promise<PermissionResult>` where options has `{ signal, suggestions, blockedPath, decisionReason, toolUseID, agentID }`.

**Files:**
- Modify: `claude/client.ts:268` — add third `options` parameter to canUseTool callback

---

## Task 4: Handle New SDKMessage Types in Message Converter

SDK 0.2.74 added: `rate_limit_event`, `prompt_suggestion`, `auth_status`, `stream_event`, `system.hook_started`, `system.hook_progress`, `system.hook_response`, `system.compact_boundary`, `system.local_command_output`, `system.files_persisted`, `system.elicitation_complete`

**Files:**
- Modify: `claude/types.ts:19` — add new message types to ClaudeMessage.type union
- Modify: `claude/message-converter.ts` — add handlers for new message types

---

## Task 5: Fix Dead/Non-Functional Code

**Files:**
- Modify: `claude/enhanced-client.ts:455-464` — fix `isValidModel` to actually reject clearly invalid inputs
- Modify: `core/signal-handler.ts:212-222` — fix `removeSignalHandlers` to store and remove handler refs
- Keep: `util/proxy.ts` — leave as scaffolding (documented in known-issues, still importable)

---

## Task 6: Surface New ModelInfo Fields

SDK 0.2.74 ModelInfo now has: `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode`

**Files:**
- Modify: `claude/enhanced-client.ts:496-534` — `updateModelsFromSDK()` to merge new fields
- Modify: `claude/info-commands.ts:158` — show capability flags in /claude-info models section

---

## Task 7: Update Version + Commit

**Files:**
- Modify: `deno.json:2` — bump bot version to 2.5.0

---
