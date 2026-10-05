import {
  GPU_UTILIZATION_LIBRARY_ID,
  GPU_UTILIZATION_LIBRARY_VERSION,
  buildGpuUtilizationEnvelope,
  classifyGpuUtilization,
  compareGpuUtilization,
  createGpuUtilizationLibrary
} from '../pc/engines/gpu-utilization/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    gpus: [{ model: 'Example GPU', utilizationPercent: 40, temperatureCelsius: 55, vramBytes: 4096 }],
    ...overrides
  };
}

describe('GPU-utilization library', () => {
  test('aggregates normal, elevated, and bounded GPU observations', () => {
    expect(classifyGpuUtilization(facts())).toMatchObject({
      library: GPU_UTILIZATION_LIBRARY_ID,
      libraryVersion: GPU_UTILIZATION_LIBRARY_VERSION,
      gpuCount: 1, models: ['Example GPU'], utilizationPercent: 40,
      temperatureCelsius: 55, maximumVramBytes: 4096, level: 'normal',
      recommendations: ['no-change']
    });
    expect(classifyGpuUtilization(facts({ gpus: [
      { model: 'A', utilizationPercent: 75, temperatureCelsius: 70, vramBytes: 1 },
      { model: '', utilizationPercent: 20, temperatureCelsius: 80, vramBytes: -1 }
    ] }))).toMatchObject({
      gpuCount: 2, models: ['A'], utilizationPercent: 75, temperatureCelsius: 80,
      maximumVramBytes: 1, level: 'elevated'
    });
  });

  test('preserves absent, unknown, and high-pressure GPU states', () => {
    expect(classifyGpuUtilization(facts({ gpus: [] })).recommendations)
      .toEqual(['no-change', 'keep-gpu-controls-disabled']);
    expect(classifyGpuUtilization(facts({ gpus: [{ model: null }] }))).toMatchObject({
      gpuCount: 1, utilizationPercent: null, temperatureCelsius: null,
      maximumVramBytes: null, level: 'unknown', recommendations: ['request-gpu-observation']
    });
    expect(classifyGpuUtilization(facts({ environment: 'headless', gpus: [
      { model: 'Server GPU', utilizationPercent: 95, temperatureCelsius: 90, vramBytes: 2 }
    ] })).recommendations).toEqual(['protect-services', 'hold-unapproved-gpu-policy']);
    expect(classifyGpuUtilization(facts({ gpus: [
      { model: 'Desktop GPU', utilizationPercent: 95, temperatureCelsius: 90, vramBytes: 2 }
    ] })).recommendations).toEqual(['protect-foreground', 'hold-unapproved-gpu-policy']);
    expect(classifyGpuUtilization(facts({ environment: 'other', gpus: [] })).recommendations)
      .toEqual(['request-environment-profile']);
  });

  test('compares observations and builds immutable local facades', () => {
    expect(compareGpuUtilization(facts(), facts({ gpus: [
      { model: 'Example GPU', utilizationPercent: 45, temperatureCelsius: 55, vramBytes: 4096 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, utilizationChanged: true, temperatureChanged: false });
    expect(compareGpuUtilization(facts(), facts({ gpus: [
      { model: 'Example GPU', utilizationPercent: 40, temperatureCelsius: 60, vramBytes: 4096 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, utilizationChanged: false, temperatureChanged: true });
    expect(compareGpuUtilization(facts(), facts())).toMatchObject({ changed: false, gpuCountDelta: 0 });
    const envelope = buildGpuUtilizationEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuUtilizationLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyGpuUtilization(null)).toThrow('facts must be an object');
    expect(() => classifyGpuUtilization({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyGpuUtilization({ ...facts(), gpus: null })).toThrow('requires a GPU list');
    expect(() => buildGpuUtilizationEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildGpuUtilizationEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createGpuUtilizationLibrary(null)).toThrow('options must be an object');
    expect(() => createGpuUtilizationLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
