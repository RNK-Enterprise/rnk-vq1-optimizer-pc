/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Explicit storage-pressure category and protection boundaries. These
 * definitions are local policy; they are never accepted from a VQ payload.
 */

import path from 'path';

export const STORAGE_CATEGORY_IDS = Object.freeze([
  'temporary-files',
  'package-cache',
  'browser-automation-cache',
  'gpu-shader-cache',
  'windows-update-download',
  'abandoned-runtime-remnants'
]);

export const STORAGE_CATEGORY_POLICIES = Object.freeze({
  'temporary-files': Object.freeze({ safeByDefault: true, requiresAdmin: false }),
  'package-cache': Object.freeze({ safeByDefault: true, requiresAdmin: false }),
  'browser-automation-cache': Object.freeze({ safeByDefault: true, requiresAdmin: false }),
  'gpu-shader-cache': Object.freeze({ safeByDefault: true, requiresAdmin: false }),
  'windows-update-download': Object.freeze({ safeByDefault: false, requiresAdmin: true }),
  'abandoned-runtime-remnants': Object.freeze({ safeByDefault: false, requiresAdmin: false })
});

const PROTECTED_BASENAMES = new Set(['pagefile.sys', 'hiberfil.sys', 'swapfile.sys']);

function strings(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.length > 0) : [];
}

function uniquePaths(values, pathImpl) {
  return [...new Set(strings(values).map((value) => pathImpl.resolve(value)))];
}

function joinIf(value, pathImpl, ...parts) {
  return typeof value === 'string' && value.length > 0 ? pathImpl.join(value, ...parts) : null;
}

export function resolveStorageCategoryRoots({
  platform = process.platform,
  env = process.env,
  pathImpl = path,
  abandonedRuntimeRoots = []
} = {}) {
  const user = env.USERPROFILE || env.HOME || null;
  const local = env.LOCALAPPDATA || null;
  const systemRoot = env.SystemRoot || env.WINDIR || (platform === 'win32' ? 'C:\\Windows' : null);
  const roots = {
    'temporary-files': [env.TEMP, env.TMP, joinIf(local, pathImpl, 'Temp')],
    'package-cache': [
      env.NPM_CONFIG_CACHE,
      joinIf(local, pathImpl, 'npm-cache'),
      joinIf(user, pathImpl, '.npm')
    ],
    'browser-automation-cache': [
      joinIf(local, pathImpl, 'puppeteer', 'Cache'),
      joinIf(user, pathImpl, '.cache', 'puppeteer'),
      joinIf(local, pathImpl, 'selenium'),
      joinIf(user, pathImpl, '.cache', 'selenium')
    ],
    'gpu-shader-cache': [
      joinIf(local, pathImpl, 'D3DSCache'),
      joinIf(local, pathImpl, 'NVIDIA', 'DXCache'),
      joinIf(local, pathImpl, 'NVIDIA', 'GLCache'),
      joinIf(user, pathImpl, '.cache', 'mesa_shader_cache'),
      joinIf(user, pathImpl, '.cache', 'nvidia', 'GLCache')
    ],
    'windows-update-download': platform === 'win32'
      ? [joinIf(systemRoot, pathImpl, 'SoftwareDistribution', 'Download')]
      : [],
    'abandoned-runtime-remnants': abandonedRuntimeRoots
  };
  return Object.fromEntries(STORAGE_CATEGORY_IDS.map((id) => [id, uniquePaths(roots[id], pathImpl)]));
}

export function defaultProtectedStorageRoots({
  platform = process.platform,
  env = process.env,
  pathImpl = path
} = {}) {
  const user = env.USERPROFILE || env.HOME || null;
  const local = env.LOCALAPPDATA || null;
  return uniquePaths([
    joinIf(user, pathImpl, 'Desktop'),
    joinIf(user, pathImpl, 'Documents'),
    joinIf(user, pathImpl, 'Downloads'),
    joinIf(user, pathImpl, 'OneDrive'),
    joinIf(user, pathImpl, '.ssh'),
    joinIf(user, pathImpl, '.aws'),
    joinIf(user, pathImpl, '.azure'),
    joinIf(user, pathImpl, '.config'),
    joinIf(user, pathImpl, '.ollama'),
    joinIf(user, pathImpl, '.cache', 'huggingface'),
    joinIf(local, pathImpl, 'Packages'),
    joinIf(local, pathImpl, 'Ollama'),
    joinIf(local, pathImpl, 'LM Studio'),
    joinIf(local, pathImpl, 'Programs'),
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ACTIVE_RUNTIME_ROOT,
    env.CODEX_RUNTIME_ROOT,
    env.OPENCODE_RUNTIME_ROOT,
    env.RUNTIMES_ROOT,
    env.PROJECTS_ROOT,
    env.MODELS_ROOT,
    env.CREDENTIALS_ROOT,
    env.WSL_DATA_ROOT,
    platform === 'win32' ? joinIf(env.SystemRoot || env.WINDIR, pathImpl, 'System32') : null
  ], pathImpl);
}

export function resolveProtectedStorageRoots({
  platform = process.platform,
  env = process.env,
  pathImpl = path,
  protectedRoots = []
} = {}) {
  return uniquePaths([
    ...defaultProtectedStorageRoots({ platform, env, pathImpl }),
    ...protectedRoots
  ], pathImpl);
}

export function isPathInside(root, candidate, pathImpl = path) {
  if (typeof root !== 'string' || typeof candidate !== 'string') return false;
  const resolvedRoot = pathImpl.resolve(root);
  const resolvedCandidate = pathImpl.resolve(candidate);
  const relative = pathImpl.relative(resolvedRoot, resolvedCandidate);
  return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative);
}

export function isProtectedStoragePath(candidate, protectedRoots = [], pathImpl = path) {
  if (typeof candidate !== 'string' || candidate.length === 0) return true;
  const basename = pathImpl.basename(candidate).toLowerCase();
  if (PROTECTED_BASENAMES.has(basename)) return true;
  return protectedRoots.some((root) => pathImpl.resolve(root) === pathImpl.resolve(candidate)
    || isPathInside(root, candidate, pathImpl));
}

export function categoryPolicy(category) {
  return STORAGE_CATEGORY_POLICIES[category] || null;
}
