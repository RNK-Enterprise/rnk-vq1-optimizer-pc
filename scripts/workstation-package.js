/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Reproducible runtime package builder. The package contains only the public
 * runtime and fixed launchers; it does not create a service, listener, or tray.
 */

import fs from 'fs/promises';
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
    launcher: launcherName(normalizedPlatform)
  });
}

export function renderWorkstationLauncher(platform) {
  const normalizedPlatform = text(platform)?.toLowerCase();
  if (!PLATFORMS.has(normalizedPlatform)) throw new Error('unsupported workstation package platform');
  if (normalizedPlatform === 'win32') return '@echo off\r\nnode "%~dp0native\\cli.mjs" steward-dashboard %*\r\n';
  return '#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "${RNK_NODE:-node}" "$SCRIPT_DIR/native/cli.mjs" steward-dashboard "$@"\n';
}

function validPlan(plan) {
  return Boolean(plan) && typeof plan === 'object' && plan.version === WORKSTATION_PACKAGE_VERSION && plan.state === 'review-ready' && Array.isArray(plan.files) && plan.files.length === RUNTIME_FILES.length;
}

export async function materializeWorkstationPackage(plan, { fsImpl = fs, pathImpl = path } = {}) {
  if (!validPlan(plan)) return Object.freeze({ state: 'refused', written: false, reason: 'workstation package plan is not ready' });
  await fsImpl.mkdir(plan.outputRoot, { recursive: true });
  for (const entry of plan.files) await fsImpl.cp(pathImpl.join(plan.sourceRoot, entry), pathImpl.join(plan.outputRoot, entry), { recursive: true, force: true });
  const launcherPath = pathImpl.join(plan.outputRoot, plan.launcher);
  await fsImpl.writeFile(launcherPath, renderWorkstationLauncher(plan.platform), 'utf8');
  if (plan.platform !== 'win32') await fsImpl.chmod(launcherPath, 0o755);
  const manifest = { packageVersion: plan.version, releaseVersion: plan.releaseVersion, platform: plan.platform, files: [...plan.files, plan.launcher] };
  await fsImpl.writeFile(pathImpl.join(plan.outputRoot, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return Object.freeze({ state: 'written', written: true, outputRoot: plan.outputRoot, launcherPath, manifest: Object.freeze(manifest) });
}

export async function packageWorkstation({ options = {}, fsImpl = fs, pathImpl = path } = {}) {
  const plan = buildWorkstationPackagePlan({ ...options, pathImpl });
  if (plan.state !== 'review-ready' || options.dryRun === true) return plan;
  return materializeWorkstationPackage(plan, { fsImpl, pathImpl });
}

export function parseWorkstationPackageArgs(argv = []) {
  const options = { platform: process.platform, sourceRoot: process.cwd(), outputRoot: null, version: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (!['--platform', '--source', '--output', '--version'].includes(arg)) throw new Error(`unknown package option: ${arg}`);
    const value = argv[index + 1];
    if (!text(value)) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === '--platform') options.platform = value;
    if (arg === '--source') options.sourceRoot = value;
    if (arg === '--output') options.outputRoot = value;
    if (arg === '--version') options.version = value;
  }
  if (!options.outputRoot) throw new Error('--output is required');
  if (!options.version) throw new Error('--version is required');
  return options;
}

export async function runWorkstationPackage({ argv = process.argv.slice(2), write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value), packageImpl = packageWorkstation } = {}) {
  try {
    const result = await packageImpl({ options: parseWorkstationPackageArgs(argv) });
    write(`${JSON.stringify(result)}\n`);
    return result.state === 'written' || result.state === 'review-ready' ? 0 : 1;
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
