import { STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID, STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION,
  buildStartupRequirednessDriftEnvelope, buildStartupRequirednessDriftPlan, createStartupRequirednessDriftLibrary,
  mergeStartupRequirednessDriftReports } from '../pc/engines/startup/turbos/requiredness-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'startup.requiredness-drift', state: 'stable-requiredness', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    entryCount: 1, requiredCount: 0, requiredDisabledCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('startup requiredness-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeStartupRequirednessDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'requiredness-drift-sustained', changeCount: 2, requiredCount: 1, finalEnvironment: 'headless' })]);
    expect(STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID).toBe('startup.requiredness-drift.library'); expect(STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'requiredness-drift-sustained', sampleCount: 6, entryCount: 1, requiredCount: 1, requiredDisabledCount: 0, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-startup-requiredness-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeStartupRequirednessDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-startup-requiredness-samples'] });
    expect(mergeStartupRequirednessDriftReports([report({ state: 'no-startup-items', entryCount: 0, confidence: 0.25 })]).recommendations).toEqual(['no-startup-review']);
    expect(mergeStartupRequirednessDriftReports([report({ state: 'required-disabled-review', requiredCount: 1, requiredDisabledCount: 1 })]).recommendations).toEqual(['review-required-startup-owner']);
    expect(mergeStartupRequirednessDriftReports([report({ state: 'requiredness-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-startup-requiredness-stability']);
    expect(mergeStartupRequirednessDriftReports([report({ state: 'insufficient-data', sampleCount: 1, entryCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStartupRequirednessDriftReports([report()])).toMatchObject({ state: 'stable-requiredness', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['no-startup-items', 'empty-observation', 10000, 4, 0.25], ['required-disabled-review', 'required-startup-review', 750, 4, 1], ['requiredness-drift-sustained', 'requiredness-drift-review', 1250, 4, 1], ['requiredness-drift-observed', 'requiredness-drift-observation', 1500, 4, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-requiredness', 'stable-observation', 5000, 4, 1]]) {
      expect(buildStartupRequirednessDriftPlan(report({ state, sampleCount, entryCount: state === 'no-startup-items' || state === 'insufficient-data' ? 0 : 1, requiredCount: state === 'required-disabled-review' ? 1 : 0, requiredDisabledCount: state === 'required-disabled-review' ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildStartupRequirednessDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStartupRequirednessDriftPlan(report({ sampleCount: 0, entryCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildStartupRequirednessDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStartupRequirednessDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeStartupRequirednessDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeStartupRequirednessDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStartupRequirednessDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeStartupRequirednessDriftReports([report({ turbo: 'other' })])).toThrow('requires a requiredness-drift turbo report');
    expect(() => mergeStartupRequirednessDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStartupRequirednessDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStartupRequirednessDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStartupRequirednessDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeStartupRequirednessDriftReports([report({ entryCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeStartupRequirednessDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeStartupRequirednessDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStartupRequirednessDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStartupRequirednessDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
