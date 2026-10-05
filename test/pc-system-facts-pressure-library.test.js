import {
  SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
  SYSTEM_FACTS_PRESSURE_LIBRARY_VERSION,
  buildPressurePlan,
  createPressureLibrary,
  mergePressureReports
} from '../pc/engines/system-facts/turbos/pressure/library.js';

function report(overrides = {}) {
  return {
    turbo: 'system-facts.pressure',
    score: 72,
    level: 'elevated',
    dominant: 'cpu',
    confidence: 0.8,
    signals: { cpu: 0.7, memory: 0.6, swap: 0.3, storage: 0.2, gpu: null },
    ...overrides
  };
}

describe('system-facts pressure library', () => {
  test('publishes identity and a frozen callable library', () => {
    const library = createPressureLibrary();
    expect(SYSTEM_FACTS_PRESSURE_LIBRARY_ID).toBe('system-facts.pressure.library');
    expect(SYSTEM_FACTS_PRESSURE_LIBRARY_VERSION).toBe(1);
    expect(library.id).toBe(SYSTEM_FACTS_PRESSURE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(typeof library.merge).toBe('function');
    expect(typeof library.plan).toBe('function');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('aggregates levels, scores, confidence, and ranked signals', () => {
    const result = mergePressureReports([
      report({ score: 80, level: 'high', confidence: 0.9, signals: {
        cpu: 0.9, memory: 0.5, swap: null, storage: 0.3, gpu: null, ignored: 0.2
      } }),
      report({ score: 50, level: 'elevated', confidence: 0.5, signals: {
        cpu: 0.3, memory: 0.7, swap: 0.4, gpu: 0.2
      } })
    ]);
    expect(result.reportCount).toBe(2);
    expect(result.score).toBe(65);
    expect(result.level).toBe('high');
    expect(result.dominant).toBe('cpu');
    expect(result.confidence).toBe(0.7);
    expect(result.signals).toEqual({ cpu: 0.6, memory: 0.6, swap: 0.4, storage: 0.3, gpu: 0.2 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('returns an explicit empty aggregate and no-signal plan', () => {
    const empty = mergePressureReports([]);
    expect(empty).toEqual({
      library: SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
      reportCount: 0,
      score: null,
      level: 'normal',
      dominant: null,
      confidence: 0,
      signals: { cpu: null, memory: null, swap: null, storage: null, gpu: null }
    });
    const noSignals = report({ dominant: null, signals: {
      cpu: null, memory: null, swap: null, storage: null, gpu: null
    } });
    expect(mergePressureReports([noSignals]).dominant).toBe(null);
    const plan = buildPressurePlan(noSignals, 'interactive');
    expect(plan.dominant).toBe(null);
    expect(plan.topResources).toEqual([]);

    const tiePlan = buildPressurePlan(report({ dominant: null, signals: {
      cpu: 0.5, memory: 0.5, swap: 0.2, storage: null, gpu: null
    } }), 'interactive');
    expect(tiePlan.topResources[0]).toBe('cpu');
  });

  test('builds high-pressure plans for headless and interactive hosts', () => {
    const headless = buildPressurePlan(report({
      level: 'high', score: 95, dominant: null
    }), 'headless');
    expect(headless).toMatchObject({
      environment: 'headless',
      mode: 'protect-services',
      recheckMs: 5000,
      dominant: 'cpu',
      holdDestructiveActions: true
    });
    expect(headless.topResources).toEqual(['cpu', 'memory', 'swap']);

    const interactive = buildPressurePlan(report({ level: 'high' }), 'interactive');
    expect(interactive.mode).toBe('protect-foreground');
    expect(interactive.holdDestructiveActions).toBe(true);
  });

  test('builds watch, observe, and unknown-environment plans', () => {
    expect(buildPressurePlan(report({ level: 'elevated' }), 'interactive'))
      .toMatchObject({ mode: 'watch', recheckMs: 15000, holdDestructiveActions: false });
    expect(buildPressurePlan(report({ level: 'normal', score: 10 }), 'interactive'))
      .toMatchObject({ mode: 'observe', recheckMs: 60000, holdDestructiveActions: false });
    expect(buildPressurePlan(report({ level: 'normal' }), 'unknown'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', recheckMs: 30000 });
    expect(buildPressurePlan(report({ level: 'normal' }), 'other').environment).toBe('unknown');
  });

  test('rejects malformed reports and bounded collections', () => {
    expect(() => mergePressureReports(null)).toThrow('reports must be an array');
    expect(() => mergePressureReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergePressureReports([null])).toThrow('report must be an object');
    expect(() => mergePressureReports([report({ turbo: 'other' })]))
      .toThrow('requires a pressure turbo report');
    expect(() => mergePressureReports([report({ level: 'other' })]))
      .toThrow('invalid level');
    expect(() => mergePressureReports([report({ score: 101 })]))
      .toThrow('score must be between 0 and 100');
    expect(() => mergePressureReports([report({ confidence: 2 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergePressureReports([report({ signals: [] })]))
      .toThrow('signals must be an object');
    expect(() => mergePressureReports([report({ signals: { cpu: 2 } })]))
      .toThrow('signal must be null or between 0 and 1');
    expect(() => mergePressureReports([report({ dominant: 'other' })]))
      .toThrow('invalid dominant resource');
  });
});
