/**
 * Native top-level CLI adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  agentFromArgs,
  runAssistantCommand,
  runAssistantAdapterCommand,
  runCli,
  runCliEntrypoint,
  isCliEntrypoint,
  runDriveBenchmarkCommand,
  runDriveHealthCommand,
  runFilesystemHealthCommand,
  runGpuPolicyCommand,
  runGameSessionCommand,
  runNetworkOverviewCommand,
  runNetworkRateMonitorCommand,
  runProcessRateMonitorCommand,
  runPlacementCommand,
  runPlacementPolicyCommand,
  runPlacementRecommendationCommand,
  runPowerCommand,
  runPowerMonitorCommand,
  runProcessCommand,
  runReportViewerCommand,
  runResourceLimitCommand,
  runStartupCommand,
  runVolumeStorageCommand,
  runWorkloadBudgetCommand,
  runWorkloadCommand,
  runWindowsResourceLimitCommand,
  runWorkstationPolicyCommand,
  runWorkstationShellCommand,
  runWorkstationTrayCommand
} from '../native/cli.mjs';

const facts = { platform: 'linux', processes: [] };

function interruptOnStart(callback = async () => {}) {
  setImmediate(async () => {
    await callback();
    process.emit('SIGINT');
  });
}

function monitorFactory(config) {
  return {
    async collect() {
      if (config.collectSample) await config.collectSample();
      if (config.onReport) config.onReport({ state: 'observed' });
      if (config.onEvent) config.onEvent({ state: 'observed' });
    },
    start() {
      if (config.onError) config.onError(new Error('monitor warning'));
      interruptOnStart();
    },
    stop: jest.fn()
  };
}

describe('native top-level CLI adapter', () => {
  let root;
  let stdout;
  let stderr;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-cli-'));
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  test('runs workload, budget, resource, game, power, process, and startup command families', async () => {
    const adapter = { collectFacts: jest.fn(async () => facts), applyAction: jest.fn(async () => ({ ok: true })) };
    const applied = jest.fn(async () => ({ state: 'applied' }));
    await expect(runWorkloadCommand('workload-preview', { 'game-names': 'game.exe' }, { adapter })).resolves.toMatchObject({ facts, plan: expect.any(Object) });
    await expect(runWorkloadCommand('workload-apply', { confirm: true, 'approve-pids': '1' }, { adapter, apply: applied })).resolves.toMatchObject({ report: { state: 'applied' } });
    await expect(runWorkloadCommand('workload-apply', {}, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runWorkloadCommand('workload-apply', { confirm: true }, { adapter, apply: applied })).rejects.toThrow('requires --approve-pids');

    await expect(runWorkloadBudgetCommand('workload-budget-preview', { budget: '{"cpuPercent":10}' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runWorkloadBudgetCommand('workload-budget-preview', { hard: true, 'cpu-percent': '10' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runWorkloadBudgetCommand('workload-budget-preview', { 'cpu-percent': '10', 'memory-bytes': '10', 'io-bytes-per-second': '10', 'gpu-percent': '10' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runWorkloadBudgetCommand('workload-budget-apply', { budget: '{"cpuPercent":10}', confirm: true, 'approve-pids': '1' }, { adapter, apply: applied })).resolves.toMatchObject({ report: { state: 'applied' } });
    await expect(runWorkloadBudgetCommand('workload-budget-apply', {}, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runWorkloadBudgetCommand('workload-budget-apply', { confirm: true }, { adapter, apply: applied })).rejects.toThrow('requires --approve-pids');
    await expect(runResourceLimitCommand('resource-limit-preview', { limits: '{"cpuPercent":10}' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runResourceLimitCommand('resource-limit-preview', { 'cpu-percent': '10', 'memory-bytes': '10', 'io-bytes-per-second': '10', 'io-device': '8:0' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runResourceLimitCommand('resource-limit-apply', { limits: '{"cpuPercent":10}', confirm: true, 'approve-pids': '1' }, { adapter, apply: applied })).resolves.toMatchObject({ report: { state: 'applied' } });
    await expect(runResourceLimitCommand('resource-limit-apply', {}, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runResourceLimitCommand('resource-limit-apply', { confirm: true }, { adapter, apply: applied })).rejects.toThrow('requires --approve-pids');

    await expect(runGameSessionCommand({ 'interval-seconds': '1', 'game-names': 'game.exe' }, { adapter, monitorFactory })).resolves.toEqual({ stopped: true });
    await expect(runGameSessionCommand({ 'interval-seconds': '1' }, { adapter, monitorFactory })).resolves.toEqual({ stopped: true });
    await expect(runGameSessionCommand({ 'auto-apply': true })).rejects.toThrow('requires --confirm');
    await expect(runGameSessionCommand({ 'auto-apply': true, confirm: true }, { adapter, monitorFactory })).rejects.toThrow('requires --approve-pids');

    await expect(runPowerCommand('power-recommend', {}, { adapter })).resolves.toMatchObject({ recommendation: expect.any(Object) });
    await expect(runPowerCommand('power-preview', { profile: 'balanced' }, { adapter, platform: 'linux' })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runPowerCommand('power-apply', { profile: 'balanced', confirm: true }, { adapter, apply: applied })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runPowerCommand('power-apply', { profile: 'balanced' }, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runGpuPolicyCommand('gpu-policy-preview', { policy: 'balanced' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runGpuPolicyCommand('gpu-policy-apply', { policy: 'balanced', confirm: true }, { adapter, apply: applied })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runGpuPolicyCommand('gpu-policy-apply', { policy: 'balanced' }, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runPowerMonitorCommand({ 'interval-seconds': '1' }, { adapter, monitorFactory, platform: 'linux' })).resolves.toEqual({ stopped: true });
    await expect(runPowerMonitorCommand({ 'auto-apply': true })).rejects.toThrow('requires --confirm');

    await expect(runProcessCommand('process-overview', { 'protected-name': 'model' }, { adapter })).resolves.toMatchObject({ overview: expect.any(Object) });
    await expect(runProcessCommand('process-stop-preview', { pid: '1' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runProcessCommand('process-stop-apply', { pid: '1', confirm: true }, { adapter, apply: applied })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runProcessCommand('process-stop-apply', { pid: '1' }, { adapter, apply: applied })).rejects.toThrow('requires --confirm');

    const startupFacts = { platform: 'linux', startup: { entries: [{ name: 'Updater', location: '/tmp/updater.desktop', command: 'up' }] } };
    await expect(runStartupCommand('startup-preview', { facts: JSON.stringify(startupFacts), name: 'Updater', location: '/tmp/updater.desktop' }, { adapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runStartupCommand('startup-apply', { facts: JSON.stringify(startupFacts), name: 'Updater', location: '/tmp/updater.desktop', confirm: true }, { adapter, apply: applied, commandRunner: { run: jest.fn() } })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runStartupCommand('startup-apply', { facts: JSON.stringify(startupFacts), name: 'Updater', location: '/tmp/updater.desktop' }, { adapter, apply: applied })).rejects.toThrow('requires --confirm');
    await expect(runStartupCommand('startup-restore', { receipt: '{}'}, { adapter, restore: jest.fn(() => ({ state: 'restored' })), commandRunner: { run: jest.fn() } })).resolves.toEqual({ state: 'restored' });
    await expect(runStartupCommand('startup-preview', { name: 'Updater', location: '/tmp/updater.desktop', 'protected-name': 'Updater' }, { adapter: { collectFacts: async () => startupFacts } })).resolves.toMatchObject({ plan: expect.any(Object) });
  });

  test('runs drive, report, volume, filesystem, network, and placement command families', async () => {
    const commandRunner = { run: jest.fn(async () => ({ code: 0, stdout: '', stderr: '' })) };
    const inventory = { drives: [{ device: '/dev/sda' }] };
    await expect(runDriveHealthCommand({}, { inventoryCollector: async () => inventory, smartAllCollector: async () => ({ state: 'smart-all' }), smartCollector: async () => ({ state: 'smart-one' }), commandRunner })).resolves.toEqual(inventory);
    await expect(runDriveHealthCommand({ 'smart-all': true }, { inventoryCollector: async () => inventory, smartAllCollector: async () => ({ state: 'smart-all' }), commandRunner })).resolves.toMatchObject({ smart: { state: 'smart-all' } });
    await expect(runDriveHealthCommand({ 'smart-device': '/dev/sda' }, { inventoryCollector: async () => inventory, smartCollector: async () => ({ state: 'smart-one' }), commandRunner })).resolves.toMatchObject({ smart: { state: 'smart-one' } });

    const reportPath = path.join(root, 'report.html');
    await fs.writeFile(reportPath, '<html></html>');
    const linuxRoot = path.posix.join('/tmp', 'rnk-cli-adapter');
    const linuxPaths = { platform: 'linux', pathImpl: path.posix, cliPath: '/app/native/cli.mjs', nodePath: '/usr/bin/node' };
    await expect(runReportViewerCommand({ path: reportPath }, { platform: 'linux', commandRunner })).resolves.toMatchObject({ state: 'review-ready' });
    await expect(runReportViewerCommand({ path: reportPath, confirm: true }, { platform: 'linux', commandRunner, apply: jest.fn(async () => ({ state: 'opened' })) })).resolves.toMatchObject({ result: { state: 'opened' } });
    await expect(runWorkstationShellCommand({ path: path.posix.join(linuxRoot, 'history.jsonl'), 'output-path': path.posix.join(linuxRoot, 'report.html') }, linuxPaths)).resolves.toMatchObject({ state: 'review-ready', operation: 'open-workstation-dashboard' });
    await expect(runWorkstationShellCommand({ path: path.posix.join(linuxRoot, 'history.jsonl'), 'output-path': path.posix.join(linuxRoot, 'report.html'), confirm: true }, { ...linuxPaths, commandRunner, apply: jest.fn(async () => ({ state: 'applied' })) })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runWorkstationShellCommand({ packaged: true }, { ...linuxPaths, env: { XDG_STATE_HOME: linuxRoot }, apply: jest.fn(async () => ({ state: 'applied' })) })).resolves.toMatchObject({ state: 'review-ready', historyPath: path.posix.join(linuxRoot, 'RNK', 'Optimizer', 'history.jsonl') });
    await expect(runWorkstationShellCommand({ packaged: true }, { platform: 'linux', env: {}, pathResolver: () => ({ state: 'invalid-environment', reason: 'missing root' }) })).rejects.toThrow('missing root');
    await expect(runWorkstationTrayCommand({ path: path.posix.join(linuxRoot, 'history.jsonl'), 'output-path': path.posix.join(linuxRoot, 'report.html') }, linuxPaths)).resolves.toMatchObject({ state: 'review-ready' });
    await expect(runWorkstationTrayCommand({ path: path.posix.join(linuxRoot, 'history.jsonl'), 'output-path': path.posix.join(linuxRoot, 'report.html'), confirm: true }, { ...linuxPaths, commandRunner, apply: jest.fn(async () => ({ state: 'applied' })) })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runWorkstationTrayCommand({ packaged: true }, { ...linuxPaths, env: { XDG_STATE_HOME: linuxRoot }, apply: jest.fn(async () => ({ state: 'applied' })) })).resolves.toMatchObject({ state: 'review-ready' });
    await expect(runWorkstationTrayCommand({ packaged: true }, { platform: 'linux', env: {}, pathResolver: () => ({ state: 'invalid-environment', reason: 'missing root' }) })).rejects.toThrow('missing root');
    await expect(runVolumeStorageCommand({ collector: async () => ({ state: 'volumes' }), commandRunner })).resolves.toEqual({ state: 'volumes' });
    await expect(runFilesystemHealthCommand({ root }, { collector: async () => ({ state: 'filesystem' }), commandRunner })).resolves.toEqual({ state: 'filesystem' });
    await expect(runDriveBenchmarkCommand({ root, bytes: '8' }, { benchmark: async (options) => ({ state: 'benchmark', options }) })).resolves.toMatchObject({ state: 'benchmark', options: { root, bytes: 8 } });

    const networkAdapter = { collectFacts: jest.fn(async () => ({ networkConnections: { connections: [] }, network: {} })) };
    await expect(runNetworkOverviewCommand({ samples: '[]', 'game-pid': '1', 'latency-ms': '20' }, { adapter: networkAdapter })).resolves.toMatchObject({ plan: expect.any(Object) });
    await expect(runNetworkOverviewCommand({}, { adapter: networkAdapter })).resolves.toMatchObject({ plan: { usage: { available: false } } });
    await expect(runNetworkOverviewCommand({}, { adapter: { collectFacts: jest.fn(async () => ({ networkProcesses: { processes: [{ pid: 7, sentBytesPerSecond: 1, receivedBytesPerSecond: 2 }] }, networkConnections: { connections: [] } })) } })).resolves.toMatchObject({ plan: { usage: { available: true } } });
    await expect(runNetworkRateMonitorCommand({ 'interval-seconds': '1' }, { adapter: networkAdapter, monitorFactory })).resolves.toEqual({ stopped: true });
    await expect(runProcessRateMonitorCommand({ 'interval-seconds': '1' }, { adapter: { collectFacts: jest.fn(async () => ({ processes: [] })) }, monitorFactory })).resolves.toEqual({ stopped: true });

    const plan = { state: 'plan-ready' };
    const preview = jest.fn(() => plan);
    const apply = jest.fn(async () => ({ state: 'applied' }));
    const rollback = jest.fn(() => ({ state: 'rolled-back' }));
    const placementArgs = { files: '[]', 'source-root': root, 'target-root': path.join(root, 'target'), 'protected-root': path.join(root, 'protected') };
    await expect(runPlacementCommand('placement-preview', placementArgs, { preview })).resolves.toEqual(plan);
    await expect(runPlacementCommand('placement-preview', { ...placementArgs, 'preserve-source': 'true' }, { preview })).resolves.toEqual(plan);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ preserveSource: true }));
    await expect(runPlacementCommand('placement-preview', { files: '[]', 'source-root': root, 'target-root': path.join(root, 'target') }, { preview })).resolves.toEqual(plan);
    await expect(runPlacementCommand('placement-apply', placementArgs, { preview, apply })).rejects.toThrow('requires --confirm');
    await expect(runPlacementCommand('placement-apply', { ...placementArgs, confirm: true }, { preview, apply })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runPlacementCommand('placement-rollback', { result: '{}' }, { rollback })).resolves.toEqual({ state: 'rolled-back' });

    const policyArgs = { scan: '{}', 'target-roots': '{"model":"/tmp/models"}', 'source-root': root, 'protected-root': path.join(root, 'protected'), 'target-free-bytes': '{"/tmp/models":10}' };
    await expect(runPlacementPolicyCommand('placement-policy-preview', policyArgs, { preview })).resolves.toEqual(plan);
    await expect(runPlacementPolicyCommand('placement-policy-apply', policyArgs, { preview, apply })).rejects.toThrow('requires --confirm');
    await expect(runPlacementPolicyCommand('placement-policy-apply', { ...policyArgs, confirm: true }, { preview, apply })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runPlacementPolicyCommand('placement-policy-rollback', { result: '{}' }, { rollback })).resolves.toEqual({ state: 'rolled-back' });
    await expect(runPlacementPolicyCommand('placement-policy-preview', { scan: '{}', 'target-roots': '{}', 'max-entries': '1' }, { preview })).resolves.toEqual(plan);
    await expect(runPlacementRecommendationCommand({ volumes: '[]', categories: '["model"]', 'media-preferences': '{"model":"hdd"}', 'protected-root': root, 'min-free-bytes': '10' })).resolves.toBeDefined();
    await expect(runPlacementRecommendationCommand({ volumes: '[]' })).resolves.toBeDefined();
    await expect(runWindowsResourceLimitCommand('windows-resource-limit-query', { pid: '42' }, { platform: 'linux' })).resolves.toMatchObject({ state: 'unsupported-platform' });
    await expect(runWindowsResourceLimitCommand('windows-resource-limit-query', { pid: '0' })).resolves.toBeDefined();
    const resourceRunner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ limits: { cpuPercent: 10 } }) })) };
    await expect(runWindowsResourceLimitCommand('windows-resource-limit-query', { pid: '42' }, { platform: 'win32', commandRunner: resourceRunner })).resolves.toMatchObject({ state: 'observed', operation: 'query' });
    await expect(runWindowsResourceLimitCommand('windows-resource-limit-release', { pid: '42' }, { platform: 'win32', commandRunner: resourceRunner })).resolves.toMatchObject({ state: 'released', operation: 'release' });
    await expect(runWindowsResourceLimitCommand('windows-resource-limit-query', { pid: '0' }, { platform: 'win32', commandRunner: resourceRunner })).resolves.toMatchObject({ state: 'rejected' });
    const evidenceJson = JSON.stringify({ volumes: [], drives: [], hardFailureEvidence: [] });
    await expect(runPlacementCommand('placement-preview', { ...placementArgs, 'storage-evidence': evidenceJson }, { preview })).resolves.toEqual(plan);
    await expect(runPlacementPolicyCommand('placement-policy-preview', { ...policyArgs, 'storage-evidence': evidenceJson }, { preview })).resolves.toEqual(plan);
    await expect(runPlacementRecommendationCommand({ volumes: '[]', drives: '[]', 'hard-failure-evidence': '[]' })).resolves.toBeDefined();
  });

  test('runs assistant, policy, and direct CLI routing boundaries', async () => {
    const adapter = { collectFacts: jest.fn(async () => facts) };
    await expect(runAssistantCommand({ question: 'What should I fix today?', facts: '{}', report: '{"recommendations":[]}' }, { adapter })).resolves.toMatchObject({ intent: 'recommendations' });
    await expect(runAssistantCommand({ question: 'What should I fix today?' }, { adapter })).resolves.toMatchObject({ intent: 'recommendations' });
    await expect(runAssistantAdapterCommand({ question: 'Why is C: full?', facts: '{}', 'adapter-response': '{"question":"Why is C: full?","confidence":0.9}' }, { adapter })).resolves.toMatchObject({ state: 'delegated', delegated: { intent: 'storage' } });
    await expect(runAssistantAdapterCommand({ question: 'Why is C: full?', facts: '{}' }, { adapter, generate: async () => ({ question: 'Why is C: full?', confidence: 0.9 }) })).resolves.toMatchObject({ state: 'delegated' });
    await expect(runAssistantAdapterCommand({ question: 'What should I fix today?', report: '{"recommendations":[]}' }, { adapter, generate: async () => ({ question: 'What should I fix today?', confidence: 0.9 }) })).resolves.toMatchObject({ state: 'delegated', delegated: { intent: 'recommendations' } });
    await expect(runWorkstationPolicyCommand('policy-preview', { facts: '{}', report: '{}' }, { adapter })).resolves.toMatchObject({ state: 'no-change' });
    await expect(runWorkstationPolicyCommand('policy-preview', {}, { adapter })).resolves.toMatchObject({ state: 'no-change' });
    const policy = await runWorkstationPolicyCommand('policy-preview', { facts: '{"storagePressure":{"level":"critical"}}' }, { adapter });
    await expect(runWorkstationPolicyCommand('policy-approve', { plan: JSON.stringify(policy), 'approve-ids': 'storage-pressure-review' }, { adapter })).resolves.toMatchObject({ phase: 'approved' });
    expect(agentFromArgs({}, { adapter: { ...adapter, applyAction: jest.fn() }, env: {} })).toBeDefined();
    expect(agentFromArgs({ 'target-pid': '42' }, { adapter: { ...adapter, applyAction: jest.fn() }, env: {} })).toBeDefined();
    const target = {};
    await expect(runCliEntrypoint({ entrypoint: false, run: jest.fn() })).resolves.toBe(0);
    await expect(runCliEntrypoint()).resolves.toBe(0);
    await expect(runCliEntrypoint({ entrypoint: true, run: async () => ({ ok: true }), write: jest.fn(), target })).resolves.toBe(0);
    await expect(runCliEntrypoint({ entrypoint: true, run: async () => { throw new Error('cli failed'); }, errorWrite: jest.fn(), target })).resolves.toBe(1);
    expect(target.exitCode).toBe(1);

    const routed = [
      ['facts'],
      ['windows-resource-limit-query', '--pid=42'],
      ['windows-resource-limit-release', '--pid=42'],
      ['optimize'],
      ['cache-preview'],
      ['storage-preview'],
      ['download-preflight', '--size-bytes=1'],
      ['network-monitor', '--interval-seconds=0'],
      ['workload-preview'],
      ['workload-budget-preview'],
      ['resource-limit-preview'],
      ['gpu-policy-preview', '--policy=balanced'],
      ['drive-health'],
      ['volume-storage'],
      ['network-overview'],
      ['process-overview'],
      ['media-player', '--tracks=["/music/a.mp3"]'],
      ['media-panel', '--url=https://www.youtube.com/watch?v=abc'],
      ['protected-roots-read', `--protected-store=${path.join(root, 'protected.json')}`]
    ];
    const cliAdapter = { collectFacts: jest.fn(async () => facts), applyAction: jest.fn(async () => ({ ok: true })) };
    const cliCommandRunner = { run: jest.fn(async () => ({ code: 0, stdout: '', stderr: '' })) };
    const cliCleaner = { preview: jest.fn(async () => ({ target: 'user-temp', platform: 'win32', roots: [], items: [] })) };
    const cliStorageGuard = { preview: jest.fn(async () => ({ state: 'review-ready', plan: { selected: [] } })) };
    const cliDownloadGuard = { preflight: jest.fn(() => ({ state: 'observation-required' })) };
    const cliNetworkMonitorFactory = () => ({ collect: async () => {}, start: jest.fn(), stop: jest.fn() });
    const cliNetworkMonitorSignalEmitter = { once: jest.fn((event, listener) => listener()) };
    const cliOptions = { adapter: cliAdapter, commandRunner: cliCommandRunner, cacheCleaner: cliCleaner, storageGuard: cliStorageGuard, downloadGuard: cliDownloadGuard, networkMonitorFactory: cliNetworkMonitorFactory, networkMonitorSignalEmitter: cliNetworkMonitorSignalEmitter, platform: 'linux' };
    for (const argv of routed.filter((argv) => argv[0] !== 'optimize')) await expect(runCli(argv, cliOptions)).resolves.toBeDefined();
    await expect(runCli(['optimize'], cliOptions)).rejects.toThrow('gateway URL is required');
    await expect(runCli(['optimize', `--history-path=${path.join(root, 'history.jsonl')}`], cliOptions)).rejects.toThrow('gateway URL is required');
    await expect(runCli([], cliOptions)).resolves.toBeDefined();
    const originalArgv = process.argv;
    process.argv = ['node'];
    await expect(runCli(undefined, cliOptions)).resolves.toBeDefined();
    process.argv = originalArgv;
    await expect(runCli(['unknown-command'], cliOptions)).rejects.toThrow('Unknown native command');
    await expect(runCli(['organize-preview'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['file-inspect'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['steward-history'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-monitor'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-schedule'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-daemon'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-report'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-snapshot'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-trends'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['report-schedule-restore', '--receipt={}'], cliOptions)).rejects.toThrow('Report schedule receipt is invalid');
    await expect(runCli(['download-scan'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['download-monitor'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['game-session-monitor', '--auto-apply'], cliOptions)).rejects.toThrow('requires --confirm');
    await expect(runCli(['report-open'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-dashboard'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['steward-tray'], cliOptions)).rejects.toThrow('--path is required');
    await expect(runCli(['filesystem-health'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['drive-benchmark'], cliOptions)).rejects.toThrow('--root is required');
    await expect(runCli(['network-rate-monitor', '--interval-seconds=0'], cliOptions)).rejects.toThrow('interval');
    await expect(runCli(['process-rate-monitor', '--interval-seconds=0'], cliOptions)).rejects.toThrow('interval');
    await expect(runCli(['placement-preview'], cliOptions)).rejects.toThrow('--files is required');
    await expect(runCli(['placement-recommend'], cliOptions)).rejects.toThrow('--volumes is required');
    await expect(runCli(['placement-policy-preview'], cliOptions)).rejects.toThrow('--scan is required');
    await expect(runCli(['assistant'], cliOptions)).rejects.toThrow('--question is required');
    await expect(runCli(['assistant-adapted', '--question=Why is C: full?', '--facts={}'], cliOptions)).resolves.toMatchObject({ state: 'refused', evidence: { reason: expect.stringContaining('--adapter-response is required') } });
    await expect(runCli(['policy-approve'], cliOptions)).rejects.toThrow('--plan is required');
    await expect(runCli(['power-monitor', '--auto-apply'], cliOptions)).rejects.toThrow('requires --confirm');
    await expect(runCli(['power-preview'], cliOptions)).rejects.toThrow('--profile is required');
    await expect(runCli(['gpu-policy-preview'], cliOptions)).rejects.toThrow('--policy is required');
    await expect(runCli(['storage-monitor', '--auto-clean'], cliOptions)).rejects.toThrow('requires explicitly enabled categories');
    await expect(runCli(['startup-preview', '--facts={}'], cliOptions)).rejects.toThrow('--name is required');
    await expect(runCli(['protected-roots-add'], cliOptions)).rejects.toThrow('--protected-store is required');
    await expect(runCli(['media-metadata'], cliOptions)).rejects.toThrow('--file is required');
    const entrypointTarget = {};
    await expect(runCliEntrypoint({ entrypoint: true, run: async () => ({ ok: true }), target: entrypointTarget })).resolves.toBe(0);
    await expect(runCliEntrypoint({ entrypoint: true, run: async () => { throw new Error('default error writer'); }, target: entrypointTarget })).resolves.toBe(1);
    const savedArgv = process.argv;
    process.argv = ['node'];
    await expect(runCliEntrypoint({ entrypoint: true, target: entrypointTarget })).resolves.toBe(0);
    process.argv = savedArgv;
    expect(isCliEntrypoint('file:///tmp/cli.mjs', '')).toBe(false);
  }, 30000);

  test('covers default CLI dependencies without touching the host platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'unsupported' });
    try {
      expect(agentFromArgs({})).toBeDefined();
      await expect(runWorkloadCommand('workload-preview', {})).resolves.toMatchObject({ plan: expect.any(Object) });
      await expect(runWorkloadBudgetCommand('workload-budget-preview', {})).resolves.toMatchObject({ plan: expect.any(Object) });
      await expect(runResourceLimitCommand('resource-limit-preview', {})).resolves.toMatchObject({ plan: expect.any(Object) });
      await expect(runGameSessionCommand({}, { monitorFactory })).resolves.toEqual({ stopped: true });
      await expect(runDriveHealthCommand({})).resolves.toMatchObject({ available: false });
      await expect(runReportViewerCommand({})).rejects.toThrow('--path is required');
      await expect(runWorkstationShellCommand({})).rejects.toThrow('--path is required');
      await expect(runWorkstationTrayCommand({})).rejects.toThrow('--path is required');
      await expect(runVolumeStorageCommand()).resolves.toMatchObject({ available: false });
      await expect(runFilesystemHealthCommand({})).rejects.toThrow('--root is required');
      await expect(runNetworkOverviewCommand({})).resolves.toMatchObject({ facts: expect.any(Object) });
      await expect(runNetworkRateMonitorCommand({}, { monitorFactory })).resolves.toEqual({ stopped: true });
      await expect(runProcessRateMonitorCommand({}, { monitorFactory })).resolves.toEqual({ stopped: true });
      await expect(runNetworkRateMonitorCommand({ 'interval-seconds': '0' })).rejects.toThrow('interval');
      await expect(runProcessRateMonitorCommand({ 'interval-seconds': '0' })).rejects.toThrow('interval');
      await expect(runCli(['network-monitor', '--interval-seconds=0'])).rejects.toThrow('interval');
      await expect(runAssistantCommand({ question: 'What should I fix today?', facts: '{}' })).resolves.toMatchObject({ intent: 'recommendations' });
      await expect(runAssistantAdapterCommand({ question: 'What should I fix today?', facts: '{}', 'adapter-response': '{"question":"What should I fix today?","confidence":0.9}' })).resolves.toMatchObject({ state: 'delegated' });
      await expect(runWorkstationPolicyCommand('policy-approve', { plan: '{"version":1,"phase":"recommend","actions":[]}', 'approve-ids': '' })).resolves.toMatchObject({ phase: 'approved' });
      await expect(runPowerCommand('power-recommend', {})).resolves.toMatchObject({ recommendation: expect.any(Object) });
      await expect(runGpuPolicyCommand('gpu-policy-preview', { policy: 'balanced' })).resolves.toMatchObject({ plan: expect.any(Object) });
      await expect(runPowerMonitorCommand({}, { monitorFactory })).resolves.toEqual({ stopped: true });
      await expect(runProcessCommand('process-overview', {})).resolves.toMatchObject({ overview: expect.any(Object) });
      await expect(runStartupCommand('startup-restore', { receipt: '{}' }, { restore: () => ({ state: 'restored' }) })).resolves.toEqual({ state: 'restored' });
      await expect(runStartupCommand('startup-restore', { receipt: '{}' })).rejects.toThrow();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
