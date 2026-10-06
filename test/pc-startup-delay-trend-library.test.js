import { STARTUP_DELAY_TREND_LIBRARY_ID, STARTUP_DELAY_TREND_LIBRARY_VERSION,
  buildStartupDelayTrendEnvelope, buildStartupDelayTrendPlan, createStartupDelayTrendLibrary,
  mergeStartupDelayTrendReports } from '../pc/engines/startup/turbos/delay-trend/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'startup.delay-trend', state: 'stable-delay', sampleCount, minimumSamples: 2, delayThresholdMs: 50, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, risingCount: 0, fallingCount: 0,
    finalMaximumDelayMs: 100, finalEntryCount: 1, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('startup delay-trend library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeStartupDelayTrendReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'delay-rising-sustained', risingCount: 2, finalMaximumDelayMs: 300, finalEnvironment: 'headless' })]);
    expect(STARTUP_DELAY_TREND_LIBRARY_ID).toBe('startup.delay-trend.library'); expect(STARTUP_DELAY_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'delay-rising-sustained', sampleCount: 6, observedCount: 6, unknownCount: 0, comparisonCount: 4, risingCount: 2, fallingCount: 0, delayThresholdMs: 50, finalMaximumDelayMs: 300, finalEntryCount: 1, finalEnvironment: 'headless', recommendations: ['review-startup-delay-growth-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeStartupDelayTrendReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-startup-delay-samples'] });
    expect(mergeStartupDelayTrendReports([report({ state: 'no-startup-items', finalEntryCount: 0, finalMaximumDelayMs: null, confidence: 0 })]).recommendations).toEqual(['no-startup-review']);
    expect(mergeStartupDelayTrendReports([report({ state: 'delay-unknown', observedCount: 0, unknownCount: 2, finalMaximumDelayMs: null, confidence: 0 })]).recommendations).toEqual(['request-startup-delay-observation']);
    expect(mergeStartupDelayTrendReports([report({ state: 'delay-observation-required', observedCount: 3, unknownCount: 1, confidence: 0.75 })]).recommendations).toEqual(['request-complete-startup-delay-observation']);
    expect(mergeStartupDelayTrendReports([report({ state: 'delay-falling-sustained', fallingCount: 2 })]).recommendations).toEqual(['observe-startup-delay-recovery']);
    expect(mergeStartupDelayTrendReports([report({ state: 'delay-rising-observed', risingCount: 1 })]).recommendations).toEqual(['observe-startup-delay-stability']);
    expect(mergeStartupDelayTrendReports([report({ state: 'delay-falling-observed', fallingCount: 1 })]).recommendations).toEqual(['observe-startup-delay-recovery']);
    expect(mergeStartupDelayTrendReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, finalMaximumDelayMs: null, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStartupDelayTrendReports([report()])).toMatchObject({ state: 'stable-delay', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['no-startup-items', 'empty-observation', 10000, 4, 0], ['delay-unknown', 'evidence-bootstrap', 2000, 4, 0], ['delay-observation-required', 'evidence-bootstrap', 2000, 4, 0.75], ['delay-rising-sustained', 'delay-growth-review', 1000, 4, 1], ['delay-falling-sustained', 'delay-recovery-review', 1250, 4, 1], ['delay-rising-observed', 'delay-growth-observation', 1500, 4, 1], ['delay-falling-observed', 'delay-recovery-observation', 1500, 4, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-delay', 'stable-observation', 5000, 4, 1]]) {
      expect(buildStartupDelayTrendPlan(report({ state, sampleCount, observedCount: state === 'delay-unknown' || state === 'insufficient-data' ? 0 : sampleCount, unknownCount: state === 'delay-unknown' ? sampleCount : 0, finalEntryCount: state === 'no-startup-items' || state === 'insufficient-data' ? 0 : 1, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildStartupDelayTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStartupDelayTrendPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, finalMaximumDelayMs: null, finalEntryCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildStartupDelayTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStartupDelayTrendLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STARTUP_DELAY_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeStartupDelayTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeStartupDelayTrendReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStartupDelayTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeStartupDelayTrendReports([report({ turbo: 'other' })])).toThrow('requires a delay-trend turbo report');
    expect(() => mergeStartupDelayTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStartupDelayTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStartupDelayTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStartupDelayTrendReports([report({ delayThresholdMs: 0 })])).toThrow('delayThresholdMs must be from 1 to 5000');
    expect(() => mergeStartupDelayTrendReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeStartupDelayTrendReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeStartupDelayTrendReports([report({ finalMaximumDelayMs: 'bad' })])).toThrow('final maximum delay must be numeric or null');
    expect(() => mergeStartupDelayTrendReports([report({ finalMaximumDelayMs: -1 })])).toThrow('final maximum delay must be non-negative');
    expect(() => mergeStartupDelayTrendReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeStartupDelayTrendReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStartupDelayTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStartupDelayTrendEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
