$path = "C:\Users\mauri koop junior\.gemini\antigravity\brain\2601fc49-a0cb-42f2-ac34-0bc2968a25f7\.system_generated\logs\transcript.jsonl"
$outPath = "C:\Users\mauri koop junior\.gemini\antigravity\scratch\barbearia_deploy\app_recovered.js"

$reader = [System.IO.File]::OpenText($path)
$latestContent = $null

while ($null -ne ($line = $reader.ReadLine())) {
    if ($line.Contains("app.js") -and $line.Contains("write_to_file")) {
        try {
            $obj = $line | ConvertFrom-Json
            if ($obj.tool_calls) {
                foreach ($call in $obj.tool_calls) {
                    if ($call.name -eq "default_api:write_to_file" -or $call.name -eq "write_to_file") {
                        $args = $call.arguments | ConvertFrom-Json
                        if ($args.TargetFile -and $args.TargetFile.EndsWith("app.js")) {
                            $latestContent = $args.CodeContent
                        }
                    }
                }
            }
        } catch {
            # Ignore parsing errors
        }
    }
}
$reader.Close()

if ($latestContent) {
    [System.IO.File]::WriteAllText($outPath, $latestContent)
    Write-Host "Successfully extracted app.js"
} else {
    Write-Host "Could not find app.js content in transcript."
}
