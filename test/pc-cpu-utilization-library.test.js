import {
  CPU_UTILIZATION_LIBRARY_ID,
  CPU_UTILIZATION_LIBRARY_VERSION,
  buildCpuUtilizationEnvelope,
  classifyCpuUtilization,
  compareCpuUtilization,
  createCpuUtilizationLibrary
} from '../pc/engines/cpu-utilization/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { utilizationPercent: 40 },
    ...overrides
  };
}

describe('CPU-utilization library', () => {
  test('classifies normal, elevated, and high utilization', () => {
    expect(classifyCpuUtilization(facts())).toMatchObject({
      library: CPU_UTILIZATION_LIBRARY_ID,
      libraryVersion: CPU_UTILIZATION_LIBRARY_VERSION,
      utilizationPercent: 40,
      level: 'normal',
      samplingIntervalMs: 1000,
      recommendations: ['no-change']
    });
    expect(classifyCpuUtilization(facts({ cpu: { utilizationPercent: 70 } }))).toMatchObject({
      level: 'elevated',
      samplingIntervalMs: 500,
      recommendations: ['observe-next-sample']
    });
    expect(classifyCpuUtilization(facts({
      environment: 'headless',
      cpu: { utilizationPercent: 95 }
    }))).toMatchObject({
      level: 'high',
      samplingIntervalMs: 250,
      recommendations: ['protect-services']
    });
    expect(classifyCpuUtilization(facts({ cpu: { utilizationPercent: 95 } }))).toMatchObject({
      level: 'high',
      recommendations: ['protect-foreground']
    });
  });

  test('handles unknown values, headless cadence, and comparison deltas', () => {
    expect(classifyCpuUtilization(facts({
      environment: 'unknown',
      cpu: { utilizationPercent: undefined }
    }))).toMatchObject({
      utilizationPercent: null,
      level: 'unknown',
      samplingIntervalMs: 2000,
      recommendations: ['request-cpu-utilization-observation']
    });
    expect(classifyCpuUtilization(facts({
      environment: 'headless',
      cpu: { utilizationPercent: 10 }
    })).samplingIntervalMs).toBe(5000);
    expect(compareCpuUtilization(facts({ cpu: { utilizationPercent: 20 } }), facts({
      cpu: { utilizationPercent: 80 }
    }))).toEqual({
      changed: true,
      deltaPercent: 60,
      previousLevel: 'normal',
      currentLevel: 'elevated'
    });
    expect(compareCpuUtilization(facts({ cpu: { utilizationPercent: undefined } }), facts({
      cpu: { utilizationPercent: 80 }
    })).deltaPercent).toBeNull();
  });

  test('bounds values and builds immutable envelopes and facades', () => {
    expect(classifyCpuUtilization(facts({ cpu: { utilizationPercent: 120 } })).utilizationPercent)
      .toBe(100);
    const envelope = buildCpuUtilizationEnvelope(facts(), {
      trigger: 'health.interval',
      now: () => 0
    });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuUtilizationLibrary({ now: () => 1000 });
    expect(library.id).toBe(CPU_UTILIZATION_LIBRARY_ID);
    expect(library.version).toBe(CPU_UTILIZATION_LIBRARY_VERSION);
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(library.emptyRecommendations).toEqual([]);
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, options, triggers, and clocks', () => {
    const invalid = [null, [], {}, { protocolVersion: 2 }, { ...facts(), engine: 'other' },
      { ...facts(), environment: 'bad' }, { ...facts(), cpu: null }];
    for (const value of invalid) {
      expect(() => classifyCpuUtilization(value)).toThrow(/CPU-utilization library/);
    }
    expect(() => classifyCpuUtilization(null))
      .toThrow('CPU-utilization library facts must be an object');
    expect(() => classifyCpuUtilization({ ...facts(), engine: 'other' }))
      .toThrow('CPU-utilization library requires normalized system facts');
    expect(() => classifyCpuUtilization({ ...facts(), cpu: null }))
      .toThrow('CPU-utilization library requires CPU facts');
    expect(() => buildCpuUtilizationEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildCpuUtilizationEnvelope(facts(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuUtilizationEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createCpuUtilizationLibrary(null)).toThrow('options must be an object');
    expect(() => createCpuUtilizationLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
