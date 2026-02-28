/**
 * Relay Bot Integration
 *
 * Polls the relay service for pending permission requests from terminal sessions
 * and creates interactive Discord messages with Allow/Deny buttons.
 * When the user clicks, posts the decision back to the relay.
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
export async function postDecision(
  permissionId: string,
  decision: "allow" | "deny",
): Promise<boolean> {
  try {
    const response = await fetch(
      `${RELAY_URL}/permission/${permissionId}/decide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
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
  onNewPermission: (perm: RelayPermission) => void,
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
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  };

  poll();

  return () => {
    running = false;
  };
}
