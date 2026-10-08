<#
  RNK Vortex System Optimizer
  Copyright © 2026 Lisa's Dungeon
  Contributor: Lisa's Dungeon

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, version 3 of the License.

  Windows installer for the native whole-PC agent.
#>

param(
  [string]$RepositoryUrl = 'https://github.com/RNK-Enterprise/pc-optimizer.git',
  [string]$InstallDirectory = "$env:LOCALAPPDATA\RNK-Vortex-Optimizer",
  [switch]$RunOptimize,
  [string]$GatewayUrl = $env:OPTIMIZER_GATEWAY_URL,
  [string]$EnvironmentMode = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20 or newer is required' }
$nodeMajor = [int]((node -p "process.versions.node").Split('.')[0])
if ($nodeMajor -lt 20) { throw 'Node.js 20 or newer is required' }
if ($RunOptimize -and [string]::IsNullOrWhiteSpace($GatewayUrl)) {
  throw 'RunOptimize requires -GatewayUrl or OPTIMIZER_GATEWAY_URL'
}

if ([string]::IsNullOrWhiteSpace($EnvironmentMode)) {
  if ([Console]::IsInputRedirected) { throw 'EnvironmentMode is required in non-interactive sessions' }
  $bold = "$([char]27)[1m"
  $reset = "$([char]27)[0m"
  Write-Host "$bold RNK Vortex System Optimizer installation mode is required. $reset"
  $EnvironmentMode = (Read-Host 'Choose [h]eadless or [i]nteractive').Trim().ToLowerInvariant()
}

switch ($EnvironmentMode.Trim().ToLowerInvariant()) {
  'h' { $EnvironmentMode = 'headless' }
  'headless' { $EnvironmentMode = 'headless' }
  'i' { $EnvironmentMode = 'interactive' }
  'interactive' { $EnvironmentMode = 'interactive' }
  default { throw 'EnvironmentMode must be headless or interactive' }
}

if (Test-Path (Join-Path $InstallDirectory '.git')) {
  git -C $InstallDirectory pull --ff-only
} else {
  if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) {
    throw 'RepositoryUrl is required for a fresh install'
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDirectory) | Out-Null
  git clone $RepositoryUrl $InstallDirectory
}

npm --prefix $InstallDirectory ci
$configRoot = if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
  Join-Path $env:APPDATA 'RNK-Vortex-Optimizer'
} else {
  Join-Path $env:LOCALAPPDATA 'RNK-Vortex-Optimizer'
}
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
Set-Content -LiteralPath (Join-Path $configRoot 'environment-mode') -Value $EnvironmentMode -NoNewline
node (Join-Path $InstallDirectory 'native\cli.mjs') facts
if ($RunOptimize) {
  node (Join-Path $InstallDirectory 'native\cli.mjs') optimize --gateway $GatewayUrl
}
Write-Host "Installed in $InstallDirectory ($EnvironmentMode mode)."
