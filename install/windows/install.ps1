<#
  RNK Vortex System Optimizer
  Copyright © 2026 RNK Enterprise
  Contributor: RNK Enterprise

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, version 3 of the License.

  Windows installer for the native whole-PC agent.
#>

param(
  [string]$RepositoryUrl = '',
  [string]$InstallDirectory = "$env:LOCALAPPDATA\RNK-Vortex-Optimizer",
  [switch]$RunOptimize
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required' }

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
node (Join-Path $InstallDirectory 'native\cli.mjs') facts
if ($RunOptimize) {
  node (Join-Path $InstallDirectory 'native\cli.mjs') optimize
}
