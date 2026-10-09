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
  [string]$InstallDirectory = "$env:LOCALAPPDATA\RNK-Vortex-Optimizer",
  [string]$Ref = '',
  [switch]$RunOptimize,
  [string]$GatewayUrl = $env:OPTIMIZER_GATEWAY_URL,
  [string]$EnvironmentMode = '',
  [UInt64]$MinimumFreeBytes = 5368709120
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
if ($MinimumFreeBytes -lt 0) { throw 'MinimumFreeBytes must be non-negative' }
if ([string]::IsNullOrWhiteSpace($Ref) -or ($Ref -notmatch '^v\d+\.\d+\.\d+$' -and $Ref -notmatch '^[0-9a-fA-F]{40}$')) {
  throw 'Ref is required and must be a release tag (vX.Y.Z) or a full 40-character commit SHA'
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

$installRoot = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($InstallDirectory))
$drive = [IO.DriveInfo]::new($installRoot)
if (-not $drive.IsReady -or $drive.AvailableFreeSpace -lt $MinimumFreeBytes) {
  throw "insufficient free space at ${installRoot}: $($drive.AvailableFreeSpace) bytes available, $MinimumFreeBytes required"
}

if (Test-Path (Join-Path $InstallDirectory '.git')) {
  if ((git -C $InstallDirectory config --get remote.origin.url) -ne 'https://github.com/RNK-Enterprise/rnk-vq1-optimizer-pc.git') {
    throw 'existing install has a different origin; refusing to cross repository boundaries'
  }
  if ((git -C $InstallDirectory status --porcelain)) {
    throw 'existing install has uncommitted changes; refusing to overwrite it'
  }
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDirectory) | Out-Null
  git clone --no-checkout 'https://github.com/RNK-Enterprise/rnk-vq1-optimizer-pc.git' $InstallDirectory
}

if ($Ref -match '^[0-9a-fA-F]{40}$') {
  git -C $InstallDirectory fetch --no-tags origin $Ref
  git -C $InstallDirectory checkout --detach $Ref
} else {
  git -C $InstallDirectory fetch origin "refs/tags/${Ref}:refs/tags/${Ref}"
  if ((git -C $InstallDirectory cat-file -t $Ref) -ne 'tag') { throw 'Ref is not an annotated tag' }
  git -C $InstallDirectory verify-tag $Ref | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'release tag signature could not be verified' }
  git -C $InstallDirectory checkout --detach "${Ref}^{commit}"
}

$resolvedCommit = (git -C $InstallDirectory rev-parse HEAD).Trim()
if ($Ref -match '^[0-9a-fA-F]{40}$' -and $resolvedCommit -ne $Ref) {
  throw 'resolved commit does not match requested SHA'
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
Write-Host "Installed in $InstallDirectory ($EnvironmentMode mode, commit $resolvedCommit)."
