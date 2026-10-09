/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform user-data paths for packaged workstation sessions. The
 * resolver never falls back to the package directory or a system directory.
 */

import path from 'path';

export const WORKSTATION_PATHS_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }

function baseRoot(platform, env, pathImpl) {
  const home = text(env?.HOME);
  const roots = {
    win32: [text(env?.LOCALAPPDATA), text(env?.APPDATA)],
    linux: [text(env?.XDG_STATE_HOME), home ? pathImpl.join(home, '.local', 'state') : null],
    darwin: [home ? pathImpl.join(home, 'Library', 'Application Support') : null]
  };
  return roots[platform].find(Boolean) || null;
}

function platformPath(platform, pathImpl) {
  if (pathImpl) return pathImpl;
  return platform === 'win32' ? path.win32 : path.posix;
}

export function defaultWorkstationPaths({ platform = process.platform, env = process.env, pathImpl } = {}) {
  const normalizedPlatform = text(platform)?.toLowerCase() || 'unknown';
  if (!['win32', 'linux', 'darwin'].includes(normalizedPlatform)) {
    return Object.freeze({ version: WORKSTATION_PATHS_VERSION, state: 'unsupported-platform', platform: normalizedPlatform, reason: 'packaged workstation paths support Windows, Linux, and macOS' });
  }
  const selectedPath = platformPath(normalizedPlatform, pathImpl);
  const base = baseRoot(normalizedPlatform, env, selectedPath);
  if (!base || !selectedPath.isAbsolute(base)) {
    return Object.freeze({ version: WORKSTATION_PATHS_VERSION, state: 'invalid-environment', platform: normalizedPlatform, reason: 'a platform user-data root is required' });
  }
  const root = selectedPath.join(base, 'RNK', 'Optimizer');
  return Object.freeze({
    version: WORKSTATION_PATHS_VERSION,
    state: 'ready',
    platform: normalizedPlatform,
    root,
    historyPath: selectedPath.join(root, 'history.jsonl'),
    reportPath: selectedPath.join(root, 'daily-report.html'),
    protectedRootsPath: selectedPath.join(root, 'protected-roots.json')
  });
}
