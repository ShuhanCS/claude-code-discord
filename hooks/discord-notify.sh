#!/bin/bash
# Discord notification hook for Claude Code
# Sends rich messages to Discord when Claude needs attention, finishes, or requests permission.
# Also forwards the full payload to the local relay service (best-effort).

WEBHOOK_URL="https://discordapp.com/api/webhooks/1475012113243312150/4299cDGjqBCKHUpqZ2z5yvP05giA7Oa6k8MKF1_pJo1zGAeP5hAgmF4pGsCefUezUjL_"
RELAY_URL="http://localhost:8199/notification"

# Read JSON from stdin
INPUT=$(cat)

# --- Extract fields using grep/sed (no jq dependency) ---
CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | sed 's/"cwd":"//;s/"$//')
EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | sed 's/"hook_event_name":"//;s/"$//')
SESSION=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/"session_id":"//;s/"$//')
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/"tool_name":"//;s/"$//')

# Get project name from cwd (last folder in path)
PROJECT=$(basename "$CWD" 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SHORT_SESSION="${SESSION:0:8}"

# --- Build embed based on event type ---
case "$EVENT" in
  Notification)
    TITLE="Needs Your Input"
    COLOR=16744448  # orange
    DESCRIPTION="**Project:** \`$PROJECT\`\n**Session:** \`$SHORT_SESSION\`\n\nClaude is waiting for your input. Check the terminal or use Discord \`/claude\`."
    ;;
  Stop)
    TITLE="Finished Turn"
    COLOR=5763719   # green
    DESCRIPTION="**Project:** \`$PROJECT\`\n**Session:** \`$SHORT_SESSION\`\n\nClaude has finished processing and stopped."
    ;;
  PermissionRequest)
    TITLE="Permission Request"
    COLOR=15105570  # yellow-orange
    if [ -n "$TOOL_NAME" ]; then
      DESCRIPTION="**Project:** \`$PROJECT\`\n**Tool:** \`$TOOL_NAME\`\n**Session:** \`$SHORT_SESSION\`\n\nWaiting for permission approval."
    else
      DESCRIPTION="**Project:** \`$PROJECT\`\n**Session:** \`$SHORT_SESSION\`\n\nWaiting for permission approval."
    fi
    ;;
  *)
    TITLE="$EVENT"
    COLOR=3447003   # blue
    DESCRIPTION="**Project:** \`$PROJECT\`\n**Session:** \`$SHORT_SESSION\`"
    ;;
esac

# --- Send rich embed to Discord (async, best-effort) ---
curl -s -X POST "$WEBHOOK_URL" \
  --max-time 5 \
  -H "Content-Type: application/json" \
  -d "{
    \"embeds\": [{
      \"title\": \"Claude Code: $TITLE\",
      \"description\": \"$DESCRIPTION\",
      \"color\": $COLOR,
      \"footer\": {\"text\": \"$CWD\"},
      \"timestamp\": \"$TIMESTAMP\"
    }]
  }" > /dev/null 2>&1 &

# --- Forward full payload to relay service (async, best-effort) ---
curl -s -X POST "$RELAY_URL" \
  --max-time 3 \
  -H "Content-Type: application/json" \
  -d "$INPUT" > /dev/null 2>&1 &

exit 0
