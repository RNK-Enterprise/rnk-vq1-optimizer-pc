/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Reproducible runtime package builder. The package contains only the public
 * runtime and fixed launchers; it does not create a service, listener, or tray.
 */

import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';

export const WORKSTATION_PACKAGE_VERSION = 1;
const PLATFORMS = new Set(['win32', 'linux', 'darwin']);
const RUNTIME_FILES = Object.freeze([
  'native',
  'pc',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'SECURITY_REVIEW.md',
  'STATUS.md'
]);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function absolute(value, pathImpl) { const resolved = text(value); return resolved && pathImpl.isAbsolute(resolved) ? pathImpl.resolve(resolved) : null; }
function validVersion(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value); }
function launcherName(platform) { return platform === 'win32' ? 'rnk-optimizer-dashboard.cmd' : 'rnk-optimizer-dashboard'; }
function stewardLauncherName(platform) { return platform === 'win32' ? 'rnk-optimizer-steward.cmd' : 'rnk-optimizer-steward'; }
function trayLauncherName(platform) { return platform === 'win32' ? 'rnk-optimizer-tray.cmd' : 'rnk-optimizer-tray'; }

export function buildWorkstationPackagePlan({ platform = process.platform, sourceRoot, outputRoot, version, pathImpl = path } = {}) {
  const normalizedPlatform = text(platform)?.toLowerCase() || 'unknown';
  const source = absolute(sourceRoot, pathImpl);
  const output = absolute(outputRoot, pathImpl);
  const base = { version: WORKSTATION_PACKAGE_VERSION, operation: 'build-workstation-package', platform: normalizedPlatform, mutation: 'write-package-files', requiresApproval: false };
  if (!PLATFORMS.has(normalizedPlatform)) return Object.freeze({ ...base, state: 'unsupported-platform', reason: 'package launchers support Windows, Linux, and macOS' });
  if (!source || !output || !validVersion(version)) return Object.freeze({ ...base, state: 'invalid-input', reason: 'absolute source/output roots and semantic version are required' });
  const sourcePrefix = source.endsWith(pathImpl.sep) ? source : `${source}${pathImpl.sep}`;
  if (output === source || output.startsWith(sourcePrefix)) return Object.freeze({ ...base, state: 'invalid-input', reason: 'package output must not be the source root or inside it' });
  return Object.freeze({
    ...base,
    state: 'review-ready',
    sourceRoot: source,
    outputRoot: output,
    releaseVersion: version,
    files: RUNTIME_FILES,
    launcher: launcherName(normalizedPlatform),
    stewardLauncher: stewardLauncherName(normalizedPlatform),
    trayLauncher: trayLauncherName(normalizedPlatform)
  });
}

export function renderWorkstationLauncher(platform) {
  const normalizedPlatform = text(platform)?.toLowerCase();
  if (!PLATFORMS.has(normalizedPlatform)) throw new Error('unsupported workstation package platform');
  if (normalizedPlatform === 'win32') return '@echo off\r\nnode "%~dp0native\\cli.mjs" steward-dashboard --packaged %*\r\n';
  return '#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "${RNK_NODE:-node}" "$SCRIPT_DIR/native/cli.mjs" steward-dashboard --packaged "$@"\n';
}

export function renderWorkstationStewardLauncher(platform) {
  const normalizedPlatform = text(platform)?.toLowerCase();
  if (!PLATFORMS.has(normalizedPlatform)) throw new Error('unsupported workstation package platform');
  if (normalizedPlatform === 'win32') return '@echo off\r\nnode "%~dp0native\\cli.mjs" steward-daemon --packaged %*\r\n';
  return '#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "${RNK_NODE:-node}" "$SCRIPT_DIR/native/cli.mjs" steward-daemon --packaged "$@"\n';
}

export function renderWorkstationTrayLauncher(platform) {
  const normalizedPlatform = text(platform)?.toLowerCase();
  if (!PLATFORMS.has(normalizedPlatform)) throw new Error('unsupported workstation package platform');
  if (normalizedPlatform === 'win32') return '@echo off\r\nnode "%~dp0native\\cli.mjs" steward-tray --packaged --confirm %*\r\n';
  return '#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "${RNK_NODE:-node}" "$SCRIPT_DIR/native/cli.mjs" steward-tray --packaged --confirm "$@"\n';
}

function validPlan(plan) {
  return Boolean(plan) && typeof plan === 'object' && plan.version === WORKSTATION_PACKAGE_VERSION && plan.state === 'review-ready' && Array.isArray(plan.files) && plan.files.length === RUNTIME_FILES.length;
}

async function packageFileEntries(root, relativeRoot, { fsImpl, pathImpl }) {
  const entries = (await fsImpl.readdir(pathImpl.join(root, relativeRoot), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const relative = pathImpl.join(relativeRoot, entry.name);
    if (entry.isDirectory()) files.push(...await packageFileEntries(root, relative, { fsImpl, pathImpl }));
    else if (entry.isFile()) {
      const content = await fsImpl.readFile(pathImpl.join(root, relative));
      files.push(Object.freeze({ path: relative.split(pathImpl.sep).join('/'), sha256: createHash('sha256').update(content).digest('hex') }));
    } else throw new Error(`unsupported package entry: ${relative}`);
  }
  return files;
}

export async function materializeWorkstationPackage(plan, { fsImpl = fs, pathImpl = path } = {}) {
  if (!validPlan(plan)) return Object.freeze({ state: 'refused', written: false, reason: 'workstation package plan is not ready' });
  await fsImpl.mkdir(plan.outputRoot, { recursive: true });
  for (const entry of plan.files) await fsImpl.cp(pathImpl.join(plan.sourceRoot, entry), pathImpl.join(plan.outputRoot, entry), { recursive: true, force: true });
  const launcherPath = pathImpl.join(plan.outputRoot, plan.launcher);
  const stewardLauncherPath = pathImpl.join(plan.outputRoot, plan.stewardLauncher);
  const trayLauncherPath = pathImpl.join(plan.outputRoot, plan.trayLauncher);
  await fsImpl.writeFile(launcherPath, renderWorkstationLauncher(plan.platform), 'utf8');
  await fsImpl.writeFile(stewardLauncherPath, renderWorkstationStewardLauncher(plan.platform), 'utf8');
  await fsImpl.writeFile(trayLauncherPath, renderWorkstationTrayLauncher(plan.platform), 'utf8');
  if (plan.platform !== 'win32') await fsImpl.chmod(launcherPath, 0o755);
  if (plan.platform !== 'win32') await fsImpl.chmod(stewardLauncherPath, 0o755);
  if (plan.platform !== 'win32') await fsImpl.chmod(trayLauncherPath, 0o755);
  const files = await packageFileEntries(plan.outputRoot, '.', { fsImpl, pathImpl });
  const manifest = { packageVersion: plan.version, releaseVersion: plan.releaseVersion, platform: plan.platform, files };
  await fsImpl.writeFile(pathImpl.join(plan.outputRoot, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return Object.freeze({ state: 'written', written: true, outputRoot: plan.outputRoot, launcherPath, stewardLauncherPath, trayLauncherPath, manifest: Object.freeze(manifest) });
}

function safeManifestPath(value, pathImpl) {
  const raw = text(value);
  if (!raw || raw.includes('\0') || pathImpl.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return null;
  const parts = raw.split(/[\\/]+/);
  if (parts.includes('..') || parts.some((part) => !part || part === '.')) return null;
  return parts.join('/');
}

export async function verifyWorkstationPackage({ root, manifestPath, fsImpl = fs, pathImpl = path } = {}) {
  const packageRoot = absolute(root, pathImpl);
  if (!packageRoot) return Object.freeze({ state: 'invalid-input', verified: false, reason: 'absolute package root is required' });
  const manifestFile = absolute(manifestPath, pathImpl) || pathImpl.join(packageRoot, 'package-manifest.json');
  let manifest;
  try { manifest = JSON.parse(await fsImpl.readFile(manifestFile, 'utf8')); } catch { return Object.freeze({ state: 'invalid-manifest', verified: false, reason: 'package manifest could not be read' }); }
  if (manifest?.packageVersion !== WORKSTATION_PACKAGE_VERSION || !Array.isArray(manifest.files) || manifest.files.length === 0) return Object.freeze({ state: 'invalid-manifest', verified: false, reason: 'package manifest shape is invalid' });
  const expected = [];
  for (const item of manifest.files) {
    const relative = safeManifestPath(item?.path, pathImpl);
    if (!relative || typeof item?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return Object.freeze({ state: 'invalid-manifest', verified: false, reason: 'package manifest contains an unsafe or invalid entry' });
    expected.push({ path: relative, sha256: item.sha256 });
  }
  if (new Set(expected.map((item) => item.path)).size !== expected.length) return Object.freeze({ state: 'invalid-manifest', verified: false, reason: 'package manifest contains duplicate entries' });
  let actual;
  try { actual = (await packageFileEntries(packageRoot, '.', { fsImpl, pathImpl })).filter((item) => item.path !== 'package-manifest.json'); } catch (error) { return Object.freeze({ state: 'unavailable', verified: false, reason: error.message }); }
  const actualMap = new Map(actual.map((item) => [item.path, item.sha256]));
  if (actual.length !== expected.length || expected.some((item) => !actualMap.has(item.path))) return Object.freeze({ state: 'mismatch', verified: false, reason: 'package file set differs from the manifest' });
  const mismatch = expected.find((item) => actualMap.get(item.path) !== item.sha256);
  if (mismatch) return Object.freeze({ state: 'mismatch', verified: false, path: mismatch.path, reason: 'package file hash differs from the manifest' });
  return Object.freeze({ state: 'verified', verified: true, fileCount: expected.length });
}

export async function packageWorkstation({ options = {}, fsImpl = fs, pathImpl = path } = {}) {
  const plan = buildWorkstationPackagePlan({ ...options, pathImpl });
  if (plan.state !== 'review-ready' || options.dryRun === true) return plan;
  return materializeWorkstationPackage(plan, { fsImpl, pathImpl });
}

export function parseWorkstationPackageArgs(argv = []) {
  const options = { platform: process.platform, sourceRoot: process.cwd(), outputRoot: null, version: null, dryRun: false, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--verify') { options.verify = true; continue; }
    if (!['--platform', '--source', '--output', '--version'].includes(arg)) throw new Error(`unknown package option: ${arg}`);
    const value = argv[index + 1];
    if (!text(value)) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === '--platform') options.platform = value;
    if (arg === '--source') options.sourceRoot = value;
    if (arg === '--output') options.outputRoot = value;
    if (arg === '--version') options.version = value;
  }
  if (options.verify) return options;
  if (!options.outputRoot) throw new Error('--output is required');
  if (!options.version) throw new Error('--version is required');
  return options;
}

export async function runWorkstationPackage({ argv = process.argv.slice(2), write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value), packageImpl = packageWorkstation } = {}) {
  try {
    const options = parseWorkstationPackageArgs(argv);
    const result = options.verify ? await verifyWorkstationPackage({ root: options.sourceRoot }) : await packageImpl({ options });
    write(`${JSON.stringify(result)}\n`);
    return ['written', 'review-ready', 'verified'].includes(result.state) ? 0 : 1;
  } catch (error) {
    errorWrite(`${error.message}\n`);
    return 1;
  }
}

export function isEntrypoint(moduleUrl, executablePath) { return moduleUrl === pathToFileURL(executablePath || '').href; }
export function setExitCode(code, target = process) { if (code !== 0) target.exitCode = code; return code; }
export async function runIfEntrypoint({ entrypoint, run = runWorkstationPackage } = {}) { return entrypoint ? run() : 0; }

const entrypoint = isEntrypoint(import.meta.url, process.argv[1]);
setExitCode(await runIfEntrypoint({ entrypoint }));
