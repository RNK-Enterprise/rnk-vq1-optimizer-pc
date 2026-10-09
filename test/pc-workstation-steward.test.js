import { runWorkstationStewardEngine, WORKSTATION_STEWARD_ENGINE_ID, WORKSTATION_STEWARD_TRIGGERS } from '../pc/engines/workstation-steward/engine.js';
import { mergeWorkstationStewardReports, buildWorkstationStewardPlan, buildWorkstationStewardEnvelope, createWorkstationStewardLibrary } from '../pc/engines/workstation-steward/library.js';
import { runWorkstationStewardResourceGovernanceTurbo } from '../pc/engines/workstation-steward/turbos/resource-governance/turbo.js';
import { mergeWorkstationStewardResourceGovernanceReports, buildWorkstationStewardResourceGovernancePlan, buildWorkstationStewardResourceGovernanceEnvelope, createWorkstationStewardResourceGovernanceLibrary } from '../pc/engines/workstation-steward/turbos/resource-governance/library.js';
import { runWorkstationStewardStorageFilesTurbo } from '../pc/engines/workstation-steward/turbos/storage-files/turbo.js';
import { mergeWorkstationStewardStorageFilesReports, buildWorkstationStewardStorageFilesPlan, buildWorkstationStewardStorageFilesEnvelope, createWorkstationStewardStorageFilesLibrary } from '../pc/engines/workstation-steward/turbos/storage-files/library.js';
import { runWorkstationStewardHistoryReportTurbo } from '../pc/engines/workstation-steward/turbos/history-report/turbo.js';
import { mergeWorkstationStewardHistoryReportReports, buildWorkstationStewardHistoryReportPlan, buildWorkstationStewardHistoryReportEnvelope, createWorkstationStewardHistoryReportLibrary } from '../pc/engines/workstation-steward/turbos/history-report/library.js';
import { runWorkstationStewardMediaAssistantTurbo } from '../pc/engines/workstation-steward/turbos/media-assistant/turbo.js';
import { mergeWorkstationStewardMediaAssistantReports, buildWorkstationStewardMediaAssistantPlan, buildWorkstationStewardMediaAssistantEnvelope, createWorkstationStewardMediaAssistantLibrary } from '../pc/engines/workstation-steward/turbos/media-assistant/library.js';

const hash = 'a'.repeat(64);
const base = {
  engine: 'system-facts', platform: 'win32', protectedPaths: ['E:/Models'],
  storage: [{ mount: 'C:', volumeId: 'volume-c', physicalDiskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', freeBytes: 8, totalBytes: 100, kind: 'ssd', health: 'healthy', smart: 'passed', system: true }, { mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', freeBytes: 20 * 1024 ** 3, totalBytes: 1000, kind: 'hdd', health: 'healthy', writable: true }, { mount: 'F:', volumeId: 'volume-f', physicalDiskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', freeBytes: 30 * 1024 ** 3, totalBytes: 1000, kind: 'hdd', health: 'healthy', writable: true }],
  drives: [{ diskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', smart: 'passed' }, { diskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', health: 'healthy', smart: 'passed' }, { diskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', smart: 'passed' }],
  resourceBudget: { cpuPercent: 10, memoryBytes: 10, ioBytesPerSecond: 10, gpuPercent: 10 },
  processes: [{ pid: 10, name: 'game.exe', role: 'game', foreground: true, gpuPercent: 80 }, { pid: 11, name: 'build', role: 'build', memoryBytes: 20, protected: false }, { pid: 12, name: 'model', role: 'ai', protected: true }],
  files: [{ path: 'C:/Downloads/a.zip', sha256: hash, sizeBytes: 3 * 1024 ** 3 }, { path: 'C:/Downloads/b.zip', sha256: hash }, { path: 'C:/Downloads/c.part', complete: false }],
  downloads: [{ name: 'model.zip', sizeBytes: 20, destinationMount: 'C:' }, { name: 'direct-to-e', sizeBytes: 1, destinationMount: 'E:', bandwidthBytesPerSecond: 2, sha256: hash }, { name: 'too-large', sizeBytes: 999 * 1024 ** 3, destinationMount: 'C:' }, { name: 'unknown' }],
  media: [{ type: 'music', sizeBytes: 4 }, { type: 'movie', sizeBytes: 6 }],
  history: [{ freeBytes: 4 }]
};
const report = (state = 'plan-ready', fields = {}) => ({ engine: 'workstation-steward', state, actions: [], protectedPaths: [], ...fields });
const turboReport = (turbo, state, fields = {}) => ({ turbo, state, actions: [], placements: [], actionHistory: [], report: {}, ...fields });

describe('workstation-steward engine and library', () => {
  test('builds a cross-platform workstation plan with protected assets', () => {
    const result = runWorkstationStewardEngine(base, { trigger: 'workload.changed', now: () => 0 });
    expect(WORKSTATION_STEWARD_ENGINE_ID).toBe('workstation-steward');
    expect(WORKSTATION_STEWARD_TRIGGERS).toEqual(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
    expect(result).toMatchObject({ state: 'plan-ready', platform: 'win32', game: { detected: true, name: 'game.exe' } });
    expect(result.capabilities.cpuHardCap).toBe('platform-adapter-review');
    expect(result.resources).toMatchObject({ capabilities: { cpuPercent: 'hard-limit-adapter', memoryBytes: 'hard-limit-adapter', ioBytesPerSecond: 'priority-only', gpuPercent: 'observation-only' }, actions: [expect.objectContaining({ type: 'budget-process', pid: 11, requiresApproval: true, enforcement: 'hard-where-supported', unsupportedDimensions: ['ioBytesPerSecond', 'gpuPercent'] })] });
    expect(result.files.duplicateGroups).toHaveLength(1);
    expect(result.files.incomplete).toEqual(['C:/Downloads/c.part']);
    expect(result.files.suggestedTarget).toBe('F:');
    expect(result.downloads[0]).toMatchObject({ state: 'redirect', targetMount: 'F:' });
    expect(result.downloads[1]).toMatchObject({ state: 'allow', targetMount: 'E:', hashStatus: 'available', bandwidthBytesPerSecond: 2 });
    expect(result.downloads[3].state).toBe('observation-required');
    expect(result.media).toMatchObject({ itemCount: 2, totalBytes: 10, counts: { music: 1, movie: 1 } });
    expect(result.protectedPaths).toEqual(expect.arrayContaining(['models', 'E:/Models']));
    expect(runWorkstationStewardEngine({ ...base, hardFailureEvidence: [], downloads: [{ sizeBytes: 1, destinationMount: 'Z:' }] }, { trigger: 'health.interval', now: () => 0 }).downloads[0].state).toBe('redirect');
    expect(runWorkstationStewardEngine({ ...base, storage: [{ mount: 'E:', freeBytes: 10 }], downloads: [{ sizeBytes: 1, destinationMount: 'E:' }] }, { trigger: 'health.interval', now: () => 0 }).downloads[0].state).toBe('storage-safety-review');
  });

  test('fails closed for sparse, malformed, and alternate platform evidence', () => {
    const sparse = runWorkstationStewardEngine({ engine: 'workstation-steward-input', platform: 'solaris', storage: [{ mount: '/', freeBytes: -1, totalBytes: NaN, writable: false }], processes: [{ pid: 0, name: '', role: '' }], files: [{ path: '', sizeBytes: -1 }], downloads: [{ name: '', sizeBytes: -1, destinationMount: '' }], media: [{ type: '' }] }, { trigger: 'system.facts.request', now: () => 1 });
    expect(sparse).toMatchObject({ state: 'plan-ready', platform: 'unknown', game: { detected: false }, resources: { enforcement: 'observation-only', capabilities: { cpuPercent: 'unsupported', memoryBytes: 'unsupported' } } });
    expect(sparse.files).toMatchObject({ duplicateGroups: [], incomplete: [], large: [], suggestedTarget: null, moveRequiresPreview: false });
    expect(sparse.downloads[0].state).toBe('observation-required');
    const empty = runWorkstationStewardEngine({ engine: 'system-facts' }, { trigger: 'health.interval', now: () => 2 });
    expect(empty.state).toBe('observation-required');
    const declared = runWorkstationStewardEngine({ engine: 'system-facts', os: { platform: 'linux' }, game: { detected: true, pid: 99, name: 'declared' }, workload: {}, storage: [], processes: [] }, { trigger: 'health.interval', now: () => 3 });
    expect(declared).toMatchObject({ platform: 'linux', game: { detected: true, pid: 99, confidence: 1 }, resources: { capabilities: { cpuPercent: 'hard-limit-adapter', memoryBytes: 'hard-limit-adapter' } } });
    const mac = runWorkstationStewardEngine({ engine: 'system-facts', platform: 'darwin', game: { detected: true }, processes: [{ pid: 1, role: 'game', foreground: true }, { pid: 2, role: 'build' }] }, { trigger: 'health.interval', now: () => 3.5 });
    expect(mac.resources.actions[0].unsupportedDimensions).toEqual(['cpuPercent', 'memoryBytes', 'ioBytesPerSecond', 'gpuPercent']);
    const candidateWithoutPid = runWorkstationStewardEngine({ engine: 'system-facts', processes: [{ role: 'game', foreground: false }] }, { trigger: 'health.interval', now: () => 4 });
    expect(runWorkstationStewardEngine({ ...base, hardFailureEvidence: [], downloads: [{ name: 'unknown-size' }] }, { trigger: 'health.interval', now: () => 4 }).downloads[0].state).toBe('observation-required');
    expect(candidateWithoutPid.game).toMatchObject({ detected: true, pid: null, confidence: 0.8 });
    expect(runWorkstationStewardEngine({ engine: 'system-facts', processes: [{ role: 'build', foreground: true }] }, { trigger: 'health.interval', now: () => 5 }).game.detected).toBe(false);
    expect(() => runWorkstationStewardEngine(null, { trigger: 'health.interval' })).toThrow('facts must be an object');
    expect(() => runWorkstationStewardEngine({ engine: 'wrong' }, { trigger: 'health.interval' })).toThrow('requires system-facts');
    expect(() => runWorkstationStewardEngine(base, { trigger: 'bad' })).toThrow('Unsupported workstation-steward trigger');
    expect(() => runWorkstationStewardEngine(base, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationStewardEngine()).toThrow('unknown');
  });

  test('merges reports and creates review envelopes', () => {
    expect(mergeWorkstationStewardReports([])).toMatchObject({ state: 'observation-required', reportCount: 0 });
    expect(mergeWorkstationStewardReports([report(), report('observation-required', { game: { detected: true }, protectedPaths: ['repo'], cleanup: { recoveredBytes: 3 }, generatedAt: 'x' })])).toMatchObject({ state: 'plan-ready', gameReports: 1, cleanupRecoveredBytes: 3, protectedPaths: expect.arrayContaining(['repo']) });
    expect(mergeWorkstationStewardReports([report('observation-required', { generatedAt: '' })])).toMatchObject({ latestGeneratedAt: null });
    expect(mergeWorkstationStewardReports([report('observation-required', { protectedPaths: null })]).protectedPaths).toEqual([]);
    expect(buildWorkstationStewardPlan(report('observation-required'), 'interactive')).toMatchObject({ mode: 'evidence-collection' });
    expect(buildWorkstationStewardPlan(report(), 'headless')).toMatchObject({ mode: 'approval-review' });
    expect(buildWorkstationStewardPlan(report(), 'other').mode).toBe('profile-required');
    expect(buildWorkstationStewardEnvelope(report(), { trigger: 'health.interval', now: () => 0 }).generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(createWorkstationStewardLibrary().merge([]).state).toBe('observation-required');
    expect(() => mergeWorkstationStewardReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStewardReports([{}])).toThrow('requires a workstation-steward report');
    expect(() => mergeWorkstationStewardReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStewardReports([report('bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStewardReports([report('plan-ready', { actions: null })])).toThrow('requires actions');
    expect(() => mergeWorkstationStewardReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64');
    expect(() => buildWorkstationStewardPlan({})).toThrow('requires a workstation-steward report');
    expect(() => buildWorkstationStewardEnvelope(report())).toThrow('trigger');
    expect(() => buildWorkstationStewardEnvelope(report(), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});

describe('workstation-steward resource governance', () => {
  test('detects games and prepares bounded background review actions', () => {
    const game = runWorkstationStewardResourceGovernanceTurbo([{ platform: 'darwin', gameDetected: true, budget: { cpuPercent: 1, memoryBytes: 1, ioBytesPerSecond: 1, gpuPercent: 1 }, processes: [{ pid: 1, name: 'game', foreground: true, role: 'gaming' }, { pid: 2, name: 'build', memoryBytes: 2, role: 'build' }, { pid: 3, name: 'system', memoryBytes: 99, role: 'system' }, { pid: 4, name: 'protected', memoryBytes: 99, protected: true }, { pid: 5, name: 'io', ioBytesPerSecond: 2 }, { pid: 6, name: 'gpu', gpuPercent: 2 }, { pid: 7, name: 'cpu', cpuPercent: 2 }] }], { trigger: 'workload.changed', now: () => 0 });
    expect(game).toMatchObject({ platform: 'darwin', state: 'enforcement-review', gameDetected: true, pressuredProcessIds: [2, 5, 6, 7] });
    expect(game.actions[0]).toMatchObject({ pid: 2, reversible: true });
    const budget = runWorkstationStewardResourceGovernanceTurbo([{ processes: [{ pid: 5, name: 'build', cpuPercent: 90 }] }], { trigger: 'health.interval', budget: { cpuPercent: 10 }, now: () => 0 });
    expect(budget.state).toBe('budget-review');
    expect(runWorkstationStewardResourceGovernanceTurbo([{ processes: [{ pid: 8, name: 'game', foreground: true, role: 'game' }] }], { trigger: 'health.interval' }).state).toBe('game-observed');
    const stable = runWorkstationStewardResourceGovernanceTurbo([{ processes: [{ pid: 6, name: 'idle' }] }], { trigger: 'system.facts.request' });
    expect(stable.state).toBe('stable');
    const observed = runWorkstationStewardResourceGovernanceTurbo([{ gameDetected: true, startup: [{ name: 'x' }] }], { trigger: 'health.interval' });
    expect(observed.state).toBe('observation-required');
    expect(runWorkstationStewardResourceGovernanceTurbo([], { trigger: 'health.interval' }).state).toBe('insufficient-data');
    expect(() => runWorkstationStewardResourceGovernanceTurbo()).toThrow('unknown');
    expect(runWorkstationStewardResourceGovernanceTurbo([{ processes: [{ pid: 9, memoryBytes: 99 }] }], { trigger: 'health.interval', budget: { memoryBytes: 1 } }).actions[0].name).toBe('unknown');
    expect(() => runWorkstationStewardResourceGovernanceTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationStewardResourceGovernanceTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationStewardResourceGovernanceTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });

  test('merges governance evidence and validates boundaries', () => {
    const make = (state, fields = {}) => turboReport('workstation-steward.resource-governance', state, { pressuredProcessIds: [1], gameDetected: state === 'game-observed', ...fields });
    expect(mergeWorkstationStewardResourceGovernanceReports([]).state).toBe('insufficient-data');
    expect(mergeWorkstationStewardResourceGovernanceReports([make('stable'), make('enforcement-review')])).toMatchObject({ state: 'enforcement-review', actionCount: 0 });
    expect(mergeWorkstationStewardResourceGovernanceReports([make('enforcement-review'), make('stable')]).state).toBe('enforcement-review');
    expect(mergeWorkstationStewardResourceGovernanceReports([make('game-observed')]).gameDetected).toBe(true);
    expect(mergeWorkstationStewardResourceGovernanceReports([make('stable', { pressuredProcessIds: null })]).pressuredProcessIds).toEqual([]);
    expect(buildWorkstationStewardResourceGovernancePlan(make('enforcement-review'), 'interactive').mode).toBe('approval-required');
    expect(buildWorkstationStewardResourceGovernancePlan(make('stable'), 'interactive').mode).toBe('observation-review');
    expect(buildWorkstationStewardResourceGovernancePlan(make('stable')).mode).toBe('profile-required');
    expect(buildWorkstationStewardResourceGovernanceEnvelope(make('stable'), { trigger: 'health.interval', now: () => 0 }).library).toContain('resource-governance');
    expect(createWorkstationStewardResourceGovernanceLibrary().merge([make('stable')]).state).toBe('stable');
    expect(() => mergeWorkstationStewardResourceGovernanceReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStewardResourceGovernanceReports([{}])).toThrow('requires a resource-governance');
    expect(() => mergeWorkstationStewardResourceGovernanceReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStewardResourceGovernanceReports([make('bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStewardResourceGovernanceReports([make('stable', { actions: null })])).toThrow('requires actions');
    expect(() => mergeWorkstationStewardResourceGovernanceReports(Array.from({ length: 65 }, () => make('stable')))).toThrow('at most 64');
    expect(() => buildWorkstationStewardResourceGovernancePlan({})).toThrow('requires a resource-governance');
    expect(() => buildWorkstationStewardResourceGovernanceEnvelope(make('stable'))).toThrow('trigger');
    expect(() => buildWorkstationStewardResourceGovernanceEnvelope(make('stable'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});

describe('workstation-steward storage and files', () => {
  test('reviews drive evidence, duplicates, partial downloads, and placements', () => {
    const result = runWorkstationStewardStorageFilesTurbo({ volumes: [{ mount: 'C:', volumeId: 'volume-c', physicalDiskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', system: true, freeBytes: 1, health: 'healthy', smart: 'passed' }, { mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', freeBytes: 100, health: 'healthy', benchmark: { readBytesPerSecond: 1, writeBytesPerSecond: 1 } }, { mount: 'F:', volumeId: 'volume-f', physicalDiskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', freeBytes: 200, health: 'healthy' }], drives: [{ diskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', smart: 'passed' }, { diskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', health: 'healthy', smart: 'passed' }, { diskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', smart: 'passed' }], files: [null, { path: 'C:/a.iso', sha256: hash, sizeBytes: 3 * 1024 ** 3 }, { path: 'C:/b.iso', sha256: hash }, { path: 'C:/c.crdownload' }, { path: 'C:/protected/large.iso', sizeBytes: 3 * 1024 ** 3 }, { sizeBytes: 3 * 1024 ** 3 }, { path: 'C:/complete.zip', complete: true }], downloads: [{ path: 'C:/d.part', complete: false }, { name: 'orphan', complete: false }, { path: 'C:/done.zip', complete: true }] }, { trigger: 'health.interval', protectedPaths: ['C:/protected', 2], now: () => 0 });
    expect(result).toMatchObject({ state: 'incomplete-review', benchmarked: true, targetMount: 'F:' });
    expect(result.duplicates).toHaveLength(1);
    expect(result.incomplete).toEqual(expect.arrayContaining(['C:/c.crdownload', 'C:/d.part']));
    expect(result.placements[0]).toMatchObject({ targetMount: 'F:', state: 'move-preview' });
    const duplicate = runWorkstationStewardStorageFilesTurbo({ files: [{ path: 'x', sha256: hash }, { path: 'y', sha256: hash }] }, { trigger: 'system.facts.request' });
    expect(duplicate.state).toBe('duplicate-review');
    const place = runWorkstationStewardStorageFilesTurbo({ volumes: [{ mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', freeBytes: 10 }], drives: [{ diskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', smart: 'passed' }], files: [{ path: 'large', sizeBytes: 3 * 1024 ** 3 }] }, { trigger: 'health.interval' });
    expect(place.state).toBe('placement-review');
    const evidence = runWorkstationStewardStorageFilesTurbo({ volumes: [{ mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', freeBytes: 10, benchmark: { readBytesPerSecond: 1, writeBytesPerSecond: 1 } }], drives: [{ diskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', smart: 'passed' }] }, { trigger: 'health.interval' });
    expect(evidence.state).toBe('evidence-ready');
    const review = runWorkstationStewardStorageFilesTurbo({ volumes: [{ mount: 'E:', freeBytes: 10 }] }, { trigger: 'health.interval' });
    const explicitEvidence = runWorkstationStewardStorageFilesTurbo({ hardFailureEvidence: [], volumes: [{ mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 0, physicalDevicePath: 'disk0', freeBytes: 10, health: 'healthy', benchmark: { readBytesPerSecond: 1, writeBytesPerSecond: 1 } }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }] }, { trigger: 'health.interval' });
    const observation = runWorkstationStewardStorageFilesTurbo({ volumes: [{ mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 0, physicalDevicePath: 'disk0', freeBytes: 10, health: 'healthy' }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }] }, { trigger: 'health.interval' });
    expect(review.state).toBe('storage-safety-review');
    expect(explicitEvidence.state).toBe('evidence-ready');
    expect(observation.state).toBe('observation-review');
    expect(runWorkstationStewardStorageFilesTurbo({}, { trigger: 'health.interval' }).state).toBe('observation-required');
    expect(() => runWorkstationStewardStorageFilesTurbo([], { trigger: 'health.interval' })).toThrow('sample must be an object');
    expect(() => runWorkstationStewardStorageFilesTurbo({}, { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationStewardStorageFilesTurbo()).toThrow('Unsupported');
    expect(() => runWorkstationStewardStorageFilesTurbo({}, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });

  test('merges storage evidence and validates boundaries', () => {
    const make = (state, fields = {}) => turboReport('workstation-steward.storage-files', state, { duplicates: [], incomplete: [], placements: [], benchmarked: true, ...fields });
    expect(mergeWorkstationStewardStorageFilesReports([]).state).toBe('observation-required');
    expect(mergeWorkstationStewardStorageFilesReports([make('evidence-ready'), make('placement-review')])).toMatchObject({ state: 'placement-review', benchmarked: true });
    expect(mergeWorkstationStewardStorageFilesReports([make('placement-review'), make('evidence-ready')]).state).toBe('placement-review');
    expect(buildWorkstationStewardStorageFilesPlan(make('observation-required'), 'interactive').mode).toBe('evidence-collection');
    expect(buildWorkstationStewardStorageFilesPlan(make('placement-review')).mode).toBe('profile-required');
    expect(buildWorkstationStewardStorageFilesPlan(make('placement-review'), 'headless').mode).toBe('review-before-file-change');
    expect(buildWorkstationStewardStorageFilesEnvelope(make('evidence-ready'), { trigger: 'health.interval', now: () => 0 }).library).toContain('storage-files');
    expect(createWorkstationStewardStorageFilesLibrary().merge([make('evidence-ready')]).state).toBe('evidence-ready');
    expect(() => mergeWorkstationStewardStorageFilesReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStewardStorageFilesReports([{}])).toThrow('requires a storage-files');
    expect(() => mergeWorkstationStewardStorageFilesReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStewardStorageFilesReports([make('bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStewardStorageFilesReports([make('evidence-ready', { placements: null })])).toThrow('requires placements');
    expect(() => mergeWorkstationStewardStorageFilesReports(Array.from({ length: 65 }, () => make('evidence-ready')))).toThrow('at most 64');
    expect(() => buildWorkstationStewardStorageFilesPlan({})).toThrow('requires a storage-files');
    expect(() => buildWorkstationStewardStorageFilesEnvelope(make('evidence-ready'))).toThrow('trigger');
    expect(() => buildWorkstationStewardStorageFilesEnvelope(make('evidence-ready'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});

describe('workstation-steward history and media', () => {
  test('builds daily trend evidence and media assistant plans', () => {
    const history = runWorkstationStewardHistoryReportTurbo([{ storageFreeBytes: 10, batteryHealthPercent: 90, thermalMaxC: 70, memoryUsedBytes: 4 }, { freeBytes: 5, batteryHealth: 80, maxTemperatureC: 80, usedBytes: 8, cpuLoadPercent: 50, gpuLoadPercent: 60, networkConsumers: ['node'], workloads: ['build'], gamingPressure: 'warning', cleanupRecoveredBytes: 4 }], { trigger: 'health.interval', now: () => 0 });
    expect(history).toMatchObject({ state: 'report-ready', sampleCount: 2, trends: { storage: { state: 'falling' }, battery: { state: 'falling' }, thermal: { state: 'rising' }, memory: { state: 'rising' } } });
    expect(history.report.cleanup.recoveredBytes).toBe(4);
    expect(runWorkstationStewardHistoryReportTurbo([{ foo: 1 }], { trigger: 'health.interval' }).state).toBe('observation-required');
    expect(runWorkstationStewardHistoryReportTurbo([], { trigger: 'health.interval' }).state).toBe('insufficient-data');
    expect(runWorkstationStewardHistoryReportTurbo([{ storageFreeBytes: 5 }], { trigger: 'health.interval' }).trends.storage.state).toBe('single-observation');
    expect(runWorkstationStewardHistoryReportTurbo([{ storageFreeBytes: 5 }, { storageFreeBytes: 5, batteryHealthPercent: 90, thermalMaxC: 70, memoryUsedBytes: 4 }], { trigger: 'health.interval' }).trends.storage.state).toBe('stable');
    expect(() => runWorkstationStewardHistoryReportTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationStewardHistoryReportTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationStewardHistoryReportTurbo()).toThrow('unknown');
    expect(() => runWorkstationStewardHistoryReportTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    const make = (state, fields = {}) => turboReport('workstation-steward.history-report', state, { sampleCount: 1, ...fields });
    expect(mergeWorkstationStewardHistoryReportReports([]).state).toBe('insufficient-data');
    expect(mergeWorkstationStewardHistoryReportReports([make('report-ready')])).toMatchObject({ state: 'report-ready', sampleCount: 1 });
    expect(buildWorkstationStewardHistoryReportPlan(make('report-ready'), 'interactive').mode).toBe('deliver-reviewable-report');
    expect(buildWorkstationStewardHistoryReportPlan(make('observation-required'), 'interactive').mode).toBe('collect-more-history');
    expect(buildWorkstationStewardHistoryReportPlan(make('observation-required')).mode).toBe('profile-required');
    expect(buildWorkstationStewardHistoryReportEnvelope(make('report-ready'), { trigger: 'health.interval', now: () => 0 }).library).toContain('history-report');
    expect(createWorkstationStewardHistoryReportLibrary().merge([make('report-ready')]).state).toBe('report-ready');
    expect(() => mergeWorkstationStewardHistoryReportReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStewardHistoryReportReports([{}])).toThrow('requires a history-report');
    expect(() => mergeWorkstationStewardHistoryReportReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStewardHistoryReportReports([make('bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStewardHistoryReportReports([make('report-ready', { report: null })])).toThrow('requires a daily report');
    expect(() => mergeWorkstationStewardHistoryReportReports(Array.from({ length: 65 }, () => make('report-ready')))).toThrow('at most 64');
    expect(() => buildWorkstationStewardHistoryReportPlan({})).toThrow('requires a history-report');
    expect(() => buildWorkstationStewardHistoryReportEnvelope(make('report-ready'))).toThrow('trigger');
    expect(() => buildWorkstationStewardHistoryReportEnvelope(make('report-ready'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');

    const media = runWorkstationStewardMediaAssistantTurbo({ media: [{ path: 'a.mp3', type: 'music', sha256: hash }, { path: 'b.mp3', type: 'music', sha256: hash }, { type: 'video', sha256: 'b'.repeat(64) }, {}], tracks: [{ path: 'a.mp3', title: 'A', favorite: true }, { path: '', title: '' }, {}], playlists: [{ name: 'Morning', tracks: ['a.mp3'] }, { tracks: 'bad' }, {}], query: 'Can I run this game while my build finishes?', panelUrls: ['https://www.youtube.com/watch?v=1', 'http://bad.example', 'nope', ''] , receipts: [{ id: 'move-1', status: 'verified' }, { id: 'move-2' }, {}] }, { trigger: 'workload.changed', now: () => 0 });
    expect(media).toMatchObject({ state: 'review-ready', intent: 'workload-coexistence', plan: 'review-workload-coexistence', mediaCount: 4 });
    expect(media.duplicateGroups).toHaveLength(1);
    expect(media.panel.map((item) => item.state)).toEqual(['reviewable', 'refused', 'invalid', 'invalid']);
    expect(media.actionHistory[0]).toMatchObject({ id: 'move-1', undoToken: 'undo:move-1', reversible: true });
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'what is eating all my RAM?' }, { trigger: 'system.facts.request' }).intent).toBe('memory-diagnosis');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'Can I play this game while it finishes?' }, { trigger: 'health.interval' }).intent).toBe('workload-coexistence');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'why is my C drive full?' }, { trigger: 'health.interval' }).intent).toBe('storage-diagnosis');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'clean what is already classified as safe' }, { trigger: 'health.interval' }).intent).toBe('safe-cleanup-preview');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'move downloads to E:' }, { trigger: 'health.interval' }).intent).toBe('file-move-preview');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'how healthy is my battery?' }, { trigger: 'health.interval' }).intent).toBe('battery-health');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'what changed since yesterday?' }, { trigger: 'health.interval' }).intent).toBe('daily-diff');
    expect(runWorkstationStewardMediaAssistantTurbo({ query: 'hello' }, { trigger: 'health.interval' }).intent).toBe('unknown');
    expect(runWorkstationStewardMediaAssistantTurbo({}, { trigger: 'health.interval' }).state).toBe('observation-required');
    expect(() => runWorkstationStewardMediaAssistantTurbo()).toThrow('unknown');
    expect(() => runWorkstationStewardMediaAssistantTurbo([], { trigger: 'health.interval' })).toThrow('sample must be an object');
    expect(() => runWorkstationStewardMediaAssistantTurbo({}, { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationStewardMediaAssistantTurbo({}, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    const makeMedia = (state, fields = {}) => turboReport('workstation-steward.media-assistant', state, { mediaCount: 1, ...fields });
    expect(mergeWorkstationStewardMediaAssistantReports([]).state).toBe('observation-required');
    expect(mergeWorkstationStewardMediaAssistantReports([makeMedia('review-ready')])).toMatchObject({ state: 'review-ready', mediaCount: 1 });
    expect(mergeWorkstationStewardMediaAssistantReports([makeMedia('observation-required', { intent: 'storage-diagnosis', mediaCount: 0 })])).toMatchObject({ mediaCount: 0, queryIntents: ['storage-diagnosis'] });
    expect(buildWorkstationStewardMediaAssistantPlan(makeMedia('review-ready'), 'interactive').mode).toBe('approval-review');
    expect(buildWorkstationStewardMediaAssistantPlan(makeMedia('observation-required'), 'interactive').mode).toBe('catalogue-observation');
    expect(buildWorkstationStewardMediaAssistantPlan(makeMedia('observation-required'), 'interactive').mode).toBe('catalogue-observation');
    expect(buildWorkstationStewardMediaAssistantPlan(makeMedia('observation-required')).mode).toBe('profile-required');
    expect(buildWorkstationStewardMediaAssistantEnvelope(makeMedia('review-ready'), { trigger: 'health.interval', now: () => 0 }).library).toContain('media-assistant');
    expect(createWorkstationStewardMediaAssistantLibrary().merge([makeMedia('review-ready')]).state).toBe('review-ready');
    expect(() => mergeWorkstationStewardMediaAssistantReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStewardMediaAssistantReports([{}])).toThrow('requires a media-assistant');
    expect(() => mergeWorkstationStewardMediaAssistantReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStewardMediaAssistantReports([makeMedia('bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStewardMediaAssistantReports([makeMedia('review-ready', { actionHistory: null })])).toThrow('requires action history');
    expect(() => mergeWorkstationStewardMediaAssistantReports(Array.from({ length: 65 }, () => makeMedia('review-ready')))).toThrow('at most 64');
    expect(() => buildWorkstationStewardMediaAssistantPlan({})).toThrow('requires a media-assistant');
    expect(() => buildWorkstationStewardMediaAssistantEnvelope(makeMedia('review-ready'))).toThrow('trigger');
    expect(() => buildWorkstationStewardMediaAssistantEnvelope(makeMedia('review-ready'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});
