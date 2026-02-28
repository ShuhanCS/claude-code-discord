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
          echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"allow","permissionDecisionReason":"Approved from Discord mobile"}}'
          exit 0
        elif [ "$DECISION" = "deny" ]; then
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
  DESC="**Project:** \`$PROJECT\`\n**Tool:** \`$TOOL_NAME\`\n**Command:** \`\`\`${COMMAND:0:200}\`\`\`\n\n_Relay offline. Approve in terminal._"
else
  DESC="**Project:** \`$PROJECT\`\n**Tool:** \`$TOOL_NAME\`\n\n_Relay offline. Approve in terminal._"
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
