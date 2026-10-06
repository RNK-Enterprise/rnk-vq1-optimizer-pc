import {
  GPU_OCCUPANCY_DRIFT_TRIGGERS,
  GPU_OCCUPANCY_DRIFT_TURBO_ID,
  runGpuOccupancyDriftTurbo
} from '../pc/engines/gpu-memory/turbos/occupancy-drift/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus, capabilities) => ({ engine: 'system-facts', gpus, capabilities });
const gpu = (used, capacity = 100) => ({ vramBytes: capacity, vramUsedBytes: used });

describe('gpu-memory occupancy-drift turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runGpuOccupancyDriftTurbo([], { trigger, now: () => stamp });

    expect(GPU_OCCUPANCY_DRIFT_TURBO_ID).toBe('gpu-memory.occupancy-drift');
    expect(Object.isFrozen(GPU_OCCUPANCY_DRIFT_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_OCCUPANCY_DRIFT_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      deltaCount: 0,
      maximumDelta: 0
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies stable, observed, and sustained occupancy movement', () => {
    const stable = runGpuOccupancyDriftTurbo([
      snapshot([gpu(50)]), snapshot([gpu(50)])
    ], { trigger, now: () => stamp });
    const observed = runGpuOccupancyDriftTurbo([
      snapshot([gpu(10)]), snapshot([gpu(30)])
    ], { trigger, changeThreshold: 2, now: () => stamp });
    const sustained = runGpuOccupancyDriftTurbo([
      snapshot([gpu(10)]), snapshot([gpu(80)]), snapshot([gpu(10)])
    ], { trigger, now: () => stamp });

    expect(stable).toMatchObject({
      state: 'stable-occupancy',
      observedCount: 2,
      comparisonCount: 1,
      deltaCount: 0,
      maximumDelta: 0,
      recommendations: ['no-change']
    });
    expect(observed).toMatchObject({
      state: 'occupancy-drift-observed',
      deltaCount: 1,
      maximumDelta: 20,
      recommendations: ['observe-next-vram-sample']
    });
    expect(sustained).toMatchObject({
      state: 'sustained-occupancy-drift',
      deltaCount: 2,
      maximumDelta: 70,
      recommendations: ['review-vram-workload-pattern', 'hold-unapproved-memory-policy']
    });
  });

  test('handles invalid, incomplete, no-GPU, and disabled-observation evidence', () => {
    const invalid = runGpuOccupancyDriftTurbo([
      snapshot([gpu(120)]), snapshot([gpu(120)])
    ], { trigger, now: () => stamp });
    const incomplete = runGpuOccupancyDriftTurbo([
      snapshot([{ vramBytes: 100 }]), snapshot([{ vramBytes: -1, vramUsedBytes: 2 }])
    ], { trigger, now: () => stamp });
    const noGpu = runGpuOccupancyDriftTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const disabled = runGpuOccupancyDriftTurbo([
      snapshot([gpu(20)], { gpuMemoryObservation: false }),
      snapshot([gpu(30)], { gpuMemoryObservation: false })
    ], { trigger, now: () => stamp });

    expect(invalid).toMatchObject({
      state: 'invalid-vram-evidence',
      invalidCount: 2,
      recommendations: ['review-vram-counter-range']
    });
    expect(incomplete).toMatchObject({
      state: 'incomplete-vram-evidence',
      incompleteCount: 2,
      recommendations: ['request-complete-vram-evidence']
    });
    expect(noGpu).toMatchObject({
      state: 'no-gpu',
      noGpuCount: 2,
      recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(disabled).toMatchObject({
      state: 'no-observation',
      noGpuCount: 0,
      recommendations: ['request-vram-occupancy-observation']
    });
  });

  test('bounds samples and saturates confidence without losing evidence', () => {
    const report = runGpuOccupancyDriftTurbo([
      snapshot([gpu(10)]), snapshot([gpu(10)]), snapshot([gpu(10)])
    ], { trigger, minimumSamples: 2, deltaThreshold: 0, now: () => stamp });

    expect(report).toMatchObject({ sampleCount: 3, observedCount: 3, confidence: 1 });
    expect(report.deltaThreshold).toBe(0);
  });

  test('rejects malformed snapshots, triggers, bounds, and clocks', () => {
    expect(() => runGpuOccupancyDriftTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuOccupancyDriftTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuOccupancyDriftTurbo()).toThrow('Unsupported');
    expect(() => runGpuOccupancyDriftTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuOccupancyDriftTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuOccupancyDriftTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, windowSize: 1 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, deltaThreshold: -1 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, deltaThreshold: 101 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, changeThreshold: 0 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, changeThreshold: 65 })).toThrow(RangeError);
    expect(() => runGpuOccupancyDriftTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
