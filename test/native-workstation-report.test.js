/**
 * Native workstation report tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { buildDailyWorkstationReport, WORKSTATION_REPORT_VERSION } from '../native/workstation-report.js';

function facts(overrides = {}) {
  return {
    storage: [{ mount: 'C:', totalBytes: 1000, freeBytes: 500 }],
    storagePressure: { totalBytes: 1000, freeBytes: 500, level: 'normal' },
    memory: { totalBytes: 1000, freeBytes: 700 },
    cpu: { loadPercent: 20 },
    gpu: { loadPercent: 30, memoryUsedBytes: 100, memoryTotalBytes: 600 },
    thermals: { maxTemperatureC: 60, throttling: false },
    fans: { available: true, fans: [{ name: 'cpu', rpm: 1800 }] },
    battery: { available: true, batteries: [{ capacityPercent: 80, healthPercent: 90, cycleCount: 10 }] },
    pagefile: { pressurePercent: 20, allocatedBytes: 500, currentBytes: 100 },
    processes: [{ name: 'editor', memoryBytes: 200, state: 'running' }],
    network: { interfaces: [{ receivedBytes: 1000, sentBytes: 500 }] },
    workload: { activeClasses: ['development'] },
    drives: { available: true, drives: [{ health: 'healthy', mediaType: 'ssd' }] },
    ...overrides
  };
}

function entry(timestamp, source = facts(), overrides = {}) {
  return { id: `report-${timestamp}`, event: 'report', timestamp, facts: source, report: { game: { detected: false } }, ...overrides };
}

describe('native workstation daily report', () => {
  test('aggregates cross-platform storage, resource, thermal, battery, pagefile, process, network, workload, and cleanup evidence', () => {
    const result = buildDailyWorkstationReport([
      entry(60000),
      entry(120000, facts({ storagePressure: { freeBytes: 50, totalBytes: 1000, level: 'critical', belowTargetFreeFloor: true }, memory: { totalBytes: 1000, availableBytes: 40 }, cpu: { utilizationPercent: 80 }, gpu: { utilizationPercent: 90, temperatureC: 88, memoryUsedBytes: 400, thermalThrottling: true }, thermals: { maxTemperatureC: 96, throttling: true }, battery: { available: true, batteries: [{ capacityPercent: 20, healthPercent: 70, cycleCount: 20 }] }, pagefile: { pressurePercent: 90, currentBytes: 400 }, processes: [{ name: 'bad', memoryBytes: 300, state: 'crashed' }], network: { interfaces: [{ receivedBytes: 2000, sentBytes: 1000 }] }, workload: { activeClasses: ['gaming', 'ai'] }, drives: { available: true, drives: [{ health: 'degraded' }, { health: 'failed' }] }, cleanupAudit: { performed: true, recoveredBytes: 42, actionCount: 2 } }), { report: { game: { detected: true } } })
    ], { now: () => 120000, windowMs: 60000 });
    expect(result).toMatchObject({ version: WORKSTATION_REPORT_VERSION, period: 'daily', sampleCount: 2, storage: { minimumFreeBytes: 50, latestFreeBytes: 50, pressureEvents: 1 }, memory: { peakUsedBytes: 960, peakUsedPercent: 96, pressureEvents: 1 }, cpuGpu: { peakCpuPercent: 80, peakGpuPercent: 90, peakGpuTemperatureC: 88, latestGpuTemperatureC: 88, latestGpuMemoryUsedBytes: 400, gpuThermalThrottleEvents: 1 }, thermals: { peakTemperatureC: 96, throttleEvents: 1 }, fans: { peakRpm: 1800, latestRpm: 1800, latestFanCount: 1, observedSamples: 2 }, battery: { latestChargePercent: 20, minimumHealthPercent: 70, latestCycleCount: 20 }, pagefile: { peakPressurePercent: 90, latestCurrentBytes: 400, pressureEvents: 1 }, drives: { latestCount: 2, latestDegradedCount: 1, latestFailedCount: 1, observedSamples: 2 }, processes: { peakCount: 1, abnormalEvents: 1 }, network: { latestReceivedBytes: 2000, latestSentBytes: 1000, latestReceivedBytesPerSecond: 1000 / 60, latestSentBytesPerSecond: 500 / 60, peakReceivedBytesPerSecond: 1000 / 60, peakSentBytesPerSecond: 500 / 60, rateSamples: 1, counterResetEvents: 0, latestRateState: 'rate-ready' }, development: { contentionEvents: 1 }, gaming: { detectedEvents: 1, contentionEvents: 1 }, cleanup: { performedSamples: 1, recoveredBytes: 42, actionCount: 2 }, policy: { state: 'recommendations-ready', actionCount: 5, approvalRequired: true } });
    expect(result.recommendations).toEqual(expect.arrayContaining(['review-storage-pressure', 'review-memory-and-pagefile', 'review-pagefile-pressure', 'review-thermal-workload', 'review-gpu-thermal-workload', 'review-abnormal-processes']));
    expect(result.priorities).toEqual(['review-storage-pressure', 'review-memory-and-pagefile', 'review-pagefile-pressure']);
    expect(result.evidence).toMatchObject({ telemetrySamples: 2, complete: true });
  });

  test('uses alternate fact shapes and fails closed when evidence is absent', () => {
    const alternate = entry(1000, {
      storage: [{ mount: 'E:', totalBytes: 100, freeBytes: 10 }],
      memory: { totalBytes: 100, availableBytes: 90, pressure: 'warning' },
      cpu: { utilizationPercent: 10 },
      gpu: { utilizationPercent: 11, temperature: 72 },
      thermal: { maxTemperatureC: 70, thermalThrottling: true },
      battery: { available: false },
      pagefile: {},
      processes: [{ name: '', abnormal: true }, { name: 'unknown', memoryBytes: 0, state: 'running' }],
      network: {},
      workload: {},
      cleanupAudit: { removedBytes: 3, actionCount: -1 },
      fans: { available: true, fans: [{ currentSpeed: 1200 }] }
    }, { report: { cleanup: { performed: true, recoveredBytes: 4, actionCount: 1 } } });
    const result = buildDailyWorkstationReport([alternate], { now: () => 1000, windowMs: 60 * 1000 });
    expect(result).toMatchObject({ sampleCount: 1, memory: { peakUsedBytes: 10, peakUsedPercent: 10 }, cpuGpu: { peakGpuTemperatureC: 72, latestGpuTemperatureC: 72 }, thermals: { throttleEvents: 1 }, fans: { peakRpm: 1200, latestRpm: 1200, latestFanCount: 1, observedSamples: 1 }, battery: { latestChargePercent: null }, cleanup: { performedSamples: 0, recoveredBytes: 3, actionCount: 0 } });
    const quiet = buildDailyWorkstationReport([entry(60000, { storage: [], memory: {}, gpu: { thermalThrottling: false }, battery: { capacityPercent: 55 }, network: { interfaces: [{ receivedBytes: null, sentBytes: null }] } }, { report: { game: null, cleanup: { performed: false } } })], { now: () => 60000, windowMs: 60 * 1000 });
    expect(quiet).toMatchObject({ sampleCount: 1, memory: { pressureEvents: 0 }, battery: { latestChargePercent: 55 }, cpuGpu: { gpuThermalThrottleEvents: 0 }, processes: { latestTopMemory: null }, recommendations: ['no-change'], evidence: { complete: false } });
    const sparse = buildDailyWorkstationReport([entry(60000, { storage: [{ mount: null, totalBytes: 10, freeBytes: 5 }], network: {}, report: null })], { now: () => 60000, windowMs: 60 * 1000 });
    expect(sparse.evidence.complete).toBe(false);
    const missingNetwork = buildDailyWorkstationReport([entry(1000, { network: undefined })], { now: () => 1000, windowMs: 60 * 1000 });
    expect(missingNetwork.network).toMatchObject({ latestReceivedBytesPerSecond: null, rateSamples: 0, latestRateState: 'observation-required' });
    const reset = buildDailyWorkstationReport([entry(1000), entry(2000, facts({ network: { interfaces: [{ receivedBytes: 10, sentBytes: 5 }] } }))], { now: () => 2000, windowMs: 60 * 1000 });
    expect(reset.network).toMatchObject({ latestReceivedBytesPerSecond: null, latestSentBytesPerSecond: null, peakReceivedBytesPerSecond: null, peakSentBytesPerSecond: null, rateSamples: 0, counterResetEvents: 1, latestRateState: 'counter-reset' });
    const sorted = buildDailyWorkstationReport([entry(60000, { processes: [{ name: 'a', memoryBytes: 1 }, { name: 'b', memoryBytes: 2 }] })], { now: () => 60000, windowMs: 60 * 1000 });
    expect(sorted.processes.latestTopMemory).toMatchObject({ name: 'b', bytes: 2 });
    const warning = buildDailyWorkstationReport([entry(60000, { memory: { totalBytes: 100, availableBytes: 10 } })], { now: () => 60000, windowMs: 60 * 1000 });
    expect(warning.memory.pressureEvents).toBe(1);
    const empty = buildDailyWorkstationReport([{ event: 'report', timestamp: 1000 }, { event: 'other', timestamp: 1000, facts: facts() }], { now: () => 1000, windowMs: 60 * 1000 });
    expect(empty).toMatchObject({ sampleCount: 0, evidence: { complete: false }, recommendations: ['collect-workstation-evidence'], priorities: ['collect-workstation-evidence'] });
    expect(empty.policy).toMatchObject({ state: 'no-change', recommendations: [], actionCount: 0, approvalRequired: false });
  });

  test('validates history, clock, window, and sample bounds', () => {
    expect(() => buildDailyWorkstationReport()).toThrow('entries must be an array');
    expect(() => buildDailyWorkstationReport([], { now: 1 })).toThrow('clock must be a function');
    expect(() => buildDailyWorkstationReport([], { now: () => NaN })).toThrow('clock must return a number');
    expect(() => buildDailyWorkstationReport([], { now: () => 1, windowMs: 1 })).toThrow('window');
    expect(() => buildDailyWorkstationReport([], { now: () => 1, maxSamples: 0 })).toThrow('maxSamples');
    expect(() => buildDailyWorkstationReport(Array.from({ length: 4097 }, () => ({})), { now: () => 1 })).toThrow('bound');
  });
});

