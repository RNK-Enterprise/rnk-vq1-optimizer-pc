import { WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, mergeWorkloadContextDriftReports,
  buildWorkloadContextDriftPlan, buildWorkloadContextDriftEnvelope,
  createWorkloadContextDriftLibrary } from '../pc/engines/workload-profile/turbos/context-drift/library.js';

function report(overrides = {}) {
  return { turbo: 'workload-profile.context-drift', state: 'stable-context', sampleCount: 4,
    minimumSamples: 2, persistenceThreshold: 2, observedCount: 4, unknownCount: 0,
    comparisonCount: 3, changeCount: 0, environmentChangeCount: 0, kindChangeCount: 0,
    finalEnvironment: 'interactive', finalWorkloadKind: 'gaming', finalWorkloadName: 'Game', confidence: 1, ...overrides };
}

describe('workload-profile context-drift library', () => {
  test('publishes identity and merges bounded reports', () => {
    const merged = mergeWorkloadContextDriftReports([report(), report({ state: 'context-drift-sustained', changeCount: 2, finalEnvironment: 'headless', finalWorkloadKind: 'server' })]);
    expect(merged).toMatchObject({ library: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, reportCount: 2,
      state: 'context-drift-sustained', sampleCount: 8, observedCount: 8, changeCount: 2,
      finalEnvironment: 'headless', finalWorkloadKind: 'server', recommendations: ['review-workload-context-drift'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('applies state precedence and builds every plan mode', () => {
    expect(mergeWorkloadContextDriftReports([report({ state: 'profile-required' }), report({ state: 'context-drift-sustained' })]).state).toBe('profile-required');
    expect(mergeWorkloadContextDriftReports([report({ state: 'observation-required' }), report({ state: 'context-drift-observed' })]).state).toBe('observation-required');
    expect(mergeWorkloadContextDriftReports([report({ state: 'context-drift-observed' }), report()]).state).toBe('context-drift-observed');
    expect(mergeWorkloadContextDriftReports([report({ state: 'insufficient-data' }), report({ state: 'insufficient-data', sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0 })]).state).toBe('insufficient-data');
    expect(mergeWorkloadContextDriftReports([report(), report()])).toMatchObject({ state: 'stable-context', recommendations: ['no-change'] });
    const states = [['profile-required', 'profile-required'], ['observation-required', 'evidence-bootstrap'], ['context-drift-sustained', 'context-drift-review'], ['context-drift-observed', 'context-drift-observation'], ['insufficient-data', 'sample-bootstrap'], ['stable-context', 'stable-observation']];
    for (const [state, mode] of states) expect(buildWorkloadContextDriftPlan(report({ state, sampleCount: state === 'insufficient-data' ? 0 : 4 }), 'interactive')).toMatchObject({ state, mode });
    expect(buildWorkloadContextDriftPlan(report({ state: 'stable-context' }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildWorkloadContextDriftPlan(report({ state: 'stable-context' }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required' });
  });
  test('builds envelopes and immutable facades', () => {
    const envelope = buildWorkloadContextDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const facade = createWorkloadContextDriftLibrary();
    expect(facade.id).toBe(WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID);
    expect(facade.merge([]).state).toBe('insufficient-data');
  });
  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeWorkloadContextDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeWorkloadContextDriftReports(new Array(65).fill(report()))).toThrow('at most 64');
    expect(() => mergeWorkloadContextDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkloadContextDriftReports([report({ turbo: 'other' })])).toThrow('requires a context-drift turbo report');
    expect(() => mergeWorkloadContextDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeWorkloadContextDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount');
    expect(() => mergeWorkloadContextDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples');
    expect(() => mergeWorkloadContextDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold');
    expect(() => mergeWorkloadContextDriftReports([report({ observedCount: -1 })])).toThrow('observed count');
    expect(() => mergeWorkloadContextDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment');
    expect(() => mergeWorkloadContextDriftReports([report({ finalWorkloadKind: 'other' })])).toThrow('finalWorkloadKind');
    expect(() => mergeWorkloadContextDriftReports([report({ finalWorkloadName: 2 })])).toThrow('finalWorkloadName');
    expect(() => mergeWorkloadContextDriftReports([report({ confidence: 2 })])).toThrow('confidence');
    expect(() => buildWorkloadContextDriftPlan(report(), 'interactive')).not.toThrow();
    expect(() => buildWorkloadContextDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildWorkloadContextDriftEnvelope(report(), { trigger: '', now: () => 0 })).toThrow('trigger is required');
    expect(() => buildWorkloadContextDriftEnvelope(report(), { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
