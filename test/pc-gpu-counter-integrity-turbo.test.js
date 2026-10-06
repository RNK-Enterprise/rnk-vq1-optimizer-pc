import {
  GPU_COUNTER_INTEGRITY_TRIGGERS,
  GPU_COUNTER_INTEGRITY_TURBO_ID,
  runGpuCounterIntegrityTurbo
} from '../pc/engines/gpu-memory/turbos/counter-integrity/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus, capabilities) => ({ engine: 'system-facts', gpus, capabilities });
const gpu = (capacity, used, free) => ({
  vramBytes: capacity,
  vramUsedBytes: used,
  vramFreeBytes: free
});

describe('gpu-memory counter-integrity turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runGpuCounterIntegrityTurbo([], { trigger, now: () => stamp });

    expect(GPU_COUNTER_INTEGRITY_TURBO_ID).toBe('gpu-memory.counter-integrity');
    expect(Object.isFrozen(GPU_COUNTER_INTEGRITY_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_COUNTER_INTEGRITY_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      maximumErrorPercent: null
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies consistent, observed inconsistency, and sustained inconsistency', () => {
    const consistent = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 40, 60)]), snapshot([gpu(100, 40, 60)])
    ], { trigger, now: () => stamp });
    const observed = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 60, 60)])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });
    const sustained = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 60, 60)]), snapshot([gpu(100, 60, 60)])
    ], { trigger, now: () => stamp });

    expect(consistent).toMatchObject({
      state: 'consistent-counters',
      consistentCount: 2,
      inconsistentCount: 0,
      maximumErrorPercent: 0,
      recommendations: ['no-change']
    });
    expect(observed).toMatchObject({
      state: 'inconsistent-counters-observed',
      inconsistentCount: 1,
      maximumErrorPercent: 20,
      recommendations: ['observe-next-vram-counter-sample']
    });
    expect(sustained).toMatchObject({
      state: 'inconsistent-counters-sustained',
      inconsistentCount: 2,
      recommendations: ['review-vram-counter-source', 'hold-unapproved-memory-policy']
    });
  });

  test('handles invalid, incomplete, no-GPU, and disabled-observation evidence', () => {
    const invalid = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 120, 0)]), snapshot([gpu(0, 0, 0)])
    ], { trigger, now: () => stamp });
    const incomplete = runGpuCounterIntegrityTurbo([
      snapshot([{ vramBytes: 100, vramUsedBytes: 50 }]),
      snapshot([gpu(100, 50, -1)])
    ], { trigger, now: () => stamp });
    const noGpu = runGpuCounterIntegrityTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const disabled = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 40, 60)], { gpuMemoryObservation: false }),
      snapshot([gpu(100, 40, 60)], { gpuMemoryObservation: false })
    ], { trigger, now: () => stamp });

    expect(invalid).toMatchObject({ state: 'invalid-vram-evidence', invalidCount: 2 });
    expect(incomplete).toMatchObject({
      state: 'incomplete-vram-evidence', incompleteCount: 2
    });
    expect(noGpu).toMatchObject({
      state: 'no-gpu', noGpuCount: 2,
      recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(disabled).toMatchObject({
      state: 'no-observation', observedCount: 0,
      recommendations: ['request-vram-counter-observation']
    });
  });

  test('supports a custom tolerance and saturates confidence', () => {
    const report = runGpuCounterIntegrityTurbo([
      snapshot([gpu(100, 60, 60)]), snapshot([gpu(100, 60, 60)]),
      snapshot([gpu(100, 60, 60)])
    ], { trigger, tolerancePercent: 25, minimumSamples: 2, now: () => stamp });

    expect(report).toMatchObject({
      state: 'consistent-counters',
      tolerancePercent: 25,
      confidence: 1
    });
  });

  test('rejects malformed snapshots, triggers, bounds, tolerance, and clocks', () => {
    expect(() => runGpuCounterIntegrityTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuCounterIntegrityTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuCounterIntegrityTurbo()).toThrow('Unsupported');
    expect(() => runGpuCounterIntegrityTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuCounterIntegrityTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuCounterIntegrityTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, tolerancePercent: -1 })).toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, tolerancePercent: 101 })).toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuCounterIntegrityTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
