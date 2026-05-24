$text = [IO.File]::ReadAllText("C:\Users\mauri koop junior\.gemini\antigravity\scratch\barbearia_deploy\app.js")

# Remove single line comments
$text = [regex]::Replace($text, "//.*", "")

# Remove block comments
$text = [regex]::Replace($text, "/\*(?s:.*?)\*/", "")

# Remove strings
$text = [regex]::Replace($text, "'[^']*'", "")
$text = [regex]::Replace($text, "`"[^`"]*`"", "")
$text = [regex]::Replace($text, "``(?s:.*?)``", "") # Backticks

$lines = $text -split "`n"
$stack = New-Object System.Collections.Generic.Stack[string]

for ($i = 0; $i -lt $lines.Length; $i++) {
    $line = $lines[$i]
    foreach ($char in $line.ToCharArray()) {
        if ($char -eq '{') { $stack.Push("{:$($i+1)") }
        elseif ($char -eq '(') { $stack.Push("(:$($i+1)") }
        elseif ($char -eq '[') { $stack.Push("[:$($i+1)") }
        elseif ($char -eq '}') {
            if ($stack.Count -gt 0 -and $stack.Peek().StartsWith("{")) { $null = $stack.Pop() }
            else { Write-Output "Unexpected } at line $($i+1)" }
        }
        elseif ($char -eq ')') {
            if ($stack.Count -gt 0 -and $stack.Peek().StartsWith("(")) { $null = $stack.Pop() }
            else { Write-Output "Unexpected ) at line $($i+1)" }
        }
        elseif ($char -eq ']') {
            if ($stack.Count -gt 0 -and $stack.Peek().StartsWith("[")) { $null = $stack.Pop() }
            else { Write-Output "Unexpected ] at line $($i+1)" }
        }
    }
}

if ($stack.Count -gt 0) {
    Write-Output "Unclosed brackets found:"
    foreach ($item in $stack) {
        Write-Output $item
    }
} else {
    Write-Output "Perfectly balanced"
}
