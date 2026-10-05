import {
  SYSTEM_FACTS_CAPABILITY_LIBRARY_ID,
  SYSTEM_FACTS_CAPABILITY_LIBRARY_VERSION,
  buildCapabilityPlan,
  createCapabilityLibrary,
  mergeCapabilityReports
} from '../pc/engines/system-facts/turbos/capability/library.js';

function report(overrides = {}) {
  return {
    turbo: 'system-facts.capability',
    state: 'ready',
    environment: 'headless',
    score: 90,
    capabilities: [
      { name: 'cpu-observation', status: 'supported', required: true },
      { name: 'memory-observation', status: 'supported', required: true },
      { name: 'thermal-observation', status: 'observation-only', required: false },
      { name: 'power-profile-control', status: 'admin-required', required: false },
      { name: 'network-observation', status: 'unknown', required: false }
    ],
    requiredFailures: [],
    ...overrides
  };
}

describe('system-facts capability library', () => {
  test('publishes identity and a frozen callable library', () => {
    const library = createCapabilityLibrary();
    expect(SYSTEM_FACTS_CAPABILITY_LIBRARY_ID).toBe('system-facts.capability.library');
    expect(SYSTEM_FACTS_CAPABILITY_LIBRARY_VERSION).toBe(1);
    expect(library.id).toBe(SYSTEM_FACTS_CAPABILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(typeof library.merge).toBe('function');
    expect(typeof library.plan).toBe('function');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('merges capability status conservatively and preserves required flags', () => {
    const result = mergeCapabilityReports([
      report({ score: 90 }),
      report({
        state: 'partial',
        environment: 'interactive',
        score: 50,
        capabilities: [
          { name: 'cpu-observation', status: 'observation-only', required: false },
          { name: 'memory-observation', status: 'supported', required: true },
          { name: 'memory-observation', status: 'supported', required: false },
          { name: 'thermal-observation', status: 'unavailable', required: false },
          { name: 'cache-cleanup', status: 'not-applicable', required: true },
          { name: 'display-observation', status: 'supported', required: false }
        ]
      })
    ]);
    expect(result.reportCount).toBe(2);
    expect(result.environment).toBe('unknown');
    expect(result.state).toBe('partial');
    expect(result.score).toBe(70);
    expect(result.requiredFailures).toEqual(['cache-cleanup', 'cpu-observation']);
    expect(result.summary).toMatchObject({
      'observation-only': 1,
      unavailable: 1,
      'not-applicable': 1
    });
    expect(result.capabilities.find((item) => item.name === 'cpu-observation'))
      .toEqual({ name: 'cpu-observation', status: 'observation-only', required: true });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('handles empty, ready, and blocked aggregate states', () => {
    expect(mergeCapabilityReports([])).toMatchObject({
      reportCount: 0,
      environment: 'unknown',
      state: 'blocked',
      score: null,
      requiredFailures: []
    });
    expect(mergeCapabilityReports([report()]).state).toBe('ready');
    expect(mergeCapabilityReports([report({ state: 'blocked' })]).state).toBe('blocked');
  });

  test('builds a headless plan with safe observations and consent boundaries', () => {
    const plan = buildCapabilityPlan(report({
      capabilities: [
        { name: 'cpu-observation', status: 'supported', required: true },
        { name: 'thermal-observation', status: 'observation-only', required: false },
        { name: 'display-observation', status: 'not-applicable', required: false },
        { name: 'power-profile-control', status: 'admin-required', required: false },
        { name: 'cache-cleanup', status: 'unavailable', required: false },
        { name: 'network-observation', status: 'unknown', required: false }
      ]
    }), 'headless');
    expect(plan.mode).toBe('headless-observation');
    expect(plan.state).toBe('ready');
    expect(plan.safeObservations).toEqual(['cpu-observation', 'thermal-observation']);
    expect(plan.adminRequired).toEqual(['power-profile-control']);
    expect(plan.disabled).toEqual(['cache-cleanup', 'network-observation']);
    expect(plan.automatic).toBe(false);
    expect(plan.recommendations).toEqual([
      'request-explicit-admin-consent',
      'keep-unsupported-controls-disabled'
    ]);
    expect(plan.actions).toEqual([]);
  });

  test('builds interactive, unknown, blocked, and automatic plans', () => {
    const automatic = buildCapabilityPlan(report({
      capabilities: [{ name: 'cpu-observation', status: 'supported', required: true }]
    }), 'interactive');
    expect(automatic).toMatchObject({
      mode: 'interactive-observation',
      state: 'ready',
      automatic: true,
      recommendations: ['use-capability-selected-plan']
    });

    const blocked = buildCapabilityPlan(report({
      capabilities: [{ name: 'display-observation', status: 'unavailable', required: true }]
    }), 'interactive');
    expect(blocked).toMatchObject({
      mode: 'manual-review-required',
      state: 'blocked',
      requiredFailures: ['display-observation'],
      automatic: false,
      recommendations: ['resolve-required-capabilities']
    });

    const unknown = buildCapabilityPlan(report({ environment: 'unknown' }), undefined);
    expect(unknown).toMatchObject({
      mode: 'profile-required',
      environment: 'unknown',
      automatic: false,
      recommendations: ['request-environment-profile']
    });
    expect(buildCapabilityPlan(report({ environment: 'headless' }), 'other').environment).toBe('unknown');
  });

  test('rejects malformed reports and bounded collections', () => {
    expect(() => mergeCapabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeCapabilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCapabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeCapabilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a capability turbo report');
    expect(() => mergeCapabilityReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCapabilityReports([report({ environment: 'other' })]))
      .toThrow('invalid environment');
    expect(() => mergeCapabilityReports([report({ score: 101 })]))
      .toThrow('score must be between 0 and 100');
    expect(() => mergeCapabilityReports([report({ capabilities: {} })]))
      .toThrow('capabilities must be an array');
    expect(() => mergeCapabilityReports([report({ requiredFailures: {} })]))
      .toThrow('requiredFailures must be an array');
    expect(() => mergeCapabilityReports([report({ capabilities: [null] })]))
      .toThrow('item must be an object');
    expect(() => mergeCapabilityReports([report({ capabilities: [{ name: '', status: 'supported', required: false }] })]))
      .toThrow('name must be a non-empty string');
    expect(() => mergeCapabilityReports([report({ capabilities: [{ name: 'x', status: 'other', required: false }] })]))
      .toThrow('invalid status');
    expect(() => mergeCapabilityReports([report({ capabilities: [{ name: 'x', status: 'supported', required: 'yes' }] })]))
      .toThrow('required must be boolean');
  });
});
