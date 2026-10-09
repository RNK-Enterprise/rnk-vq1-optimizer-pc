/**
 * Native process-resource daily-report tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { deriveProcessResourceRateSamples, summarizeProcessResourceRates, PROCESS_RESOURCE_REPORT_VERSION } from '../native/process-resource-report.js';

function entry(timestamp, processes) { return { timestamp, facts: { processes } }; }

describe('native process-resource report reduction', () => {
  test('derives rates across history and identifies latest CPU and I/O leaders', () => {
    const samples = deriveProcessResourceRateSamples([
      entry(1000, [{ pid: 1, name: 'build', cpuSeconds: 1, ioReadBytes: 100, ioWriteBytes: 200 }, { pid: 2, name: 'io', cpuSeconds: 1, ioReadBytes: 100, ioWriteBytes: 100 }]),
      entry(61000, [{ pid: 1, name: 'build', cpuSeconds: 3, ioReadBytes: 400, ioWriteBytes: 800 }, { pid: 2, name: 'io', cpuSeconds: 1.5, ioReadBytes: 150, ioWriteBytes: 150 }, null])
    ]);
    const summary = summarizeProcessResourceRates(samples);
    expect(samples).toHaveLength(2);
    expect(summary).toMatchObject({ version: PROCESS_RESOURCE_REPORT_VERSION, peakCpuPercent: 3.3333333333333335, peakIoBytesPerSecond: 15, rateSamples: 1, counterResetEvents: 0, latestTopCpu: { pid: 1, name: 'build', cpuPercent: 3.3333333333333335 }, latestTopIo: { pid: 1, name: 'build', ioBytesPerSecond: 15 } });
  });

  test('preserves reset and observation-required states and clamps intervals', () => {
    const reset = deriveProcessResourceRateSamples([
      entry(1000, [{ pid: 1, name: 'build', cpuSeconds: 5, ioReadBytes: 5, ioWriteBytes: 5 }]),
      entry(1000, [{ pid: 1, name: 'build', cpuSeconds: 1, ioReadBytes: 1, ioWriteBytes: 1 }]),
      entry(1000 + 2 * 24 * 60 * 60 * 1000, [{ pid: 1, name: 'build', cpuSeconds: 2, ioReadBytes: 2, ioWriteBytes: 2 }])
    ]);
    expect(reset[1].state).toBe('counter-reset');
    expect(reset[2].intervalMs).toBe(24 * 60 * 60 * 1000);
    expect(summarizeProcessResourceRates(reset)).toMatchObject({ rateSamples: 1, counterResetEvents: 1, peakCpuPercent: 0.0011574074074074073 });
    expect(summarizeProcessResourceRates([])).toMatchObject({ peakCpuPercent: null, peakIoBytesPerSecond: null, latestTopCpu: null, latestTopIo: null, rateSamples: 0, counterResetEvents: 0 });
  });

  test('fails closed for malformed inputs and unsupported leader metrics', () => {
    expect(() => deriveProcessResourceRateSamples()).toThrow('entries must be an array');
    expect(() => summarizeProcessResourceRates()).toThrow('samples must be an array');
    const sparse = deriveProcessResourceRateSamples([entry(1000, [{ pid: 1, name: '', cpuSeconds: 'bad' }])]);
    expect(summarizeProcessResourceRates(sparse)).toMatchObject({ latestTopCpu: null, latestTopIo: null });
  });
});
