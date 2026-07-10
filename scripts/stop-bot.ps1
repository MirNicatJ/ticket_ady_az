$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'npm-cli\.js" start|node\s+src/index\.js' }

if (-not $processes) {
  Write-Output "No ADY bot process found."
  exit 0
}

$ids = @($processes.ProcessId)
Write-Output ("Stopping: " + ($ids -join ", "))
Stop-Process -Id $ids -Force
