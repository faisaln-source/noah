param([switch]$AppWindow)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer, then open Start ClipForge.cmd again.' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Could not install JavaScript dependencies.' }
}
$isRunning = $false
try { $response = Invoke-RestMethod 'http://127.0.0.1:3000/api/stats' -TimeoutSec 2; $isRunning = $null -ne $response.imported } catch { }
if (-not $isRunning) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'The application build failed.' }
  New-Item -ItemType Directory -Force -Path 'data' | Out-Null
  Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/server-error.log')
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { Invoke-RestMethod 'http://127.0.0.1:3000/api/stats' -TimeoutSec 2 | Out-Null; $isRunning = $true; break } catch { Start-Sleep -Milliseconds 500 }
  }
}
if (-not $isRunning) { throw 'ClipForge could not start. Check data/server-error.log.' }
if ($AppWindow) {
  $edgePaths = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe'))
  $edge = $edgePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($edge) { Start-Process -FilePath $edge -ArgumentList '--app=http://127.0.0.1:3000' } else { Start-Process 'http://127.0.0.1:3000' }
} else { Start-Process 'http://127.0.0.1:3000' }
