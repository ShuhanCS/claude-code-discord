# Auto-start Claude Code Discord Bot
# Register with: schtasks /create /tn "Claude Discord Bot" /tr "powershell -ExecutionPolicy Bypass -File C:\Users\Shuha\projects\claude-code-discord\scripts\autostart.ps1" /sc onlogon /rl highest

Set-Location "C:\Users\Shuha\projects\claude-code-discord"

# Check if already running by looking for the relay or bot on their ports
$relayPort = Get-NetTCPConnection -LocalPort 8199 -ErrorAction SilentlyContinue
$botRunning = Get-Process -Name "deno" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.CommandLine -like "*claude-code-discord*" } catch { $false }
}

if ($botRunning) {
    Write-Host "Bot already running (PID: $($botRunning.Id))"
    exit 0
}

# Start the relay service in the background
Write-Host "Starting relay service..."
Start-Process -FilePath "deno" -ArgumentList "run", "--allow-all", "relay/server.ts" -WindowStyle Hidden

# Start the bot
Write-Host "Starting Discord bot..."
& deno task start
