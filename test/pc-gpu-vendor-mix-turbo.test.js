import {
  GPU_VENDOR_MIX_TRIGGERS,
  GPU_VENDOR_MIX_TURBO_ID,
  runGpuVendorMixTurbo
} from '../pc/engines/gpu-policy/turbos/vendor-mix/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus) => ({ engine: 'system-facts', gpus });
const gpu = (vendor, model = 'adapter') => ({ vendor, model, driver: 'documented' });

describe('gpu-policy vendor-mix turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runGpuVendorMixTurbo([], { trigger, now: () => stamp });

    expect(GPU_VENDOR_MIX_TURBO_ID).toBe('gpu-policy.vendor-mix');
    expect(Object.isFrozen(GPU_VENDOR_MIX_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_VENDOR_MIX_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      observedCount: 0,
      vendors: []
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.generatedAt).toBe(new Date(stamp).toISOString());
    expect(report.actions).toEqual([]);
  });

  test('classifies homogeneous and persistent mixed documented vendors', () => {
    const homogeneous = runGpuVendorMixTurbo([
      snapshot([gpu('NVIDIA')]),
      snapshot([gpu('nvidia')])
    ], { trigger, now: () => stamp });
    const mixed = runGpuVendorMixTurbo([
      snapshot([gpu('NVIDIA'), gpu('AMD')]),
      snapshot([gpu('nvidia'), gpu('amd')])
    ], { trigger, now: () => stamp });
    const observed = runGpuVendorMixTurbo([
      snapshot([gpu('NVIDIA'), gpu('AMD')])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });

    expect(homogeneous).toMatchObject({
      state: 'homogeneous-vendor-layout',
      homogeneousCount: 2,
      mixedCount: 0,
      vendors: ['nvidia']
    });
    expect(mixed).toMatchObject({
      state: 'sustained-mixed-vendor-layout',
      mixedCount: 2,
      vendors: ['amd', 'nvidia']
    });
    expect(observed).toMatchObject({ state: 'mixed-vendor-observed', mixedCount: 1 });
    expect(Object.isFrozen(mixed.vendors)).toBe(true);
  });

  test('handles no-GPU, no-observation, incomplete, and vendor-specific evidence', () => {
    const noGpu = runGpuVendorMixTurbo([
      snapshot([]), snapshot([])
    ], { trigger, now: () => stamp });
    const noObservation = runGpuVendorMixTurbo([
      snapshot([]), snapshot([gpu('NVIDIA')])
    ], { trigger, now: () => stamp });
    const incomplete = runGpuVendorMixTurbo([
      snapshot([{ vendor: null }]), snapshot([{ vendor: null }])
    ], { trigger, now: () => stamp });
    const specific = runGpuVendorMixTurbo([
      snapshot([gpu('Acme Render')]), snapshot([gpu('Acme Render')])
    ], { trigger, now: () => stamp });

    expect(noGpu).toMatchObject({
      state: 'no-gpu',
      noGpuCount: 2,
      recommendations: ['no-change', 'keep-gpu-controls-disabled']
    });
    expect(noObservation).toMatchObject({
      state: 'no-observation',
      recommendations: ['request-gpu-vendor-observation']
    });
    expect(incomplete).toMatchObject({
      state: 'incomplete-vendor-evidence',
      incompleteCount: 2,
      recommendations: ['request-complete-gpu-vendor-evidence']
    });
    expect(specific).toMatchObject({
      state: 'vendor-specific-layout',
      vendorSpecificCount: 2,
      recommendations: ['review-documented-gpu-vendor-controls']
    });
  });

  test('recognizes vendor aliases and conservative mixed-layout recommendations', () => {
    const report = runGpuVendorMixTurbo([
      snapshot([
        gpu('NVIDIA Graphics'),
        gpu('AMD Radeon'),
        gpu('ATI Legacy'),
        gpu('Intel UHD'),
        gpu('Acme Render')
      ])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });
    const fiveSampleReport = runGpuVendorMixTurbo([
      snapshot([gpu('nvidia')]), snapshot([gpu('nvidia')]), snapshot([gpu('nvidia')]),
      snapshot([gpu('nvidia')]), snapshot([gpu('nvidia')])
    ], { trigger, minimumSamples: 2, now: () => stamp });

    expect(report.state).toBe('vendor-specific-layout');
    expect(report.vendors).toEqual(['ati', 'amd', 'intel', 'nvidia', 'vendor-specific'].sort());
    expect(report.vendorSpecificCount).toBe(1);
    expect(fiveSampleReport.confidence).toBe(1);
  });

  test('rejects malformed snapshots, triggers, bounds, and clocks', () => {
    expect(() => runGpuVendorMixTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuVendorMixTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuVendorMixTurbo()).toThrow('Unsupported');
    expect(() => runGpuVendorMixTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuVendorMixTurbo([{ engine: 'other', gpus: [] }], { trigger }))
      .toThrow('system-facts');
    expect(() => runGpuVendorMixTurbo([{ engine: 'system-facts', gpus: null }], { trigger }))
      .toThrow('GPU list');
    expect(() => runGpuVendorMixTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuVendorMixTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuVendorMixTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
