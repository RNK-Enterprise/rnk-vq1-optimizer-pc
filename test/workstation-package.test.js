/**
 * Workstation package tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildWorkstationPackagePlan, isEntrypoint, materializeWorkstationPackage, packageWorkstation, parseWorkstationPackageArgs, renderWorkstationLauncher, renderWorkstationNetworkMonitorLauncher, renderWorkstationStewardLauncher, renderWorkstationStorageGuardLauncher, renderWorkstationTrayLauncher, runIfEntrypoint, runWorkstationPackage, setExitCode, verifyWorkstationPackage, WORKSTATION_PACKAGE_VERSION, WORKSTATION_RUNTIME_INSTALL_COMMAND } from '../scripts/workstation-package.js';

describe('workstation package boundary', () => {
  test('plans only supported platforms and bounded source files', () => {
    const base = { sourceRoot: '/repo', outputRoot: '/tmp/package', version: '3.1.1' };
    expect(buildWorkstationPackagePlan({ ...base, platform: 'linux' })).toMatchObject({ version: WORKSTATION_PACKAGE_VERSION, state: 'review-ready', runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, launcher: 'rnk-optimizer-dashboard', stewardLauncher: 'rnk-optimizer-steward', trayLauncher: 'rnk-optimizer-tray', storageGuardLauncher: 'rnk-optimizer-storage-guard', networkMonitorLauncher: 'rnk-optimizer-network-monitor' });
    expect(buildWorkstationPackagePlan({ ...base, platform: 'win32' })).toMatchObject({ state: 'review-ready', launcher: 'rnk-optimizer-dashboard.cmd', stewardLauncher: 'rnk-optimizer-steward.cmd', trayLauncher: 'rnk-optimizer-tray.cmd', storageGuardLauncher: 'rnk-optimizer-storage-guard.cmd', networkMonitorLauncher: 'rnk-optimizer-network-monitor.cmd' });
    expect(buildWorkstationPackagePlan({ ...base, platform: 'darwin' })).toMatchObject({ state: 'review-ready', stewardLauncher: 'rnk-optimizer-steward', trayLauncher: 'rnk-optimizer-tray', storageGuardLauncher: 'rnk-optimizer-storage-guard', networkMonitorLauncher: 'rnk-optimizer-network-monitor' });
    expect(buildWorkstationPackagePlan({ ...base, platform: 'freebsd' })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildWorkstationPackagePlan()).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationPackagePlan({ ...base, sourceRoot: 'relative' })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationPackagePlan({ ...base, outputRoot: '/repo' })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationPackagePlan({ ...base, outputRoot: '/repo/out' })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationPackagePlan({ ...base, version: 'latest' })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationPackagePlan({ ...base, platform: null })).toMatchObject({ state: 'unsupported-platform', platform: 'unknown' });
    const rawPaths = { isAbsolute: (value) => value.startsWith('/'), resolve: (value) => value, sep: '/' };
    expect(buildWorkstationPackagePlan({ ...base, sourceRoot: '/repo/', pathImpl: rawPaths })).toMatchObject({ state: 'review-ready' });
  });

  test('renders shell-safe platform launchers and validates options', () => {
    expect(renderWorkstationLauncher('win32')).toContain('native\\cli.mjs');
    expect(renderWorkstationLauncher('win32')).toContain('--packaged');
    expect(renderWorkstationLauncher('linux')).toContain('RNK_NODE');
    expect(renderWorkstationLauncher('linux')).toContain('--packaged');
    expect(renderWorkstationLauncher('darwin')).toContain('steward-dashboard --packaged');
    expect(renderWorkstationStewardLauncher('linux')).toContain('steward-daemon --packaged');
    expect(renderWorkstationStewardLauncher('darwin')).toContain('steward-daemon --packaged');
    expect(renderWorkstationStewardLauncher('win32')).toContain('steward-daemon --packaged');
    expect(() => renderWorkstationStewardLauncher('freebsd')).toThrow('unsupported');
    expect(renderWorkstationTrayLauncher('linux')).toContain('steward-tray --packaged --confirm');
    expect(renderWorkstationTrayLauncher('darwin')).toContain('steward-tray --packaged --confirm');
    expect(renderWorkstationTrayLauncher('win32')).toContain('steward-tray --packaged --confirm');
    expect(() => renderWorkstationTrayLauncher('freebsd')).toThrow('unsupported');
    expect(renderWorkstationStorageGuardLauncher('linux')).toContain('storage-monitor --packaged');
    expect(renderWorkstationStorageGuardLauncher('darwin')).toContain('--target-free-gb 5');
    expect(renderWorkstationStorageGuardLauncher('win32')).toContain('storage-monitor --packaged');
    expect(() => renderWorkstationStorageGuardLauncher('freebsd')).toThrow('unsupported');
    expect(renderWorkstationNetworkMonitorLauncher('win32')).toContain('network-monitor --interval-seconds 5');
    expect(renderWorkstationNetworkMonitorLauncher('linux')).toContain('network-monitor --interval-seconds 5');
    expect(renderWorkstationNetworkMonitorLauncher('darwin')).toContain('network-monitor --interval-seconds 5');
    expect(() => renderWorkstationNetworkMonitorLauncher('freebsd')).toThrow('unsupported');
    expect(() => renderWorkstationLauncher('freebsd')).toThrow('unsupported');
    expect(parseWorkstationPackageArgs(['--platform', 'linux', '--source', '/repo', '--output', '/tmp/out', '--version', '3.1.1', '--dry-run'])).toMatchObject({ platform: 'linux', dryRun: true });
    expect(() => parseWorkstationPackageArgs([])).toThrow('--output');
    expect(() => parseWorkstationPackageArgs()).toThrow('--output');
    expect(() => parseWorkstationPackageArgs(['--output', '/tmp/out'])).toThrow('--version');
    expect(() => parseWorkstationPackageArgs(['--output', '/tmp/out', '--version', '3.1.1', '--bad'])).toThrow('unknown');
    expect(() => parseWorkstationPackageArgs(['--output', '/tmp/out', '--version', '3.1.1', '--platform'])).toThrow('requires');
    expect(parseWorkstationPackageArgs(['--verify', '--source', '/tmp/bundle'])).toMatchObject({ verify: true, sourceRoot: '/tmp/bundle' });
  });

  test('materializes a runtime package and refuses invalid plans', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-package-source-'));
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-package-output-'));
    for (const entry of ['native', 'pc']) await fs.mkdir(path.join(source, entry), { recursive: true });
    await fs.writeFile(path.join(source, 'native', 'cli.mjs'), 'native-runtime');
    await fs.mkdir(path.join(source, 'pc', 'engine'), { recursive: true });
    await fs.writeFile(path.join(source, 'pc', 'engine', 'index.js'), 'pc-runtime');
    for (const entry of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE', 'SECURITY_REVIEW.md', 'STATUS.md']) await fs.writeFile(path.join(source, entry), entry);
    const plan = buildWorkstationPackagePlan({ platform: 'linux', sourceRoot: source, outputRoot: path.join(output, 'bundle'), version: '3.1.1' });
    await expect(materializeWorkstationPackage({})).resolves.toMatchObject({ state: 'refused' });
    await expect(materializeWorkstationPackage(plan)).resolves.toMatchObject({ state: 'written', written: true });
    await expect(fs.readFile(path.join(output, 'bundle', 'rnk-optimizer-dashboard'), 'utf8')).resolves.toContain('steward-dashboard');
    await expect(fs.readFile(path.join(output, 'bundle', 'rnk-optimizer-steward'), 'utf8')).resolves.toContain('steward-daemon');
    await expect(fs.readFile(path.join(output, 'bundle', 'rnk-optimizer-tray'), 'utf8')).resolves.toContain('steward-tray');
    await expect(fs.readFile(path.join(output, 'bundle', 'rnk-optimizer-storage-guard'), 'utf8')).resolves.toContain('storage-monitor');
    await expect(fs.readFile(path.join(output, 'bundle', 'rnk-optimizer-network-monitor'), 'utf8')).resolves.toContain('network-monitor');
    await expect(fs.readFile(path.join(output, 'bundle', 'package-manifest.json'), 'utf8')).resolves.toContain('3.1.1');
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'bundle', 'package-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND });
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'native/cli.mjs', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }), expect.objectContaining({ path: 'rnk-optimizer-dashboard', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }), expect.objectContaining({ path: 'rnk-optimizer-steward', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }), expect.objectContaining({ path: 'rnk-optimizer-tray', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }), expect.objectContaining({ path: 'rnk-optimizer-storage-guard', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'verified', fileCount: manifest.files.length });
    await expect(runWorkstationPackage({ argv: ['--verify', '--source', path.join(output, 'bundle')], write: jest.fn(), errorWrite: jest.fn() })).resolves.toBe(0);
    await fs.writeFile(path.join(output, 'bundle', 'native', 'cli.mjs'), 'tampered');
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'mismatch', path: 'native/cli.mjs' });
    await fs.writeFile(path.join(output, 'bundle', 'native', 'cli.mjs'), 'native-runtime');
    await fs.writeFile(path.join(output, 'bundle', 'extra.txt'), 'extra');
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'mismatch', reason: expect.stringContaining('file set') });
    await expect(verifyWorkstationPackage({ root: 'relative' })).resolves.toMatchObject({ state: 'invalid-input' });
    await expect(verifyWorkstationPackage({ root: path.join(output, 'missing') })).resolves.toMatchObject({ state: 'invalid-manifest' });
    await expect(verifyWorkstationPackage()).resolves.toMatchObject({ state: 'invalid-input' });
    await fs.writeFile(path.join(output, 'bundle', 'package-manifest.json'), JSON.stringify({ packageVersion: WORKSTATION_PACKAGE_VERSION, runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, files: [] }));
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'invalid-manifest', reason: expect.stringContaining('shape') });
    await fs.writeFile(path.join(output, 'bundle', 'package-manifest.json'), JSON.stringify({ packageVersion: WORKSTATION_PACKAGE_VERSION, runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, files: [{ path: '../outside', sha256: 'a'.repeat(64) }] }));
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'invalid-manifest', reason: expect.stringContaining('unsafe') });
    await fs.writeFile(path.join(output, 'bundle', 'package-manifest.json'), JSON.stringify({ packageVersion: WORKSTATION_PACKAGE_VERSION, runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, files: [{ path: 'C:\\outside', sha256: 'a'.repeat(64) }] }));
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'invalid-manifest', reason: expect.stringContaining('unsafe') });
    await fs.writeFile(path.join(output, 'bundle', 'package-manifest.json'), JSON.stringify({ packageVersion: WORKSTATION_PACKAGE_VERSION, runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, files: [{ path: 'native/cli.mjs', sha256: 'a'.repeat(64) }, { path: 'native/cli.mjs', sha256: 'a'.repeat(64) }] }));
    await expect(verifyWorkstationPackage({ root: path.join(output, 'bundle') })).resolves.toMatchObject({ state: 'invalid-manifest', reason: expect.stringContaining('duplicate') });
    const invalidEntryFs = { readFile: jest.fn(async () => JSON.stringify({ packageVersion: WORKSTATION_PACKAGE_VERSION, runtimeInstallCommand: WORKSTATION_RUNTIME_INSTALL_COMMAND, files: [{ path: 'socket', sha256: 'a'.repeat(64) }] })), readdir: jest.fn(async () => [{ name: 'socket', isDirectory: () => false, isFile: () => false }]) };
    await expect(verifyWorkstationPackage({ root: '/tmp/bundle', fsImpl: invalidEntryFs })).resolves.toMatchObject({ state: 'unavailable', reason: expect.stringContaining('unsupported') });
    const windowsPlan = buildWorkstationPackagePlan({ platform: 'win32', sourceRoot: source, outputRoot: path.join(output, 'windows'), version: '3.1.1' });
    await expect(materializeWorkstationPackage(windowsPlan)).resolves.toMatchObject({ state: 'written', launcherPath: path.join(output, 'windows', 'rnk-optimizer-dashboard.cmd'), stewardLauncherPath: path.join(output, 'windows', 'rnk-optimizer-steward.cmd'), trayLauncherPath: path.join(output, 'windows', 'rnk-optimizer-tray.cmd'), storageGuardLauncherPath: path.join(output, 'windows', 'rnk-optimizer-storage-guard.cmd'), networkMonitorLauncherPath: path.join(output, 'windows', 'rnk-optimizer-network-monitor.cmd') });
    const fakeFs = { mkdir: jest.fn(), cp: jest.fn(), writeFile: jest.fn(), chmod: jest.fn(), readdir: jest.fn(async () => [{ name: 'socket', isDirectory: () => false, isFile: () => false }]) };
    await expect(materializeWorkstationPackage(plan, { fsImpl: fakeFs })).rejects.toThrow('unsupported package entry');
    await expect(packageWorkstation({ options: { platform: 'linux', sourceRoot: source, outputRoot: path.join(output, 'dry-run'), version: '3.1.1', dryRun: true } })).resolves.toMatchObject({ state: 'review-ready' });
    await expect(packageWorkstation({ options: { platform: 'linux', sourceRoot: source, outputRoot: path.join(output, 'built'), version: '3.1.1' } })).resolves.toMatchObject({ state: 'written' });
    await expect(packageWorkstation({ options: {} })).resolves.toMatchObject({ state: 'invalid-input' });
    await expect(packageWorkstation({})).resolves.toMatchObject({ state: 'invalid-input' });
    await expect(packageWorkstation()).resolves.toMatchObject({ state: 'invalid-input' });
  });

  test('adapts command output and exit codes', async () => {
    const write = jest.fn();
    const errorWrite = jest.fn();
    const options = ['--output', '/tmp/out', '--version', '3.1.1'];
    await expect(runWorkstationPackage({ argv: options, write, packageImpl: async () => ({ state: 'written' }) })).resolves.toBe(0);
    await expect(runWorkstationPackage({ argv: options, packageImpl: async () => ({ state: 'review-ready' }) })).resolves.toBe(0);
    await expect(runWorkstationPackage({ argv: options, packageImpl: async () => ({ state: 'refused' }) })).resolves.toBe(1);
    await expect(runWorkstationPackage({ argv: ['--verify', '--source', '/tmp/missing'], write, errorWrite })).resolves.toBe(1);
    await expect(runWorkstationPackage({ argv: ['--bad'], errorWrite })).resolves.toBe(1);
    expect(write).toHaveBeenCalled();
    expect(errorWrite).toHaveBeenCalledWith(expect.stringContaining('unknown package option'));
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runWorkstationPackage()).resolves.toBe(1);
    await expect(runIfEntrypoint({ entrypoint: true })).resolves.toBe(1);
    stderr.mockRestore();
    const target = {};
    expect(setExitCode(0, target)).toBe(0);
    expect(setExitCode(2, target)).toBe(2);
    expect(target.exitCode).toBe(2);
    expect(isEntrypoint('file:///tmp/package.js', '')).toBe(false);
    expect(isEntrypoint(pathToFileURL('/tmp/package.js').href, '/tmp/package.js')).toBe(true);
    await expect(runIfEntrypoint({ entrypoint: false, run: jest.fn() })).resolves.toBe(0);
    await expect(runIfEntrypoint({ entrypoint: true, run: jest.fn().mockResolvedValue(3) })).resolves.toBe(3);
    await expect(runIfEntrypoint()).resolves.toBe(0);
  });
});
