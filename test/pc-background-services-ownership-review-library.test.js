import { BACKGROUND_OWNERSHIP_LIBRARY_ID, BACKGROUND_OWNERSHIP_LIBRARY_VERSION,
  buildBackgroundOwnershipEnvelope, buildBackgroundOwnershipPlan, createBackgroundOwnershipLibrary,
  mergeBackgroundOwnershipReports } from '../pc/engines/background-services/turbos/ownership-review/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'background-services.ownership-review', state: 'system-owned-observe', sampleCount,
    minimumSamples: 2, serviceCount: 2, userOwnedCount: 0, systemOwnedCount: 2, unknownOwnershipCount: 0,
    comparisonCount: overrides.comparisonCount ?? Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('background-services ownership-review library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBackgroundOwnershipReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'user-owned-review', userOwnedCount: 1, systemOwnedCount: 1, changeCount: 1, finalEnvironment: 'headless' })]);
    expect(BACKGROUND_OWNERSHIP_LIBRARY_ID).toBe('background-services.ownership-review.library');
    expect(BACKGROUND_OWNERSHIP_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'user-owned-review', sampleCount: 6, serviceCount: 2, userOwnedCount: 1, systemOwnedCount: 1, comparisonCount: 4, changeCount: 1, finalEnvironment: 'headless', recommendations: ['preserve-user-owned-service-boundary'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBackgroundOwnershipReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-service-ownership-samples'] });
    expect(mergeBackgroundOwnershipReports([report({ state: 'ownership-observation-required', unknownOwnershipCount: 1 })]).recommendations).toEqual(['request-explicit-service-ownership']);
    expect(mergeBackgroundOwnershipReports([report({ state: 'no-services', serviceCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 })]).recommendations).toEqual(['no-background-service-review']);
    expect(mergeBackgroundOwnershipReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBackgroundOwnershipReports([report({ state: 'insufficient-data', sampleCount: 1, serviceCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs] of [['user-owned-review', 'user-boundary', 750], ['ownership-observation-required', 'ownership-bootstrap', 2000], ['no-services', 'empty-observation', 10000], ['insufficient-data', 'sample-bootstrap', 2000], ['system-owned-observe', 'stable-observation', 5000]]) {
      const empty = state === 'no-services' || state === 'insufficient-data'; const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      expect(buildBackgroundOwnershipPlan(report({ state, sampleCount, serviceCount: empty ? 0 : 2, systemOwnedCount: empty ? 0 : 2, comparisonCount: Math.max(0, sampleCount - 1), confidence: empty ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBackgroundOwnershipPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBackgroundOwnershipPlan(report({ sampleCount: 0, serviceCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBackgroundOwnershipEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBackgroundOwnershipLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BACKGROUND_OWNERSHIP_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBackgroundOwnershipReports(null)).toThrow('reports must be an array');
    expect(() => mergeBackgroundOwnershipReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBackgroundOwnershipReports([null])).toThrow('report must be an object');
    expect(() => mergeBackgroundOwnershipReports([report({ turbo: 'other' })])).toThrow('requires an ownership-review turbo report');
    expect(() => mergeBackgroundOwnershipReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBackgroundOwnershipReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBackgroundOwnershipReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBackgroundOwnershipReports([report({ serviceCount: 4097 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBackgroundOwnershipReports([report({ comparisonCount: 4 })])).toThrow('comparisonCount must fit inside the sample window');
    expect(() => mergeBackgroundOwnershipReports([report({ comparisonCount: 1, changeCount: 2 })])).toThrow('changeCount must fit inside comparisonCount');
    expect(() => mergeBackgroundOwnershipReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBackgroundOwnershipReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBackgroundOwnershipEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBackgroundOwnershipEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
