import type { NotificationRequest, PermissionRequest } from "./types.ts";

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
        waiter("timeout");
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
    title: `Permission Request: ${req.toolName}`,
    description:
      `**Project:** \`${req.project}\`\n**Tool:** \`${req.toolName}\`\n${commandPreview}\n\n**To approve from Discord bot:** \`/permit ${req.id} allow\` or \`/permit ${req.id} deny\`\n\nOr use the relay API: \`POST localhost:8199/permission/${req.id}/decide\``,
    color: 16776960,
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
    const project = body.cwd ? String(body.cwd).split(/[/\\]/).pop() : "unknown";

    const req: PermissionRequest = {
      id,
      toolName: body.tool_name || "Unknown",
      toolInput: body.tool_input || {},
      project: project || "unknown",
      sessionId: body.session_id || "",
      cwd: body.cwd || "",
      decision: "pending",
      createdAt: Date.now(),
    };

    permissions.set(id, req);
    console.log(`[relay] Permission request ${id}: ${req.toolName} in ${req.project}`);

    // Send to Discord (fire and forget)
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
  if (request.method === "POST" && /^\/permission\/[^/]+\/decide$/.test(path)) {
    const id = path.split("/")[2];
    const body = await request.json();
    const decision = body.decision as "allow" | "deny";

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
    const project = body.cwd ? String(body.cwd).split(/[/\\]/).pop() : "unknown";

    const req: NotificationRequest = {
      id,
      eventName: body.hook_event_name || "Notification",
      project: project || "unknown",
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
      pendingPermissions: [...permissions.values()].filter((p) => p.decision === "pending").length,
      totalPermissions: permissions.size,
      totalNotifications: notifications.size,
    });
  }

  // GET /permissions — list all pending permissions (for bot polling)
  if (request.method === "GET" && path === "/permissions") {
    const pending = [...permissions.values()]
      .filter((p) => p.decision === "pending")
      .map((p) => ({
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
