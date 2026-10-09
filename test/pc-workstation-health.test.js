import {
  runWorkstationHealthEngine,
  WORKSTATION_HEALTH_ENGINE_ID,
  WORKSTATION_HEALTH_TRIGGERS
} from '../pc/engines/workstation-health/engine.js';
import {
  mergeWorkstationHealthReports,
  buildWorkstationHealthPlan,
  buildWorkstationHealthEnvelope,
  createWorkstationHealthLibrary,
  WORKSTATION_HEALTH_LIBRARY_ID
} from '../pc/engines/workstation-health/library.js';
import { runWorkstationStorageTrendTurbo } from '../pc/engines/workstation-health/turbos/storage-trend/turbo.js';
import { mergeWorkstationStorageTrendReports, buildWorkstationStorageTrendPlan, buildWorkstationStorageTrendEnvelope, createWorkstationStorageTrendLibrary } from '../pc/engines/workstation-health/turbos/storage-trend/library.js';
import { runWorkstationResourcePressureTurbo } from '../pc/engines/workstation-health/turbos/resource-pressure/turbo.js';
import { mergeWorkstationResourcePressureReports, buildWorkstationResourcePressurePlan, buildWorkstationResourcePressureEnvelope, createWorkstationResourcePressureLibrary } from '../pc/engines/workstation-health/turbos/resource-pressure/library.js';
import { runWorkstationWorkloadConflictTurbo } from '../pc/engines/workstation-health/turbos/workload-conflict/turbo.js';
import { mergeWorkstationWorkloadConflictReports, buildWorkstationWorkloadConflictPlan, buildWorkstationWorkloadConflictEnvelope, createWorkstationWorkloadConflictLibrary } from '../pc/engines/workstation-health/turbos/workload-conflict/library.js';
import { runWorkstationCleanupAuditTurbo } from '../pc/engines/workstation-health/turbos/cleanup-audit/turbo.js';
import { mergeWorkstationCleanupAuditReports, buildWorkstationCleanupAuditPlan, buildWorkstationCleanupAuditEnvelope, createWorkstationCleanupAuditLibrary } from '../pc/engines/workstation-health/turbos/cleanup-audit/library.js';

const completeFacts = {
  engine: 'system-facts', environment: 'interactive',
  storage: [{ mount: 'C:', totalBytes: 1000, freeBytes: 500 }],
  storagePressure: { level: 'normal', totalBytes: 1000, freeBytes: 500 },
  storageHealth: { health: 'healthy' },
  cpu: { utilizationPercent: 30 }, memory: { totalBytes: 1000, availableBytes: 700 },
  gpu: { loadPercent: 30 }, thermal: { maxTemperatureC: 60 },
  battery: { present: true, chargePercent: 70, health: 'healthy', charging: true },
  processes: [{ name: 'editor', state: 'running' }],
  workload: { activeClasses: ['development'], foregroundClass: 'editor' },
  cleanupAudit: { performed: false, recoveredBytes: 0, actionCount: 0 }
};

function report(overrides = {}) {
  return { engine: 'workstation-health', state: 'healthy', confidence: 1, problemCodes: [], recommendations: ['no-change'], generatedAt: '2026-01-01T00:00:00.000Z', environment: 'interactive', storage: { freeBytes: 500, pressureLevel: 'normal' }, resources: { cpuLoadPercent: 20, gpuLoadPercent: 20, memoryPressure: 'normal', thermalState: 'normal' }, battery: { present: true }, processes: { abnormalCount: 0 }, workload: { activeClasses: [], contentionRisk: false }, cleanup: { performed: false, recoveredBytes: 0, actionCount: 0 }, ...overrides };
}

function turboReport(turbo, state, fields = {}) { return { turbo, state, confidence: 1, sampleCount: 1, ...fields }; }

describe('workstation-health engine', () => {
  test('publishes identity and a complete healthy report', () => {
    expect(WORKSTATION_HEALTH_ENGINE_ID).toBe('workstation-health');
    expect(WORKSTATION_HEALTH_TRIGGERS).toEqual(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
    const result = runWorkstationHealthEngine(completeFacts, { trigger: 'health.interval', now: () => 0 });
    expect(result).toMatchObject({ engine: 'workstation-health', state: 'healthy', period: 'daily', confidence: 1 });
    expect(result.storage.freePercent).toBe(50);
    expect(result.resources.memoryPressure).toBe('normal');
    expect(result.actions).toEqual([]);
  });

  test('normalizes native telemetry shapes for thermal, GPU, battery, drive, and pagefile evidence', () => {
    const native = runWorkstationHealthEngine({ ...completeFacts, thermal: undefined, thermals: { maxTemperatureC: 82, thermalThrottling: true }, storageHealth: undefined, drives: { drives: [{ health: 'failed' }] }, gpu: { loadPercent: 30, temperatureC: 88 }, battery: { available: true, batteries: [{ capacityPercent: 70, healthPercent: 90, status: 'Charging' }] }, pagefile: { pressurePercent: 85 } }, { trigger: 'health.interval', now: () => 500 });
    expect(native).toMatchObject({ state: 'critical', storage: { health: 'failed' }, resources: { temperatureC: 82, gpuTemperatureC: 88, peakTemperatureC: 88, thermalState: 'critical', thermalThrottling: true, pagefilePressurePercent: 85 }, battery: { present: true, chargePercent: 70, health: 'healthy', charging: true } });
    expect(native.problemCodes).toEqual(expect.arrayContaining(['drive-health-failed', 'thermal-throttling', 'pagefile-pressure-high']));
    const low = runWorkstationHealthEngine({ ...completeFacts, storageHealth: undefined, drives: { drives: [{ health: 'degraded' }] }, gpu: { temperature: 72 }, thermal: { maxTemperatureC: 70 }, battery: { available: true, batteries: [{ capacityPercent: 10, healthPercent: 50, status: 'Discharging' }] }, pagefile: { pressurePercent: 95 } }, { trigger: 'health.interval', now: () => 501 });
    expect(low).toMatchObject({ state: 'critical', storage: { health: 'degraded' }, resources: { gpuTemperatureC: 72, peakTemperatureC: 72, pagefilePressurePercent: 95 }, battery: { health: 'failed', charging: false } });
    expect(low.problemCodes).toContain('pagefile-pressure-critical');
    const mid = runWorkstationHealthEngine({ ...completeFacts, battery: { available: true, batteries: [{ capacityPercent: 40, healthPercent: 70 }] } }, { trigger: 'health.interval', now: () => 502 });
    expect(mid.battery.health).toBe('degraded');
    const emptyBattery = runWorkstationHealthEngine({ ...completeFacts, battery: { available: true, batteries: [] } }, { trigger: 'health.interval', now: () => 503 });
    expect(emptyBattery.battery.present).toBe(true);
  });

  test('reports critical pressure, health, thermal, battery, process, and workload evidence', () => {
    const result = runWorkstationHealthEngine({ ...completeFacts, storage: [], storagePressure: { level: 'emergency', freeBytes: 1, totalBytes: 100 }, storageHealth: { health: 'failed' }, memory: { pressure: 'critical' }, thermal: { maxTemperatureC: 100, throttling: true }, battery: { present: true, chargePercent: 5, health: 'failed' }, processes: [{ name: 'broken', state: 'crashed' }, { name: 'bad', abnormal: true }, { name: 'dead', health: 'failed' }], workload: { activeClasses: ['gaming', 'ai'], foregroundClass: 'game' }, cleanupAudit: { performed: true, removedBytes: 12, actionCount: 2 } }, { trigger: 'workload.changed', now: () => 1000 });
    expect(result.state).toBe('critical');
    expect(result.problemCodes).toEqual(expect.arrayContaining(['storage-pressure-critical', 'drive-health-failed', 'memory-pressure-critical', 'thermal-throttling', 'battery-health-failed', 'abnormal-processes', 'workload-contention']));
    expect(result.processes).toMatchObject({ abnormalCount: 3, abnormalNames: ['broken', 'bad', 'dead'] });
    expect(result.cleanup).toMatchObject({ performed: true, recoveredBytes: 12, actionCount: 2 });
  });

  test('derives memory pressure and handles alternate storage and thermal evidence', () => {
    const warning = runWorkstationHealthEngine({ ...completeFacts, storage: [{ mount: 'D:', totalBytes: 100, freeBytes: 20 }], storagePressure: undefined, memory: { totalBytes: 100, availableBytes: 4 }, cpu: { loadPercent: 80 }, gpu: { utilizationPercent: 80, temperature: 86 }, thermal: { maxTemperatureC: 85 }, battery: { present: false, charging: false, health: 'unknown' }, processes: undefined, workload: undefined, cleanupAudit: undefined }, { trigger: 'system.facts.request', now: () => 2000 });
    expect(warning.storage.freePercent).toBe(20);
    expect(warning.resources.memoryPressure).toBe('critical');
    expect(warning.resources.thermalState).toBe('warning');
    expect(warning.battery.present).toBe(false);
    const normal = runWorkstationHealthEngine({ ...completeFacts, storage: [{ mount: '/', totalBytes: 100, freeBytes: 50 }], storagePressure: undefined, memory: { totalBytes: 100, availableBytes: 90 }, thermal: { maxTemperatureC: 70 } }, { trigger: 'install.preflight', now: () => 3000 });
    expect(normal.resources.memoryPressure).toBe('normal');
    expect(normal.resources.thermalState).toBe('normal');
  });

  test('fails closed for incomplete and invalid observations', () => {
    const result = runWorkstationHealthEngine({ engine: 'workstation-health-input', environment: 'other', storage: [{ totalBytes: -1, freeBytes: -1 }], memory: {}, cpu: {}, gpu: {}, thermal: {}, battery: {} }, { trigger: 'health.interval', now: () => 4000 });
    expect(result).toMatchObject({ environment: 'unknown', state: 'observation-required', confidence: 0 });
    expect(result.problemCodes).toContain('storage-observation-required');
    expect(() => runWorkstationHealthEngine({}, { trigger: 'health.interval' })).toThrow('requires system-facts');
    expect(() => runWorkstationHealthEngine({ engine: 'wrong' }, { trigger: 'health.interval' })).toThrow('requires system-facts');
    expect(() => runWorkstationHealthEngine(completeFacts, { trigger: 'bad' })).toThrow('Unsupported workstation-health trigger: bad');
    expect(() => runWorkstationHealthEngine(completeFacts, { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });

  test('reports warning dimensions and exercises fallback observation paths', () => {
    const result = runWorkstationHealthEngine({ ...completeFacts, storage: [{ mount: 'E:', totalBytes: 100, freeBytes: 10 }], storagePressure: { level: 'warning', freePercent: 10 }, storageHealth: { health: 'degraded' }, memory: { pressure: 'warning', usedBytes: 90, totalBytes: 100 }, cpu: {}, gpu: {}, thermal: { maxTemperatureC: null }, battery: { present: true, chargePercent: 110, health: 'degraded', charging: false }, processes: [{ name: '', state: 'running' }], workload: { activeClasses: ['GAMING', 'DEVELOPMENT'], foregroundClass: 'game', latencySensitive: true }, cleanupAudit: { performed: false, recoveredBytes: -1, actionCount: -1 } }, { trigger: 'health.interval' });
    expect(result.state).toBe('warning');
    expect(result.problemCodes).toEqual(expect.arrayContaining(['storage-pressure-warning', 'drive-health-degraded', 'memory-pressure-warning', 'battery-health-degraded', 'workload-contention']));
    expect(result.recommendations).toEqual(expect.arrayContaining(['review-storage-pressure-preview', 'review-drive-health', 'review-memory-pressure', 'review-battery-condition', 'review-workload-policy']));
    expect(result.resources.cpuLoadPercent).toBeNull();
    expect(result.resources.thermalState).toBe('unknown');
    expect(result.cleanup.recoveredBytes).toBe(0);
    expect(() => runWorkstationHealthEngine(null, { trigger: 'health.interval' })).toThrow('facts must be an object');
    expect(() => runWorkstationHealthEngine(completeFacts)).toThrow('Unsupported workstation-health trigger: unknown');
    expect(() => runWorkstationHealthEngine({ engine: 'workstation-health-input' }, { trigger: 'health.interval' })).not.toThrow();
    const missingFree = runWorkstationHealthEngine({ ...completeFacts, storage: [{ mount: 'C:', totalBytes: 100, freeBytes: 'bad' }], storagePressure: undefined }, { trigger: 'health.interval', now: () => 4001 });
    expect(missingFree.storage).toMatchObject({ totalBytes: 100, freeBytes: null, pressureLevel: 'unknown' });
  });
});

describe('workstation-health library', () => {
  test('merges reports, builds plans, envelopes, and exposes a frozen library', () => {
    const critical = report({ state: 'critical', problemCodes: ['storage-pressure-critical'], cleanup: { recoveredBytes: 10 } });
    expect(WORKSTATION_HEALTH_LIBRARY_ID).toBe('workstation-health-library');
    expect(mergeWorkstationHealthReports([])).toMatchObject({ state: 'observation-required', confidence: 0 });
    expect(mergeWorkstationHealthReports([report(), critical])).toMatchObject({ state: 'critical', cleanupRecoveredBytes: 10, problemCodes: ['storage-pressure-critical'] });
    expect(mergeWorkstationHealthReports([report({ state: 'warning' })]).state).toBe('warning');
    expect(mergeWorkstationHealthReports([report({ state: 'observation-required' })]).state).toBe('observation-required');
    expect(mergeWorkstationHealthReports([report()]).state).toBe('healthy');
    expect(mergeWorkstationHealthReports([report({ cleanup: null })]).cleanupRecoveredBytes).toBe(0);
    expect(mergeWorkstationHealthReports([report({ environment: '' })]).environment).toBe('unknown');
    expect(buildWorkstationHealthPlan(critical, 'unknown').mode).toBe('profile-required');
    expect(buildWorkstationHealthPlan(critical, 'other').environment).toBe('unknown');
    expect(buildWorkstationHealthPlan(critical, 'interactive').intervalMs).toBe(300000);
    expect(buildWorkstationHealthPlan(report({ state: 'warning' }), 'interactive').intervalMs).toBe(3600000);
    expect(buildWorkstationHealthPlan(report({ state: 'observation-required' }), 'headless').intervalMs).toBe(900000);
    expect(buildWorkstationHealthPlan(report(), 'headless').intervalMs).toBe(86400000);
    const envelope = buildWorkstationHealthEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(createWorkstationHealthLibrary().merge([]).state).toBe('observation-required');
    expect(buildWorkstationHealthPlan(report(), 'interactive').intervalMs).toBe(86400000);
    expect(buildWorkstationHealthEnvelope(report(), { trigger: 'health.interval' }).library).toBe(WORKSTATION_HEALTH_LIBRARY_ID);
  });

  test('rejects malformed reports and plan envelopes', () => {
    expect(() => mergeWorkstationHealthReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationHealthReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64');
    expect(() => mergeWorkstationHealthReports([{}])).toThrow('requires a workstation-health report');
    expect(() => mergeWorkstationHealthReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationHealthReports([report({ state: 'bad' })])).toThrow('invalid state');
    expect(() => mergeWorkstationHealthReports([report({ confidence: 2 })])).toThrow('confidence');
    expect(() => mergeWorkstationHealthReports([report({ problemCodes: null })])).toThrow('problem and recommendation');
    expect(() => buildWorkstationHealthPlan({})).toThrow('requires a workstation-health report');
    expect(() => buildWorkstationHealthEnvelope(report(), {})).toThrow('trigger is required');
    expect(() => buildWorkstationHealthEnvelope(report())).toThrow('trigger is required');
    expect(() => buildWorkstationHealthEnvelope(report(), { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});

describe('workstation-health turbos and libraries', () => {
  test('tracks storage trend and validates its boundaries', () => {
    const loss = runWorkstationStorageTrendTurbo([report({ storage: { freeBytes: 500 } }), report({ storage: { freeBytes: 400 } })], { trigger: 'health.interval', now: () => 0 });
    const gain = runWorkstationStorageTrendTurbo([report({ storage: { freeBytes: 400 } }), report({ storage: { freeBytes: 500 } })], { trigger: 'health.interval', now: () => 0 });
    const stable = runWorkstationStorageTrendTurbo([report({ storage: { freeBytes: 500, pressureLevel: 'normal' } }), report({ storage: { freeBytes: 500 } })], { trigger: 'health.interval', now: () => 0 });
    const unknown = runWorkstationStorageTrendTurbo([report({ storage: { freeBytes: null } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(loss.state).toBe('free-space-loss'); expect(gain.state).toBe('free-space-gain'); expect(stable.state).toBe('stable-free-space'); expect(unknown.state).toBe('observation-required');
    const empty = runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', now: () => 0 }); expect(empty.state).toBe('insufficient-data');
    expect(mergeWorkstationStorageTrendReports([]).state).toBe('insufficient-data');
    expect(mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'free-space-loss', { observedCount: 2, finalFreeBytes: 400, deltaBytes: -100 })])).toMatchObject({ state: 'free-space-loss' });
    expect(mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'free-space-gain')]).state).toBe('free-space-gain');
    expect(mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'observation-required')]).state).toBe('observation-required');
    expect(mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'stable-free-space')]).state).toBe('stable-free-space');
    expect(mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'insufficient-data')]).state).toBe('insufficient-data');
    expect(buildWorkstationStorageTrendPlan(turboReport('workstation-health.storage-trend', 'free-space-loss'), 'interactive').intervalMs).toBe(900000);
    expect(buildWorkstationStorageTrendPlan(turboReport('workstation-health.storage-trend', 'stable-free-space'), 'unknown').mode).toBe('profile-required');
    expect(buildWorkstationStorageTrendPlan(turboReport('workstation-health.storage-trend', 'stable-free-space'), 'interactive').mode).toBe('storage-observation');
    expect(buildWorkstationStorageTrendEnvelope(turboReport('workstation-health.storage-trend', 'stable-free-space'), { trigger: 'health.interval', now: () => 0 }).library).toContain('storage-trend');
    expect(createWorkstationStorageTrendLibrary().merge([]).state).toBe('insufficient-data');
    expect(buildWorkstationStorageTrendPlan(turboReport('workstation-health.storage-trend', 'stable-free-space')).mode).toBe('profile-required');
    expect(buildWorkstationStorageTrendEnvelope(turboReport('workstation-health.storage-trend', 'stable-free-space'), { trigger: 'health.interval' }).generatedAt).toBeTruthy();
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow('windowSize');
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples');
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 0 })).toThrow('minimumSamples');
    expect(() => runWorkstationStorageTrendTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationStorageTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkstationStorageTrendReports([{}])).toThrow('requires a storage-trend');
    expect(() => mergeWorkstationStorageTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'stable-free-space', { confidence: 2 })])).toThrow('confidence');
    expect(() => mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'stable-free-space', { confidence: NaN })])).toThrow('confidence');
    expect(() => mergeWorkstationStorageTrendReports([turboReport('workstation-health.storage-trend', 'stable-free-space', { sampleCount: -1 })])).toThrow('sampleCount');
    expect(() => mergeWorkstationStorageTrendReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationStorageTrendReports(Array.from({ length: 65 }, () => turboReport('workstation-health.storage-trend', 'stable-free-space')))).toThrow('at most 64');
    expect(() => buildWorkstationStorageTrendEnvelope(turboReport('workstation-health.storage-trend', 'stable-free-space'), { trigger: '' })).toThrow('trigger');
    expect(() => buildWorkstationStorageTrendEnvelope(turboReport('workstation-health.storage-trend', 'stable-free-space'))).toThrow('trigger');
    expect(() => buildWorkstationStorageTrendEnvelope(turboReport('workstation-health.storage-trend', 'stable-free-space'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationStorageTrendTurbo()).toThrow('Unsupported workstation-health storage-trend trigger: unknown');
    expect(() => runWorkstationStorageTrendTurbo([], {})).toThrow('Unsupported workstation-health storage-trend trigger: unknown');
    expect(() => runWorkstationStorageTrendTurbo([null], { trigger: 'health.interval' })).toThrow('report must be an object');
    expect(() => runWorkstationStorageTrendTurbo([report({ storage: null })], { trigger: 'health.interval', minimumSamples: 1 })).not.toThrow();
    expect(() => runWorkstationStorageTrendTurbo([report({ storage: { freeBytes: -1 } })], { trigger: 'health.interval', minimumSamples: 1 })).not.toThrow();
    expect(() => runWorkstationStorageTrendTurbo([{}], { trigger: 'health.interval' })).toThrow('requires workstation-health');
  });

  test('classifies resource pressure and validates resource reports', () => {
    const critical = runWorkstationResourcePressureTurbo([report({ resources: { memoryPressure: 'critical', thermalState: 'normal' } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const warning = runWorkstationResourcePressureTurbo([report({ resources: { cpuLoadPercent: 80 } }), report({ resources: { gpuLoadPercent: 80 } })], { trigger: 'health.interval', now: () => 0 });
    const stable = runWorkstationResourcePressureTurbo([report({ resources: { memoryPressure: 'normal', thermalState: 'normal' } }), report({ resources: { cpuLoadPercent: 20 } })], { trigger: 'health.interval', now: () => 0 });
    const stringWarning = runWorkstationResourcePressureTurbo([report({ resources: { memoryPressure: 'warning' } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const emergency = runWorkstationResourcePressureTurbo([report({ resources: { memoryPressure: 'emergency' } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const pagefileWarning = runWorkstationResourcePressureTurbo([report({ resources: { pagefilePressurePercent: 85 } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const pagefileCritical = runWorkstationResourcePressureTurbo([report({ resources: { pagefilePressurePercent: 95 } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const missing = runWorkstationResourcePressureTurbo([report({ resources: null })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(critical.state).toBe('critical-pressure'); expect(emergency.state).toBe('critical-pressure'); expect(pagefileWarning.state).toBe('pressure-observed'); expect(pagefileCritical.state).toBe('critical-pressure'); expect(warning.state).toBe('pressure-observed'); expect(stable.state).toBe('stable-resources'); expect(stringWarning.state).toBe('pressure-observed'); expect(missing.state).toBe('observation-required');
    expect(runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', now: () => 0 }).state).toBe('insufficient-data');
    const merged = mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'critical-pressure', { maximumPressure: 'critical', criticalCount: 1, warningCount: 0 })]); expect(merged.state).toBe('critical-pressure');
    expect(mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'pressure-observed')]).state).toBe('pressure-observed');
    expect(mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'observation-required')]).state).toBe('observation-required');
    expect(mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'insufficient-data')]).state).toBe('insufficient-data');
    expect(mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'stable-resources')]).state).toBe('stable-resources');
    expect(buildWorkstationResourcePressurePlan(turboReport('workstation-health.resource-pressure', 'critical-pressure'), 'interactive').intervalMs).toBe(300000);
    expect(buildWorkstationResourcePressurePlan(turboReport('workstation-health.resource-pressure', 'stable-resources'), 'unknown').mode).toBe('profile-required');
    expect(buildWorkstationResourcePressureEnvelope(turboReport('workstation-health.resource-pressure', 'stable-resources'), { trigger: 'health.interval', now: () => 0 }).library).toContain('resource-pressure');
    expect(createWorkstationResourcePressureLibrary().merge([]).state).toBe('insufficient-data');
    expect(buildWorkstationResourcePressurePlan(turboReport('workstation-health.resource-pressure', 'stable-resources'), 'interactive').mode).toBe('resource-observation');
    expect(buildWorkstationResourcePressurePlan(turboReport('workstation-health.resource-pressure', 'stable-resources')).mode).toBe('profile-required');
    expect(buildWorkstationResourcePressureEnvelope(turboReport('workstation-health.resource-pressure', 'stable-resources'), { trigger: 'health.interval' }).generatedAt).toBeTruthy();
    expect(() => runWorkstationResourcePressureTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow('windowSize');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 0 })).toThrow('minimumSamples');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkstationResourcePressureTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationResourcePressureTurbo([null], { trigger: 'health.interval' })).toThrow('report must be an object');
    expect(() => runWorkstationResourcePressureTurbo([{}], { trigger: 'health.interval' })).toThrow('requires workstation-health');
    expect(() => runWorkstationResourcePressureTurbo([report({ resources: { cpuLoadPercent: 95 } })], { trigger: 'health.interval', minimumSamples: 1 })).not.toThrow();
    expect(() => mergeWorkstationResourcePressureReports([{}])).toThrow('requires a resource-pressure');
    expect(() => mergeWorkstationResourcePressureReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'stable-resources', { confidence: 2 })])).toThrow('confidence');
    expect(() => mergeWorkstationResourcePressureReports([turboReport('workstation-health.resource-pressure', 'stable-resources', { confidence: NaN })])).toThrow('confidence');
    expect(() => mergeWorkstationResourcePressureReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationResourcePressureReports(Array.from({ length: 65 }, () => turboReport('workstation-health.resource-pressure', 'stable-resources')))).toThrow('at most 64');
    expect(() => buildWorkstationResourcePressureEnvelope(turboReport('workstation-health.resource-pressure', 'stable-resources'), { trigger: '' })).toThrow('trigger');
    expect(() => buildWorkstationResourcePressureEnvelope(turboReport('workstation-health.resource-pressure', 'stable-resources'))).toThrow('trigger');
    expect(() => buildWorkstationResourcePressureEnvelope(turboReport('workstation-health.resource-pressure', 'stable-resources'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationResourcePressureTurbo()).toThrow('Unsupported workstation-health resource-pressure trigger: unknown');
    expect(() => runWorkstationResourcePressureTurbo([], {})).toThrow('Unsupported workstation-health resource-pressure trigger: unknown');
    expect(() => runWorkstationResourcePressureTurbo([null], { trigger: 'health.interval' })).toThrow('report must be an object');
  });

  test('detects workload conflicts and audits cleanup evidence', () => {
    const conflict = runWorkstationWorkloadConflictTurbo([report({ workload: { activeClasses: ['gaming', 'build'], contentionRisk: true, foregroundClass: 'game' } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const noConflict = runWorkstationWorkloadConflictTurbo([report({ workload: { activeClasses: [], contentionRisk: false } }), report({ workload: { activeClasses: [], contentionRisk: false } })], { trigger: 'health.interval', now: () => 0 });
    const missingWorkload = runWorkstationWorkloadConflictTurbo([report({ workload: null })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const insufficientWorkload = runWorkstationWorkloadConflictTurbo([], { trigger: 'health.interval', now: () => 0 });
    expect(conflict.state).toBe('conflict-observed'); expect(noConflict.state).toBe('no-conflict'); expect(missingWorkload.state).toBe('observation-required'); expect(insufficientWorkload.state).toBe('insufficient-data');
    expect(mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'conflict-observed', { conflictCount: 1, observedCount: 1 })]).state).toBe('conflict-observed');
    expect(mergeWorkstationWorkloadConflictReports([]).state).toBe('insufficient-data');
    expect(mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'observation-required')]).state).toBe('observation-required');
    expect(mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'no-conflict')]).state).toBe('no-conflict');
    expect(mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'insufficient-data')]).state).toBe('insufficient-data');
    expect(buildWorkstationWorkloadConflictPlan(turboReport('workstation-health.workload-conflict', 'conflict-observed'), 'interactive').intervalMs).toBe(1500);
    expect(buildWorkstationWorkloadConflictPlan(turboReport('workstation-health.workload-conflict', 'no-conflict'), 'interactive').intervalMs).toBe(5000);
    expect(buildWorkstationWorkloadConflictPlan(turboReport('workstation-health.workload-conflict', 'no-conflict')).mode).toBe('profile-required');
    expect(buildWorkstationWorkloadConflictEnvelope(turboReport('workstation-health.workload-conflict', 'no-conflict'), { trigger: 'health.interval', now: () => 0 }).library).toContain('workload-conflict');
    expect(buildWorkstationWorkloadConflictEnvelope(turboReport('workstation-health.workload-conflict', 'no-conflict'), { trigger: 'health.interval' }).generatedAt).toBeTruthy();
    expect(createWorkstationWorkloadConflictLibrary().merge([]).state).toBe('insufficient-data');
    const recovery = runWorkstationCleanupAuditTurbo([report({ cleanup: { performed: true, recoveredBytes: 20, actionCount: 2 } })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const noCleanup = runWorkstationCleanupAuditTurbo([report({ cleanup: { performed: false, recoveredBytes: 0, actionCount: 0 } }), report({ cleanup: { performed: false } })], { trigger: 'health.interval', now: () => 0 });
    const missingCleanup = runWorkstationCleanupAuditTurbo([report({ cleanup: null })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const insufficientCleanup = runWorkstationCleanupAuditTurbo([], { trigger: 'health.interval', now: () => 0 });
    expect(recovery.state).toBe('recovery-observed'); expect(noCleanup.state).toBe('no-cleanup'); expect(missingCleanup.state).toBe('cleanup-not-observed'); expect(insufficientCleanup.state).toBe('insufficient-data');
    expect(mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'recovery-observed', { performedCount: 1, recoveredBytes: 20, actionCount: 2 })])).toMatchObject({ state: 'recovery-observed', recoveredBytes: 20 });
    expect(mergeWorkstationCleanupAuditReports([]).state).toBe('insufficient-data');
    expect(mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'cleanup-not-observed')]).state).toBe('cleanup-not-observed');
    expect(mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'no-cleanup')]).state).toBe('no-cleanup');
    expect(mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'insufficient-data')]).state).toBe('insufficient-data');
    expect(buildWorkstationCleanupAuditPlan(turboReport('workstation-health.cleanup-audit', 'recovery-observed'), 'unknown').mode).toBe('profile-required');
    expect(buildWorkstationCleanupAuditPlan(turboReport('workstation-health.cleanup-audit', 'no-cleanup'), 'interactive').mode).toBe('cleanup-observation');
    expect(buildWorkstationCleanupAuditPlan(turboReport('workstation-health.cleanup-audit', 'recovery-observed'), 'interactive').mode).toBe('recovery-review');
    expect(buildWorkstationCleanupAuditPlan(turboReport('workstation-health.cleanup-audit', 'no-cleanup')).mode).toBe('profile-required');
    expect(buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'), { trigger: 'health.interval', now: () => 0 }).library).toContain('cleanup-audit');
    expect(buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'), { trigger: 'health.interval' }).generatedAt).toBeTruthy();
    expect(createWorkstationCleanupAuditLibrary().merge([]).state).toBe('insufficient-data');
    expect(() => runWorkstationWorkloadConflictTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationCleanupAuditTurbo({}, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkstationWorkloadConflictTurbo([], {})).toThrow('Unsupported');
    expect(() => runWorkstationCleanupAuditTurbo([], {})).toThrow('Unsupported');
    expect(() => runWorkstationWorkloadConflictTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkstationCleanupAuditTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkstationWorkloadConflictTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples');
    expect(() => runWorkstationCleanupAuditTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples');
    expect(() => runWorkstationWorkloadConflictTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationCleanupAuditTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkstationWorkloadConflictTurbo([null], { trigger: 'health.interval' })).toThrow('report must be an object');
    expect(() => runWorkstationCleanupAuditTurbo([null], { trigger: 'health.interval' })).toThrow('report must be an object');
    expect(() => runWorkstationWorkloadConflictTurbo([{}], { trigger: 'health.interval' })).toThrow('requires workstation-health');
    expect(() => runWorkstationCleanupAuditTurbo([{}], { trigger: 'health.interval' })).toThrow('requires workstation-health');
    expect(() => runWorkstationWorkloadConflictTurbo()).toThrow('Unsupported workstation-health workload-conflict trigger: unknown');
    expect(() => runWorkstationCleanupAuditTurbo()).toThrow('Unsupported workstation-health cleanup-audit trigger: unknown');
    expect(() => mergeWorkstationWorkloadConflictReports([{}])).toThrow('requires a workload-conflict');
    expect(() => mergeWorkstationWorkloadConflictReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'no-conflict', { confidence: NaN })])).toThrow('confidence');
    expect(() => mergeWorkstationCleanupAuditReports([{}])).toThrow('requires a cleanup-audit');
    expect(() => mergeWorkstationCleanupAuditReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkstationWorkloadConflictReports([turboReport('workstation-health.workload-conflict', 'no-conflict', { confidence: 2 })])).toThrow('confidence');
    expect(() => mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'no-cleanup', { confidence: 2 })])).toThrow('confidence');
    expect(() => mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'bad')])).toThrow('invalid state');
    expect(() => mergeWorkstationCleanupAuditReports([turboReport('workstation-health.cleanup-audit', 'no-cleanup', { confidence: NaN })])).toThrow('confidence');
    expect(() => mergeWorkstationWorkloadConflictReports()).toThrow('reports must be an array');
    expect(() => mergeWorkstationCleanupAuditReports()).toThrow('reports must be an array');
    expect(() => buildWorkstationWorkloadConflictEnvelope(turboReport('workstation-health.workload-conflict', 'no-conflict'), { trigger: '' })).toThrow('trigger');
    expect(() => buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'), { trigger: '' })).toThrow('trigger');
    expect(() => buildWorkstationWorkloadConflictEnvelope(turboReport('workstation-health.workload-conflict', 'no-conflict'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'))).toThrow('trigger');
    expect(() => mergeWorkstationWorkloadConflictReports(Array.from({ length: 65 }, () => turboReport('workstation-health.workload-conflict', 'no-conflict')))).toThrow('at most 64');
    expect(() => mergeWorkstationCleanupAuditReports(Array.from({ length: 65 }, () => turboReport('workstation-health.cleanup-audit', 'no-cleanup')))).toThrow('at most 64');
    expect(() => buildWorkstationWorkloadConflictEnvelope(turboReport('workstation-health.workload-conflict', 'no-conflict'))).toThrow('trigger is required');
    expect(() => buildWorkstationCleanupAuditEnvelope(turboReport('workstation-health.cleanup-audit', 'no-cleanup'))).toThrow('trigger is required');
  });
});
