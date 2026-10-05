import {
  SYSTEM_FACTS_CADENCE_LIBRARY_ID,
  SYSTEM_FACTS_CADENCE_LIBRARY_VERSION,
  buildCadencePolicy,
  createCadenceLibrary,
  mergeCadenceReports
} from '../pc/engines/system-facts/turbos/cadence/library.js';

function report(overrides = {}) {
  return {
    turbo: 'system-facts.cadence',
    state: 'balanced',
    environment: 'interactive',
    pressure: 0.3,
    volatility: 0.2,
    confidence: 0.9,
    samples: 4,
    trigger: 'health.interval',
    schedule: { intervalMs: 30000, minimumMs: 3000, maximumMs: 120000 },
    ...overrides
  };
}

describe('system-facts cadence library', () => {
  test('publishes identity and a frozen callable library', () => {
    const library = createCadenceLibrary();
    expect(SYSTEM_FACTS_CADENCE_LIBRARY_ID).toBe('system-facts.cadence.library');
    expect(SYSTEM_FACTS_CADENCE_LIBRARY_VERSION).toBe(1);
    expect(library.id).toBe(SYSTEM_FACTS_CADENCE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(typeof library.merge).toBe('function');
    expect(typeof library.plan).toBe('function');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('merges cadence reports conservatively', () => {
    const result = mergeCadenceReports([
      report({
        state: 'responsive',
        environment: 'headless',
        pressure: 0.6,
        volatility: 0.4,
        confidence: 0.8,
        samples: 2,
        trigger: 'workload.changed',
        schedule: { intervalMs: 20000, minimumMs: 5000, maximumMs: 300000 }
      }),
      report({
        state: 'urgent',
        environment: 'headless',
        pressure: 0.9,
        volatility: 0.8,
        confidence: 0.6,
        samples: 5,
        trigger: 'health.interval',
        schedule: { intervalMs: 10000, minimumMs: 5000, maximumMs: 300000 }
      })
    ]);
    expect(result.reportCount).toBe(2);
    expect(result.environment).toBe('headless');
    expect(result.state).toBe('urgent');
    expect(result.pressure).toBe(0.9);
    expect(result.volatility).toBe(0.8);
    expect(result.confidence).toBe(0.6);
    expect(result.samples).toBe(5);
    expect(result.triggers).toEqual(['workload.changed', 'health.interval']);
    expect(result.schedule).toEqual({ intervalMs: 10000, minimumMs: 5000, maximumMs: 300000 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(mergeCadenceReports([report(), report({ environment: 'headless' })]).environment).toBe('unknown');
  });

  test('returns an explicit empty aggregate', () => {
    expect(mergeCadenceReports([])).toEqual({
      library: SYSTEM_FACTS_CADENCE_LIBRARY_ID,
      reportCount: 0,
      environment: 'unknown',
      state: 'balanced',
      pressure: null,
      volatility: null,
      confidence: 0,
      samples: 0,
      triggers: [],
      schedule: null
    });
  });

  test('builds urgent, responsive, relaxed, and balanced policies', () => {
    expect(buildCadencePolicy(report({
      state: 'urgent',
      schedule: { intervalMs: 10000, minimumMs: 3000, maximumMs: 120000 }
    }), 'interactive')).toMatchObject({
      mode: 'accelerated-observation',
      intervalMs: 3000,
      automatic: false,
      recommendations: ['sample-at-minimum-interval', 'hold-destructive-actions']
    });
    expect(buildCadencePolicy(report({
      state: 'responsive',
      schedule: { intervalMs: 30000, minimumMs: 3000, maximumMs: 120000 }
    }), 'headless')).toMatchObject({
      mode: 'responsive-observation',
      intervalMs: 15000,
      automatic: true,
      recommendations: ['sample-soon-after-workload-change']
    });
    expect(buildCadencePolicy(report({
      state: 'relaxed',
      schedule: { intervalMs: 30000, minimumMs: 3000, maximumMs: 32000 }
    }), 'interactive')).toMatchObject({
      mode: 'relaxed-observation',
      intervalMs: 32000,
      automatic: true,
      recommendations: ['allow-longer-interval']
    });
    expect(buildCadencePolicy(report(), 'interactive')).toMatchObject({
      mode: 'balanced-observation',
      intervalMs: 30000,
      automatic: true,
      recommendations: ['observe-at-selected-cadence']
    });
  });

  test('keeps unknown and invalid target environments profile-required', () => {
    expect(buildCadencePolicy(report({ environment: 'unknown' }), undefined)).toMatchObject({
      environment: 'unknown',
      mode: 'profile-required',
      intervalMs: 30000,
      automatic: false,
      recommendations: ['request-environment-profile']
    });
    expect(buildCadencePolicy(report({ environment: 'headless' }), '').environment).toBe('headless');
    expect(buildCadencePolicy(report(), 'other').environment).toBe('unknown');
  });

  test('rejects malformed reports and bounded collections', () => {
    expect(() => mergeCadenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeCadenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCadenceReports([null])).toThrow('report must be an object');
    expect(() => mergeCadenceReports([report({ turbo: 'other' })]))
      .toThrow('requires a cadence turbo report');
    expect(() => mergeCadenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeCadenceReports([report({ environment: 'other' })]))
      .toThrow('invalid environment');
    expect(() => mergeCadenceReports([report({ pressure: 2 })]))
      .toThrow('pressure must be between 0 and 1');
    expect(() => mergeCadenceReports([report({ volatility: -1 })]))
      .toThrow('volatility must be between 0 and 1');
    expect(() => mergeCadenceReports([report({ confidence: 2 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeCadenceReports([report({ samples: -1 })]))
      .toThrow('samples must be a non-negative integer');
    expect(() => mergeCadenceReports([report({ trigger: 'other' })]))
      .toThrow('invalid trigger');
    expect(() => mergeCadenceReports([report({ schedule: null })]))
      .toThrow('schedule must be an object');
    expect(() => mergeCadenceReports([report({ schedule: {
      intervalMs: 0, minimumMs: 1, maximumMs: 2
    } })])).toThrow('schedule values must be positive integers');
    expect(() => mergeCadenceReports([report({ schedule: {
      intervalMs: 3, minimumMs: 4, maximumMs: 2
    } })])).toThrow('schedule bounds are invalid');
  });
});
