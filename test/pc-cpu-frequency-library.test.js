import {
  CPU_FREQUENCY_LIBRARY_ID,
  CPU_FREQUENCY_LIBRARY_VERSION,
  buildCpuFrequencyEnvelope,
  classifyCpuFrequency,
  compareCpuFrequency,
  createCpuFrequencyLibrary
} from '../pc/engines/cpu-frequency/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { governor: ' SCHEDUTIL ', driver: ' AMD_PSTATE ', utilizationPercent: 50 },
    ...overrides
  };
}

describe('CPU-frequency library', () => {
  test('classifies adaptive, documented, and bounded frequency evidence', () => {
    expect(classifyCpuFrequency(facts())).toMatchObject({
      library: CPU_FREQUENCY_LIBRARY_ID,
      libraryVersion: CPU_FREQUENCY_LIBRARY_VERSION,
      environment: 'interactive', governor: 'schedutil', governorClass: 'adaptive',
      driver: 'amd_pstate', driverClass: 'documented', utilizationPercent: 50,
      state: 'preserve-adaptive-policy', confidence: 1,
      recommendations: ['preserve-adaptive-policy']
    });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'performance', driver: 'intel_pstate', utilizationPercent: 90
    }, environment: 'headless' }))).toMatchObject({ governorClass: 'fixed-high',
      driverClass: 'documented', state: 'review-throughput-policy', confidence: 1,
      recommendations: ['review-documented-frequency-control', 'hold-unapproved-policy-change'] });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'powersave', driver: 'acpi-cpufreq', utilizationPercent: 20
    } }))).toMatchObject({ governorClass: 'fixed-low', state: 'observe',
      recommendations: ['no-change'] });
  });

  test('preserves observation-required, vendor, and profile states', () => {
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'vendor-governor', driver: 'vendor-driver', utilizationPercent: 20
    } }))).toMatchObject({ governorClass: 'vendor-specific', driverClass: 'vendor-specific',
      state: 'driver-observation-required', confidence: 0.5,
      recommendations: ['request-cpu-driver-observation'] });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'vendor-governor', driver: 'amd_pstate', utilizationPercent: 20
    } }))).toMatchObject({ state: 'governor-observation-required',
      recommendations: ['request-cpu-governor-observation'] });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'performance', driver: 'amd_pstate', utilizationPercent: null
    } }))).toMatchObject({ state: 'workload-observation-required', confidence: 0.75,
      recommendations: ['request-cpu-observation'] });
    expect(classifyCpuFrequency(facts({ environment: 'other', cpu: {
      governor: null, driver: null, utilizationPercent: null
    } }))).toMatchObject({ environment: 'unknown', governorClass: 'unknown', driverClass: 'unknown',
      utilizationPercent: null, state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile'] });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: '', driver: '', utilizationPercent: 140
    } }))).toMatchObject({ governor: null, driver: null, utilizationPercent: 100 });
    expect(classifyCpuFrequency(facts({ cpu: {
      governor: 'performance', driver: 'intel_pstate', utilizationPercent: -1
    } }))).toMatchObject({ utilizationPercent: 0, state: 'observe' });
  });

  test('compares samples and builds immutable local facades', () => {
    expect(compareCpuFrequency(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, governorChanged: false,
      driverChanged: false, utilizationChanged: false
    });
    expect(compareCpuFrequency(facts(), facts({ cpu: {
      governor: 'performance', driver: 'intel_pstate', utilizationPercent: 80
    } }))).toMatchObject({
      changed: true, stateChanged: true, governorChanged: true,
      driverChanged: true, utilizationChanged: true
    });
    const envelope = buildCpuFrequencyEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuFrequencyLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyCpuFrequency(null)).toThrow('facts must be an object');
    expect(() => classifyCpuFrequency({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCpuFrequency({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCpuFrequency({ ...facts(), cpu: null }))
      .toThrow('requires a CPU section');
    expect(() => buildCpuFrequencyEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildCpuFrequencyEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createCpuFrequencyLibrary(null)).toThrow('options must be an object');
    expect(() => createCpuFrequencyLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
