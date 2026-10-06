import {
  PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_ID,
  PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_VERSION,
  buildProcessLifecycleUptimeChurnEnvelope,
  buildProcessLifecycleUptimeChurnPlan,
  createProcessLifecycleUptimeChurnLibrary,
  mergeProcessLifecycleUptimeChurnReports
} from '../pc/engines/process-lifecycle/turbos/uptime-churn/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-lifecycle.uptime-churn', state: 'stable-uptime', sampleCount,
    minimumSamples: 2, shortLivedThreshold: 60, persistenceThreshold: 2,
    processCount: 2, shortLivedCount: 0, maximumUptimeSeconds: 120,
    observedCount: sampleCount, incompleteCount: 0, noProcessCount: 0,
    shortLivedSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('process-lifecycle uptime-churn library', () => {
  test('publishes identity and merges uptime evidence', () => {
    const merged = mergeProcessLifecycleUptimeChurnReports([
      report({ sampleCount: 2, shortLivedCount: 1, maximumUptimeSeconds: 20, shortLivedSampleCount: 1 }),
      report({ state: 'short-lived-sustained', sampleCount: 6, observedCount: 5,
        shortLivedCount: 1, maximumUptimeSeconds: 30, shortLivedSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_ID).toBe('process-lifecycle.uptime-churn.library');
    expect(PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'short-lived-sustained', sampleCount: 8,
      shortLivedCount: 1, maximumUptimeSeconds: 30, shortLivedSampleCount: 4,
      confidence: 0.875, recommendations: ['review-process-churn', 'hold-restart-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessLifecycleUptimeChurnReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessLifecycleUptimeChurnReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, shortLivedCount: 0, maximumUptimeSeconds: null,
      observedCount: 0, noProcessCount: 1, shortLivedSampleCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-processes', recommendations: ['no-process-lifecycle-review'] });
    expect(mergeProcessLifecycleUptimeChurnReports([report({ state: 'incomplete-uptime-evidence',
      maximumUptimeSeconds: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-uptime-evidence', recommendations: ['request-uptime-observation'] });
    expect(mergeProcessLifecycleUptimeChurnReports([report({ state: 'short-lived-observed', shortLivedCount: 1,
      maximumUptimeSeconds: 20, shortLivedSampleCount: 1 })]).recommendations).toEqual(['observe-next-uptime-sample']);
    expect(mergeProcessLifecycleUptimeChurnReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessLifecycleUptimeChurnReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessLifecycleUptimeChurnReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, maximumUptimeSeconds: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessLifecycleUptimeChurnReports([
      report({ state: 'short-lived-sustained' }), report({ state: 'no-processes', sampleCount: 1,
        processCount: 0, shortLivedCount: 0, maximumUptimeSeconds: null,
        observedCount: 0, noProcessCount: 1, shortLivedSampleCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['short-lived-sustained', 'process-churn-review', 750], ['short-lived-observed', 'process-churn-observation', 1000],
      ['stable-uptime', 'stable-uptime-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['incomplete-uptime-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessLifecycleUptimeChurnPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, shortLivedCount: 0,
        maximumUptimeSeconds: empty ? null : 120, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessLifecycleUptimeChurnPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessLifecycleUptimeChurnPlan(report({ sampleCount: 0, processCount: 0,
      maximumUptimeSeconds: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessLifecycleUptimeChurnEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessLifecycleUptimeChurnLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_LIFECYCLE_UPTIME_CHURN_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0,
      maximumUptimeSeconds: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeProcessLifecycleUptimeChurnReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessLifecycleUptimeChurnReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessLifecycleUptimeChurnReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ turbo: 'other' })])).toThrow('requires an uptime-churn turbo report');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ shortLivedThreshold: 86401 })])).toThrow('shortLivedThreshold must be between 0 and 86400');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount', 'shortLivedSampleCount']) {
      expect(() => mergeProcessLifecycleUptimeChurnReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ shortLivedCount: 3 })])).toThrow('shortLivedCount must fit inside processCount');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ maximumUptimeSeconds: -1 })])).toThrow('maximumUptimeSeconds must be null or non-negative');
    expect(() => mergeProcessLifecycleUptimeChurnReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessLifecycleUptimeChurnEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessLifecycleUptimeChurnEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
