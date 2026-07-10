$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

Write-Output "Active bot processes:"
$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'npm-cli\.js" start|node\s+src/index\.js' } |
  Select-Object ProcessId, CommandLine

if ($processes) {
  $processes | Format-Table -AutoSize
} else {
  Write-Output "No ADY bot process found."
}

Write-Output ""
Write-Output "Last log lines:"
if (Test-Path -LiteralPath "bot.log") {
  Get-Content -LiteralPath "bot.log" -Tail 40
} else {
  Write-Output "No bot.log found yet."
}
