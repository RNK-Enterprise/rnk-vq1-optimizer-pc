import { STARTUP_ENTRY_DRIFT_LIBRARY_ID, STARTUP_ENTRY_DRIFT_LIBRARY_VERSION,
  buildStartupEntryDriftEnvelope, buildStartupEntryDriftPlan, createStartupEntryDriftLibrary,
  mergeStartupEntryDriftReports } from '../pc/engines/startup/turbos/entry-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'startup.entry-drift', state: 'stable-startup', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    entryCount: 1, unknownCount: 0, requiredDisabledCount: 0, userOwnedEnabledCount: 0, namedCount: 1, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('startup entry-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeStartupEntryDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'entry-drift-sustained', changeCount: 2, finalEnvironment: 'headless' })]);
    expect(STARTUP_ENTRY_DRIFT_LIBRARY_ID).toBe('startup.entry-drift.library'); expect(STARTUP_ENTRY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'entry-drift-sustained', sampleCount: 6, entryCount: 1, unknownCount: 0, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-startup-entry-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeStartupEntryDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-startup-entry-samples'] });
    expect(mergeStartupEntryDriftReports([report({ state: 'no-startup-items', entryCount: 0, namedCount: 0, comparisonCount: 0, confidence: 0.25 })]).recommendations).toEqual(['no-startup-review']);
    expect(mergeStartupEntryDriftReports([report({ state: 'observation-required', unknownCount: 1, confidence: 0.5 })]).recommendations).toEqual(['request-startup-observation']);
    expect(mergeStartupEntryDriftReports([report({ state: 'required-review', requiredDisabledCount: 1 })]).recommendations).toEqual(['review-required-startup-owner']);
    expect(mergeStartupEntryDriftReports([report({ state: 'user-owned-review', userOwnedEnabledCount: 1 })]).recommendations).toEqual(['review-user-owned-startup-items']);
    expect(mergeStartupEntryDriftReports([report({ state: 'entry-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-startup-entry-stability']);
    expect(mergeStartupEntryDriftReports([report({ state: 'insufficient-data', sampleCount: 1, entryCount: 0, namedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStartupEntryDriftReports([report()])).toMatchObject({ state: 'stable-startup', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['no-startup-items', 'empty-observation', 10000, 4, 0.25], ['observation-required', 'evidence-bootstrap', 2000, 4, 0.5], ['required-review', 'required-startup-review', 750, 4, 1], ['user-owned-review', 'user-owned-startup-review', 1000, 4, 1], ['entry-drift-sustained', 'entry-drift-review', 1250, 4, 1], ['entry-drift-observed', 'entry-drift-observation', 1500, 4, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-startup', 'stable-observation', 5000, 4, 1]]) {
      expect(buildStartupEntryDriftPlan(report({ state, sampleCount, entryCount: state === 'no-startup-items' || state === 'insufficient-data' ? 0 : 1, unknownCount: state === 'observation-required' ? 1 : 0, requiredDisabledCount: state === 'required-review' ? 1 : 0, userOwnedEnabledCount: state === 'user-owned-review' ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildStartupEntryDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStartupEntryDriftPlan(report({ sampleCount: 0, entryCount: 0, namedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildStartupEntryDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStartupEntryDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STARTUP_ENTRY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeStartupEntryDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeStartupEntryDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStartupEntryDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeStartupEntryDriftReports([report({ turbo: 'other' })])).toThrow('requires an entry-drift turbo report');
    expect(() => mergeStartupEntryDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStartupEntryDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStartupEntryDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStartupEntryDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeStartupEntryDriftReports([report({ entryCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeStartupEntryDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeStartupEntryDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStartupEntryDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStartupEntryDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
