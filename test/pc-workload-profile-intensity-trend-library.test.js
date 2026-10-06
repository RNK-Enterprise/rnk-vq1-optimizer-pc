import { WORKLOAD_INTENSITY_TREND_LIBRARY_ID, mergeWorkloadIntensityTrendReports,
  buildWorkloadIntensityTrendPlan, buildWorkloadIntensityTrendEnvelope,
  createWorkloadIntensityTrendLibrary } from '../pc/engines/workload-profile/turbos/intensity-trend/library.js';

function report(overrides = {}) {
  return { turbo: 'workload-profile.intensity-trend', state: 'stable-intensity', sampleCount: 4, minimumSamples: 2,
    persistenceThreshold: 2, observedCount: 4, unknownCount: 0, comparisonCount: 3, changedCount: 0,
    risingCount: 0, fallingCount: 0, finalIntensity: 50, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('workload-profile intensity-trend library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeWorkloadIntensityTrendReports([report(), report({ state: 'intensity-rise-sustained', risingCount: 2, finalIntensity: 90, finalEnvironment: 'headless' })]);
    expect(merged).toMatchObject({ library: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, reportCount: 2, state: 'intensity-rise-sustained', sampleCount: 8, risingCount: 2, finalIntensity: 90, finalEnvironment: 'headless' });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('applies precedence and builds every plan mode', () => {
    const states = ['observation-required', 'intensity-unknown', 'intensity-rise-sustained', 'intensity-fall-sustained', 'intensity-rise-observed', 'intensity-fall-observed', 'high-intensity', 'low-intensity', 'insufficient-data', 'stable-intensity'];
    expect(mergeWorkloadIntensityTrendReports([report({ state: 'observation-required' }), report({ state: 'intensity-rise-sustained' })]).state).toBe('observation-required');
    const modes = ['evidence-bootstrap', 'evidence-bootstrap', 'intensity-review', 'intensity-review', 'intensity-observation', 'intensity-observation', 'intensity-boundary-review', 'intensity-boundary-review', 'sample-bootstrap', 'stable-observation'];
    states.forEach((state, index) => expect(buildWorkloadIntensityTrendPlan(report({ state, sampleCount: state === 'insufficient-data' ? 0 : 4, finalIntensity: state === 'intensity-unknown' ? null : 50 }), 'interactive')).toMatchObject({ state, mode: modes[index] }));
    states.forEach((state) => expect(mergeWorkloadIntensityTrendReports([report({ state, sampleCount: state === 'insufficient-data' ? 0 : 4, observedCount: state === 'intensity-unknown' ? 0 : 4, unknownCount: state === 'observation-required' ? 1 : 0, finalIntensity: state === 'intensity-unknown' ? null : 50 })]).state).toBe(state));
    expect(buildWorkloadIntensityTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildWorkloadIntensityTrendPlan(report(), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required' });
  });
  test('builds envelopes and facades', () => {
    const envelope = buildWorkloadIntensityTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(createWorkloadIntensityTrendLibrary().merge([]).state).toBe('insufficient-data');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeWorkloadIntensityTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeWorkloadIntensityTrendReports(new Array(65).fill(report()))).toThrow('at most 64');
    expect(() => mergeWorkloadIntensityTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkloadIntensityTrendReports([report({ turbo: 'other' })])).toThrow('requires an intensity-trend turbo report');
    expect(() => mergeWorkloadIntensityTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeWorkloadIntensityTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount');
    expect(() => mergeWorkloadIntensityTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples');
    expect(() => mergeWorkloadIntensityTrendReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold');
    expect(() => mergeWorkloadIntensityTrendReports([report({ observedCount: -1 })])).toThrow('observed count');
    expect(() => mergeWorkloadIntensityTrendReports([report({ finalIntensity: 101 })])).toThrow('finalIntensity');
    expect(() => mergeWorkloadIntensityTrendReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment');
    expect(() => mergeWorkloadIntensityTrendReports([report({ confidence: 2 })])).toThrow('confidence');
    expect(() => buildWorkloadIntensityTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildWorkloadIntensityTrendEnvelope(report(), { trigger: '', now: () => 0 })).toThrow('trigger is required');
    expect(() => buildWorkloadIntensityTrendEnvelope(report(), { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
