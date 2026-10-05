import {
  SYSTEM_FACTS_STABILITY_LIBRARY_ID,
  SYSTEM_FACTS_STABILITY_LIBRARY_VERSION,
  buildStabilityPlan,
  createStabilityLibrary,
  mergeStabilityReports
} from '../pc/engines/system-facts/turbos/stability/library.js';

function report(overrides = {}) {
  return {
    turbo: 'system-facts.stability',
    score: 80,
    state: 'stable',
    trend: 'flat',
    sampleCount: 4,
    volatility: 0.05,
    ...overrides
  };
}

describe('system-facts stability library', () => {
  test('publishes identity and a frozen callable library', () => {
    const library = createStabilityLibrary();
    expect(SYSTEM_FACTS_STABILITY_LIBRARY_ID).toBe('system-facts.stability.library');
    expect(SYSTEM_FACTS_STABILITY_LIBRARY_VERSION).toBe(1);
    expect(library.id).toBe(SYSTEM_FACTS_STABILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(typeof library.merge).toBe('function');
    expect(typeof library.plan).toBe('function');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('merges weighted reports with deterministic state and trend consensus', () => {
    const result = mergeStabilityReports([
      report({ score: 60, state: 'watch', trend: 'rising', sampleCount: 2, volatility: 0.4 }),
      report({ score: 90, state: 'stable', trend: 'flat', sampleCount: 6, volatility: 0.1 }),
      report({ score: null, state: 'insufficient-data', trend: 'falling', sampleCount: 0, volatility: null })
    ]);
    expect(result.reportCount).toBe(3);
    expect(result.score).toBe(82.5);
    expect(result.state).toBe('stable');
    expect(result.trend).toBe('flat');
    expect(result.volatility).toBeCloseTo(0.25, 4);
    expect(result.confidence).toBeCloseTo(0.6667, 4);
    expect(result.sampleCount).toBe(8);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('returns explicit empty and no-score aggregate states', () => {
    expect(mergeStabilityReports([])).toEqual({
      library: SYSTEM_FACTS_STABILITY_LIBRARY_ID,
      reportCount: 0,
      score: null,
      state: 'insufficient-data',
      trend: 'flat',
      volatility: null,
      confidence: 0,
      sampleCount: 0
    });
    expect(mergeStabilityReports([
      report({ score: null, state: 'insufficient-data', sampleCount: 0, volatility: null })
    ])).toMatchObject({ score: null, volatility: null, confidence: 0 });
  });

  test('builds state-specific plans for each environment', () => {
    expect(buildStabilityPlan(report({ state: 'unstable', volatility: 0.9 }), 'interactive'))
      .toMatchObject({ mode: 'accelerated-observation', windowSize: 16, recheckMs: 5000 });
    expect(buildStabilityPlan(report({ state: 'watch', volatility: 0.4 }), 'headless'))
      .toMatchObject({ mode: 'watch-observation', windowSize: 16, recheckMs: 15000 });
    expect(buildStabilityPlan(report({ state: 'stable', volatility: 0.05 }), 'interactive'))
      .toMatchObject({ mode: 'relaxed-observation', windowSize: 16, recheckMs: 60000 });
    expect(buildStabilityPlan(report({ state: 'stable', volatility: 0.5 }), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', windowSize: 16, recheckMs: 120000 });
    expect(buildStabilityPlan(report({ state: 'insufficient-data', score: null, volatility: null }), 'interactive'))
      .toMatchObject({ mode: 'bootstrap-observation', windowSize: 4, recheckMs: 10000 });
    expect(buildStabilityPlan(report({ state: 'watch' }), 'unknown'))
      .toMatchObject({ mode: 'profile-required', windowSize: 4, stableRecheckMs: 30000 });
    expect(buildStabilityPlan(report(), undefined).environment).toBe('unknown');
    expect(buildStabilityPlan(report(), 'unclassified').stableRecheckMs).toBe(30000);
  });

  test('rejects malformed reports and bounded collections', () => {
    expect(() => mergeStabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeStabilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeStabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeStabilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a stability turbo report');
    expect(() => mergeStabilityReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeStabilityReports([report({ trend: 'other' })]))
      .toThrow('invalid trend');
    expect(() => mergeStabilityReports([report({ score: 101 })]))
      .toThrow('score must be null or between 0 and 100');
    expect(() => mergeStabilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be a non-negative integer');
    expect(() => mergeStabilityReports([report({ volatility: -1 })]))
      .toThrow('volatility must be null or non-negative');
  });
});
