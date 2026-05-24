$port = 9222
$url = "http://localhost:$port/json"

# Start Edge headless
$process = Start-Process -FilePath "msedge.exe" -ArgumentList "--headless", "--disable-gpu", "--remote-debugging-port=$port", "file:///C:/Users/mauri koop junior/.gemini/antigravity/scratch/barbearia_deploy/test_syntax.html" -PassThru

Start-Sleep -Seconds 2

try {
    # Get the WebSocket target
    $targets = Invoke-RestMethod -Uri $url
    $pageTarget = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
    
    if (-not $pageTarget) {
        Write-Output "No page target found."
        exit
    }

    Write-Output "Found target: $($pageTarget.webSocketDebuggerUrl)"

    # We need a websocket client to connect. Since PowerShell doesn't have a built-in one that's easy to use synchronously without C# code, let's just compile a quick C# WS client.
} finally {
    Stop-Process -Id $process.Id -Force
}
