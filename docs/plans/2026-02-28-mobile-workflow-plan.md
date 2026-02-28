# Mobile-First Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable full mobile interaction with Claude Code sessions via Discord — rich notifications from terminal, permission bridging, and Discord bot enhancements for phone-first workflows.

**Architecture:** Three layers: (1) Enhanced hook scripts for rich Discord notifications from terminal sessions, (2) a relay service on localhost:8199 that bridges terminal permission requests to Discord buttons, (3) Discord bot enhancements for multi-project support and a CLI wrapper.

**Tech Stack:** Deno (relay + bot), Bash (hooks), Discord.js, curl (hook → relay HTTP), Discord webhook API

---

### Task 1: Enhanced Discord Notification Hook

**Files:**
- Modify: `C:\Users\Shuha\.claude\hooks\discord-notify.sh`

**Context:** The existing hook sends thin "Needs attention" messages. We need to extract the full notification content from the hook input JSON and display it richly in Discord.

**Step 1: Read the current hook input format**

The hook receives JSON on stdin with these fields for Notification events:
```json
{
  "session_id": "abc123",
  "cwd": "/c/Users/Shuha/projects/conductops",
  "hook_event_name": "Notification",
  "tool_name": "",
  "tool_input": {}
}
```

For `elicitation_dialog` notifications, there may be additional fields with the question content. We need to capture ALL stdin fields and forward the full payload.

**Step 2: Enhance the notification hook script**

Replace `discord-notify.sh` with this enhanced version:

```bash
#!/bin/bash
# Discord notification hook for Claude Code
# Sends rich messages to Discord when Claude needs attention

WEBHOOK_URL="https://discordapp.com/api/webhooks/1475012113243312150/4299cDGjqBCKHUpqZ2z5yvP05giA7Oa6k8MKF1_pJo1zGAeP5hAgmF4pGsCefUezUjL_"

# Read JSON from stdin
INPUT=$(cat)

# Extract common fields
CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | sed 's/"cwd":"//;s/"$//')
EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | sed 's/"hook_event_name":"//;s/"$//')
SESSION=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/"session_id":"//;s/"$//')
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/"tool_name":"//;s/"$//')

# Get project name from cwd
PROJECT=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Build rich message based on event type
if [ "$EVENT" = "Notification" ]; then
  TITLE="Needs attention"
  COLOR=16744448  # orange

  # Try to extract notification content for rich display
  # The full input JSON has the notification details
  # Forward the raw JSON payload (first 1500 chars) as context
  RAW_PREVIEW=$(echo "$INPUT" | head -c 1500 | sed 's/"/\\"/g' | tr '\n' ' ')

  DESCRIPTION="**Project:** \`$PROJECT\`\\n**Session:** \`${SESSION:0:8}\`\\n\\n_Claude is waiting for your input. Check the terminal or use Discord /claude._"

  # Also try to post to relay service if running (best-effort)
  curl -s -X POST "http://localhost:8199/notification" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1 &

elif [ "$EVENT" = "Stop" ]; then
  TITLE="Finished turn"
  COLOR=5763719   # green
  DESCRIPTION="**Project:** \`$PROJECT\`"

elif [ "$EVENT" = "PermissionRequest" ]; then
  TITLE="Permission needed"
  COLOR=16776960  # yellow

  # Extract tool info for rich display
  if [ -n "$TOOL_NAME" ]; then
    DESCRIPTION="**Project:** \`$PROJECT\`\\n**Tool:** \`$TOOL_NAME\`\\n\\n_Waiting for permission approval._"
  else
    DESCRIPTION="**Project:** \`$PROJECT\`\\n\\n_Waiting for permission approval._"
  fi

  # Post to relay for interactive bridge
  curl -s -X POST "http://localhost:8199/permission" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1 &

else
  TITLE="$EVENT"
  COLOR=3447003   # blue
  DESCRIPTION="**Project:** \`$PROJECT\`"
fi

# Send to Discord webhook
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"embeds\": [{
      \"title\": \"Claude Code: $TITLE\",
      \"description\": \"$DESCRIPTION\",
      \"color\": $COLOR,
      \"footer\": {\"text\": \"Session: ${SESSION:0:8} | $(date +%H:%M)\"},
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }]
  }" > /dev/null 2>&1 &

exit 0
```

**Step 3: Test the enhanced hook**

Run: `echo '{"session_id":"test123","cwd":"/c/Users/Shuha/projects/conductops","hook_event_name":"Notification"}' | bash ~/.claude/hooks/discord-notify.sh`
Expected: Rich Discord message appears with project name, session, and guidance text.

**Step 4: Commit**

```bash
cd ~/projects/claude-code-discord
git add -A
git commit -m "feat: enhanced discord notification hook with rich context"
```

---

### Task 2: Permission Request Hook Registration

**Files:**
- Modify: `C:\Users\Shuha\.claude\settings.json` (add PermissionRequest hook)

**Step 1: Add PermissionRequest hook to settings.json**

Add a new hook entry for `PermissionRequest` events. This hook will:
1. Send a rich notification to Discord (via the same discord-notify.sh, which now handles PermissionRequest)
2. If the relay is running, also post to it for interactive bridge

Add to the `hooks` object in `~/.claude/settings.json`:

```json
"PermissionRequest": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "bash ~/.claude/hooks/permission-bridge.sh",
        "timeout": 300
      }
    ]
  }
]
```

Note: 300s (5 min) timeout — long enough for user to see Discord notification and respond.

**Step 2: Create the permission bridge hook script**

Create `~/.claude/hooks/permission-bridge.sh`:

```bash
#!/bin/bash
# Permission bridge hook for Claude Code
# Routes permission requests to Discord via relay service
# Falls through to TUI if relay is unavailable

WEBHOOK_URL="https://discordapp.com/api/webhooks/1475012113243312150/4299cDGjqBCKHUpqZ2z5yvP05giA7Oa6k8MKF1_pJo1zGAeP5hAgmF4pGsCefUezUjL_"
RELAY_URL="http://localhost:8199"

# Read JSON from stdin
INPUT=$(cat)

# Extract fields
CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | sed 's/"cwd":"//;s/"$//')
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/"tool_name":"//;s/"$//')
SESSION=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/"session_id":"//;s/"$//')
PROJECT=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Try to extract command for Bash tool
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"$//')

# Try to post to relay service for interactive bridge
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$RELAY_URL/permission" \
  -H "Content-Type: application/json" \
  -d "$INPUT" 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  # Relay is running — extract permissionId and long-poll for decision
  PERM_ID=$(echo "$BODY" | grep -o '"permissionId":"[^"]*"' | head -1 | sed 's/"permissionId":"//;s/"$//')

  if [ -n "$PERM_ID" ]; then
    # Long-poll for decision (up to 5 minutes, 30s per poll)
    for i in $(seq 1 10); do
      POLL_RESPONSE=$(curl -s -w "\n%{http_code}" "$RELAY_URL/permission/$PERM_ID" 2>/dev/null)
      POLL_CODE=$(echo "$POLL_RESPONSE" | tail -1)
      POLL_BODY=$(echo "$POLL_RESPONSE" | head -1)

      if [ "$POLL_CODE" = "200" ]; then
        DECISION=$(echo "$POLL_BODY" | grep -o '"decision":"[^"]*"' | head -1 | sed 's/"decision":"//;s/"$//')

        if [ "$DECISION" = "allow" ]; then
          # Return allow JSON
          echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"allow","permissionDecisionReason":"Approved from Discord mobile"}}'
          exit 0
        elif [ "$DECISION" = "deny" ]; then
          # Return deny JSON
          echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"deny","permissionDecisionReason":"Denied from Discord mobile"}}'
          exit 0
        fi
        # If "pending", continue polling
      fi

      sleep 3
    done

    # Timeout — fall through to TUI
    echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"ask"}}'
    exit 0
  fi
fi

# Relay not available — send Discord notification and fall through to TUI
if [ -n "$COMMAND" ]; then
  DESC="**Project:** \`$PROJECT\`\\n**Tool:** \`$TOOL_NAME\`\\n**Command:** \`\`\`${COMMAND:0:200}\`\`\`\\n\\n_Relay offline. Approve in terminal._"
else
  DESC="**Project:** \`$PROJECT\`\\n**Tool:** \`$TOOL_NAME\`\\n\\n_Relay offline. Approve in terminal._"
fi

curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"embeds\": [{
      \"title\": \"Claude Code: Permission Needed\",
      \"description\": \"$DESC\",
      \"color\": 16776960,
      \"footer\": {\"text\": \"Session: ${SESSION:0:8} | $(date +%H:%M)\"},
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }]
  }" > /dev/null 2>&1 &

# Fall through to TUI (ask user in terminal)
echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"ask"}}'
exit 0
```

**Step 3: Test the hook script**

Run: `echo '{"session_id":"test123","cwd":"/c/Users/Shuha/projects/conductops","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"npm test"}}' | bash ~/.claude/hooks/permission-bridge.sh`
Expected: Discord notification appears (relay not running yet, so falls through to TUI).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: permission bridge hook with relay + Discord fallback"
```

---

### Task 3: Relay Service

**Files:**
- Create: `C:\Users\Shuha\projects\claude-code-discord\relay\server.ts`
- Create: `C:\Users\Shuha\projects\claude-code-discord\relay\types.ts`

**Step 1: Create the types file**

Create `relay/types.ts`:

```typescript
export interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  project: string;
  sessionId: string;
  cwd: string;
  decision: 'pending' | 'allow' | 'deny';
  createdAt: number;
}

export interface NotificationRequest {
  id: string;
  eventName: string;
  project: string;
  sessionId: string;
  cwd: string;
  rawInput: Record<string, unknown>;
  createdAt: number;
}
```

**Step 2: Create the relay server**

Create `relay/server.ts`:

```typescript
import type { PermissionRequest, NotificationRequest } from "./types.ts";

const PORT = 8199;
const STALE_TIMEOUT = 10 * 60 * 1000; // 10 min
const POLL_TIMEOUT = 30 * 1000; // 30s long-poll

const WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL") ||
  "https://discordapp.com/api/webhooks/1475012113243312150/4299cDGjqBCKHUpqZ2z5yvP05giA7Oa6k8MKF1_pJo1zGAeP5hAgmF4pGsCefUezUjL_";

// In-memory stores
const permissions = new Map<string, PermissionRequest>();
const notifications = new Map<string, NotificationRequest>();

// Waiting resolvers for long-poll
const waiters = new Map<string, (decision: string) => void>();

let idCounter = 0;
function newId(): string {
  return `${Date.now()}-${++idCounter}`;
}

// Cleanup stale entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of permissions) {
    if (now - req.createdAt > STALE_TIMEOUT) {
      permissions.delete(id);
      const waiter = waiters.get(id);
      if (waiter) {
        waiter('timeout');
        waiters.delete(id);
      }
    }
  }
  for (const [id, req] of notifications) {
    if (now - req.createdAt > STALE_TIMEOUT) {
      notifications.delete(id);
    }
  }
}, 60_000);

// Send Discord embed via webhook
async function sendDiscordEmbed(embed: Record<string, unknown>): Promise<void> {
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) {
    console.error("[relay] Discord webhook error:", e);
  }
}

// Send permission request to Discord with Allow/Deny info
async function sendPermissionToDiscord(req: PermissionRequest): Promise<void> {
  const commandPreview = req.toolInput?.command
    ? `\`\`\`\n${String(req.toolInput.command).substring(0, 300)}\n\`\`\``
    : JSON.stringify(req.toolInput, null, 2).substring(0, 300);

  await sendDiscordEmbed({
    title: `🔐 Permission Request: ${req.toolName}`,
    description: `**Project:** \`${req.project}\`\n**Tool:** \`${req.toolName}\`\n${commandPreview}\n\n**To approve from Discord bot:** \`/permit ${req.id} allow\` or \`/permit ${req.id} deny\`\n\nOr use the relay API: \`POST localhost:8199/permission/${req.id}/decide\``,
    color: 16776960, // yellow
    footer: { text: `Session: ${req.sessionId.substring(0, 8)} | ID: ${req.id}` },
    timestamp: new Date().toISOString(),
  });
}

// HTTP handler
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // POST /permission — hook submits a permission request
  if (request.method === "POST" && path === "/permission") {
    const body = await request.json();
    const id = newId();
    const project = body.cwd ? body.cwd.split(/[/\\]/).pop() : "unknown";

    const req: PermissionRequest = {
      id,
      toolName: body.tool_name || "Unknown",
      toolInput: body.tool_input || {},
      project,
      sessionId: body.session_id || "",
      cwd: body.cwd || "",
      decision: "pending",
      createdAt: Date.now(),
    };

    permissions.set(id, req);
    console.log(`[relay] Permission request ${id}: ${req.toolName} in ${req.project}`);

    // Send to Discord
    sendPermissionToDiscord(req);

    return Response.json({ permissionId: id });
  }

  // GET /permission/:id — hook long-polls for decision
  if (request.method === "GET" && path.startsWith("/permission/") && !path.includes("/decide")) {
    const id = path.split("/")[2];
    const req = permissions.get(id);

    if (!req) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    if (req.decision !== "pending") {
      return Response.json({ decision: req.decision });
    }

    // Long-poll: wait for decision
    const decision = await new Promise<string>((resolve) => {
      waiters.set(id, resolve);
      setTimeout(() => {
        if (waiters.has(id)) {
          waiters.delete(id);
          resolve("pending");
        }
      }, POLL_TIMEOUT);
    });

    return Response.json({ decision });
  }

  // POST /permission/:id/decide — Discord bot (or user) submits decision
  if (request.method === "POST" && path.match(/^\/permission\/[^/]+\/decide$/)) {
    const id = path.split("/")[2];
    const body = await request.json();
    const decision = body.decision; // "allow" or "deny"

    const req = permissions.get(id);
    if (!req) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    req.decision = decision;
    console.log(`[relay] Permission ${id} decided: ${decision}`);

    // Wake up the long-poller
    const waiter = waiters.get(id);
    if (waiter) {
      waiter(decision);
      waiters.delete(id);
    }

    return Response.json({ ok: true });
  }

  // POST /notification — hook forwards a notification for rich display
  if (request.method === "POST" && path === "/notification") {
    const body = await request.json();
    const id = newId();
    const project = body.cwd ? body.cwd.split(/[/\\]/).pop() : "unknown";

    const req: NotificationRequest = {
      id,
      eventName: body.hook_event_name || "Notification",
      project,
      sessionId: body.session_id || "",
      cwd: body.cwd || "",
      rawInput: body,
      createdAt: Date.now(),
    };

    notifications.set(id, req);
    console.log(`[relay] Notification ${id}: ${req.eventName} in ${req.project}`);

    return Response.json({ notificationId: id });
  }

  // GET /health — simple health check
  if (request.method === "GET" && path === "/health") {
    return Response.json({
      status: "ok",
      pendingPermissions: [...permissions.values()].filter(p => p.decision === "pending").length,
      totalPermissions: permissions.size,
      totalNotifications: notifications.size,
    });
  }

  // GET /permissions — list all pending permissions (for bot polling)
  if (request.method === "GET" && path === "/permissions") {
    const pending = [...permissions.values()]
      .filter(p => p.decision === "pending")
      .map(p => ({
        id: p.id,
        toolName: p.toolName,
        project: p.project,
        createdAt: p.createdAt,
      }));
    return Response.json(pending);
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

console.log(`[relay] Starting on port ${PORT}`);
Deno.serve({ port: PORT }, handler);
```

**Step 3: Test the relay server**

Run: `cd ~/projects/claude-code-discord && deno run --allow-all relay/server.ts`
Then in another terminal:
```bash
# Submit a permission request
curl -s -X POST http://localhost:8199/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","cwd":"/c/Users/Shuha/projects/conductops","tool_name":"Bash","tool_input":{"command":"npm test"}}'

# Check health
curl -s http://localhost:8199/health

# Decide on it (replace ID from submit response)
curl -s -X POST http://localhost:8199/permission/PERM_ID/decide \
  -H "Content-Type: application/json" \
  -d '{"decision":"allow"}'
```

Expected: Permission flows through, Discord webhook fires, decision resolves.

**Step 4: Commit**

```bash
git add relay/
git commit -m "feat: relay service for terminal-to-Discord permission bridge"
```

---

### Task 4: Wire Discord Bot to Relay

**Files:**
- Create: `C:\Users\Shuha\projects\claude-code-discord\relay\bot-integration.ts`
- Modify: `C:\Users\Shuha\projects\claude-code-discord\index.ts` (add relay polling)

**Step 1: Create the bot-relay integration module**

Create `relay/bot-integration.ts`:

```typescript
/**
 * Polls the relay service for pending permission requests from terminal sessions
 * and creates interactive Discord messages with Allow/Deny buttons.
 * When user clicks, posts the decision back to the relay.
 */

const RELAY_URL = "http://localhost:8199";
const POLL_INTERVAL = 2000; // 2 seconds

export interface RelayPermission {
  id: string;
  toolName: string;
  project: string;
  createdAt: number;
}

/** Fetch pending permissions from relay */
export async function fetchPendingPermissions(): Promise<RelayPermission[]> {
  try {
    const response = await fetch(`${RELAY_URL}/permissions`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return []; // Relay not running
  }
}

/** Post a decision back to the relay */
export async function postDecision(permissionId: string, decision: "allow" | "deny"): Promise<boolean> {
  try {
    const response = await fetch(`${RELAY_URL}/permission/${permissionId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Check if relay is running */
export async function isRelayHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${RELAY_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start polling the relay for pending permissions.
 * Calls onNewPermission for each new permission found.
 * Returns a cleanup function to stop polling.
 */
export function startRelayPoller(
  onNewPermission: (perm: RelayPermission) => void
): () => void {
  const seenIds = new Set<string>();
  let running = true;

  const poll = async () => {
    while (running) {
      const permissions = await fetchPendingPermissions();
      for (const perm of permissions) {
        if (!seenIds.has(perm.id)) {
          seenIds.add(perm.id);
          onNewPermission(perm);
        }
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  };

  poll();

  return () => { running = false; };
}
```

**Step 2: Integrate relay poller into bot startup**

In `index.ts`, after the bot is created and the channel is ready, start polling the relay. When a new permission arrives, create an embed with Allow/Deny buttons. When user clicks, post the decision back.

Add after `askUserState.handler = createAskUserDiscordHandler(bot);` (around line 230):

```typescript
// Start relay poller for terminal permission bridge
import { startRelayPoller, postDecision, type RelayPermission } from "./relay/bot-integration.ts";

const stopRelayPoller = startRelayPoller(async (perm: RelayPermission) => {
  const channel = bot.getChannel();
  if (!channel) return;

  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = await import("npm:discord.js@14.14.1");

  const embed = new EmbedBuilder()
    .setColor(0xff9900)
    .setTitle(`🔐 Terminal Permission: ${perm.toolName}`)
    .setDescription(`A terminal Claude Code session needs permission.\n\n**Project:** \`${perm.project}\`\n**Tool:** \`${perm.toolName}\``)
    .setFooter({ text: `Relay ID: ${perm.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`relay-perm:${perm.id}:allow`)
      .setLabel('✅ Allow')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`relay-perm:${perm.id}:deny`)
      .setLabel('❌ Deny')
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });

  // Wait for button click
  const interaction = await msg.awaitMessageComponent({
    componentType: ComponentType.Button,
  });

  const parts = interaction.customId.split(':');
  const decision = parts[2] as 'allow' | 'deny';

  // Post decision to relay
  await postDecision(perm.id, decision);

  // Update embed
  embed.setColor(decision === 'allow' ? 0x00ff00 : 0xff4444)
    .setFooter({ text: decision === 'allow' ? '✅ Allowed from Discord' : '❌ Denied from Discord' });

  await interaction.update({ embeds: [embed], components: [] });
});
```

Also register cleanup in the shutdown handler.

**Step 3: Test end-to-end**

1. Start relay: `deno run --allow-all relay/server.ts`
2. Start bot: `deno task start`
3. Simulate a terminal permission request:
```bash
echo '{"session_id":"test","cwd":"/c/Users/Shuha/projects/conductops","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"npm test"}}' | bash ~/.claude/hooks/permission-bridge.sh
```
4. Check Discord — should see Allow/Deny buttons
5. Click Allow on phone — hook should get the decision and return

**Step 4: Commit**

```bash
git add relay/ index.ts
git commit -m "feat: wire Discord bot to relay for terminal permission bridge"
```

---

### Task 5: Multi-Project `/project` Command

**Files:**
- Create: `C:\Users\Shuha\projects\claude-code-discord\project\command.ts`
- Create: `C:\Users\Shuha\projects\claude-code-discord\project\handler.ts`
- Create: `C:\Users\Shuha\projects\claude-code-discord\project\index.ts`
- Modify: `C:\Users\Shuha\projects\claude-code-discord\index.ts` (register command)

**Step 1: Create the project command module**

Create `project/command.ts`:

```typescript
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
```

**Step 2: Create the project handler**

Create `project/handler.ts`:

```typescript
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

const PROJECTS_DIR = "C:\\Users\\Shuha\\projects";

export interface ProjectHandlerDeps {
  getWorkDir: () => string;
  setWorkDir: (dir: string) => void;
}

export function createProjectHandler(deps: ProjectHandlerDeps) {
  return {
    async onProject(ctx: any, action: string, name?: string) {
      switch (action) {
        case 'list': {
          const entries: string[] = [];
          for await (const entry of Deno.readDir(PROJECTS_DIR)) {
            if (entry.isDirectory) {
              entries.push(entry.name);
            }
          }
          entries.sort();
          const current = path.basename(deps.getWorkDir());
          const list = entries.map(e =>
            e === current ? `**→ ${e}** (current)` : `  ${e}`
          ).join('\n');

          await ctx.editReply({
            embeds: [{
              color: 0x0099ff,
              title: '📁 Projects',
              description: list || 'No projects found',
              footer: { text: `${entries.length} projects in ${PROJECTS_DIR}` },
              timestamp: true,
            }]
          });
          break;
        }

        case 'set': {
          if (!name) {
            await ctx.editReply({ content: 'Provide a project name: `/project action:set name:conductops`' });
            return;
          }
          const newDir = path.join(PROJECTS_DIR, name);
          try {
            const stat = await Deno.stat(newDir);
            if (!stat.isDirectory) {
              await ctx.editReply({ content: `\`${name}\` is not a directory.` });
              return;
            }
          } catch {
            await ctx.editReply({ content: `Project \`${name}\` not found in ${PROJECTS_DIR}` });
            return;
          }

          deps.setWorkDir(newDir);
          await ctx.editReply({
            embeds: [{
              color: 0x00ff00,
              title: '✅ Project switched',
              description: `Now working in **${name}**\n\`${newDir}\``,
              timestamp: true,
            }]
          });
          break;
        }

        case 'current': {
          await ctx.editReply({
            embeds: [{
              color: 0x0099ff,
              title: '📁 Current Project',
              description: `**${path.basename(deps.getWorkDir())}**\n\`${deps.getWorkDir()}\``,
              timestamp: true,
            }]
          });
          break;
        }
      }
    },

    /** Autocomplete project names for the name option */
    async autocompleteProjectName(typed: string): Promise<{ name: string; value: string }[]> {
      const entries: string[] = [];
      try {
        for await (const entry of Deno.readDir(PROJECTS_DIR)) {
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
```

**Step 3: Create index.ts barrel export**

Create `project/index.ts`:

```typescript
export { projectCommands } from "./command.ts";
export { createProjectHandler, type ProjectHandlerDeps } from "./handler.ts";
```

**Step 4: Register in main bot setup**

Import and wire into the handler registry and command list. Add project commands to `getAllCommands()` and register the handler.

**Step 5: Test**

In Discord: `/project action:list` → should show all project folders
`/project action:set name:conductops` → should switch working directory

**Step 6: Commit**

```bash
git add project/
git commit -m "feat: /project command for multi-project switching"
```

---

### Task 6: Auto-start via Windows Task Scheduler

**Files:**
- Create: `C:\Users\Shuha\projects\claude-code-discord\scripts\autostart.ps1`

**Step 1: Create the autostart script**

Create `scripts/autostart.ps1`:

```powershell
# Auto-start Claude Code Discord Bot
# Register with: schtasks /create /tn "Claude Discord Bot" /tr "powershell -ExecutionPolicy Bypass -File C:\Users\Shuha\projects\claude-code-discord\scripts\autostart.ps1" /sc onlogon /rl highest

Set-Location "C:\Users\Shuha\projects\claude-code-discord"

# Check if already running
$existing = Get-Process -Name "deno" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*claude-code-discord*"
}

if ($existing) {
    Write-Host "Bot already running (PID: $($existing.Id))"
    exit 0
}

# Start the bot
& deno task start
```

**Step 2: Register the task**

Run in PowerShell (admin):
```powershell
schtasks /create /tn "Claude Discord Bot" /tr "powershell -ExecutionPolicy Bypass -File C:\Users\Shuha\projects\claude-code-discord\scripts\autostart.ps1" /sc onlogon /rl highest
```

**Step 3: Commit**

```bash
git add scripts/
git commit -m "feat: autostart script for Windows Task Scheduler"
```

---

### Task 7: Update settings.json and Notification Hook

**Files:**
- Modify: `C:\Users\Shuha\.claude\settings.json`
- Modify: `C:\Users\Shuha\.claude\hooks\discord-notify.sh`

**Step 1: Update settings.json to add PermissionRequest and Notification elicitation hooks**

Add the `PermissionRequest` hook entry and update `Notification` to also include the `elicitation_dialog` matcher for rich question display.

**Step 2: Also add Notification hook for `elicitation_dialog` specifically**

This fires when Claude asks a question in the terminal. The hook can extract the question details and send them to Discord.

**Step 3: Test by running a Claude Code session in terminal**

Start a Claude Code session that will ask a question or need permission. Verify:
- Discord shows rich notification with full context
- If relay is running, permission requests get interactive buttons
- If relay is not running, falls back gracefully to TUI

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: register permission + notification hooks in settings"
```

---

### Task 8: Integration Test

**Step 1: Start both services**

Terminal 1: `cd ~/projects/claude-code-discord && deno run --allow-all relay/server.ts`
Terminal 2: `cd ~/projects/claude-code-discord && deno task start`

**Step 2: Test permission bridge end-to-end**

Terminal 3: Start a Claude Code session in a project with `default` permission mode:
```bash
cd ~/projects/conductops
claude
```

When Claude tries to use Bash, the permission hook should:
1. Post to relay
2. Relay sends to Discord
3. Discord shows Allow/Deny buttons
4. Tap Allow on phone
5. Terminal session continues

**Step 3: Test notification richness**

When Claude sends a notification or asks a question, verify Discord shows full context.

**Step 4: Test fallback when relay is down**

Stop the relay server. Repeat the permission test. Verify:
- Discord still gets a notification (via webhook in the hook script)
- TUI shows the normal permission prompt (hook returns `ask`)

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: mobile workflow v1 — rich notifications + permission bridge"
git tag -a v2.3.0 -m "Mobile-first workflow: rich Discord notifications from terminal sessions, permission bridge via relay service, /project command for multi-project switching"
```
