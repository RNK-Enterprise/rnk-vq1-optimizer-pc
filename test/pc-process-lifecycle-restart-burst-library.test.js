import {
  PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID,
  PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION,
  buildProcessLifecycleRestartBurstEnvelope,
  buildProcessLifecycleRestartBurstPlan,
  createProcessLifecycleRestartBurstLibrary,
  mergeProcessLifecycleRestartBurstReports
} from '../pc/engines/process-lifecycle/turbos/restart-burst/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-lifecycle.restart-burst', state: 'stable-lifecycle', sampleCount,
    minimumSamples: 2, restartThreshold: 1, persistenceThreshold: 2,
    processCount: 2, totalRestartCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noProcessCount: 0, restartSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('process-lifecycle restart-burst library', () => {
  test('publishes identity and merges restart evidence', () => {
    const merged = mergeProcessLifecycleRestartBurstReports([
      report({ sampleCount: 2, totalRestartCount: 2, restartSampleCount: 1 }),
      report({ state: 'restart-burst-sustained', sampleCount: 6, observedCount: 5,
        totalRestartCount: 3, restartSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID).toBe('process-lifecycle.restart-burst.library');
    expect(PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'restart-burst-sustained', sampleCount: 8,
      totalRestartCount: 3, restartSampleCount: 4, confidence: 0.875,
      recommendations: ['review-restart-policy', 'hold-unapproved-lifecycle-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessLifecycleRestartBurstReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessLifecycleRestartBurstReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, totalRestartCount: null, observedCount: 0, noProcessCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-processes', recommendations: ['no-process-lifecycle-review'] });
    expect(mergeProcessLifecycleRestartBurstReports([report({ state: 'incomplete-restart-evidence',
      totalRestartCount: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-restart-evidence', recommendations: ['request-restart-observation'] });
    expect(mergeProcessLifecycleRestartBurstReports([report({ state: 'restart-burst-observed',
      totalRestartCount: 1, restartSampleCount: 1 })]).recommendations).toEqual(['observe-next-restart-sample']);
    expect(mergeProcessLifecycleRestartBurstReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessLifecycleRestartBurstReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessLifecycleRestartBurstReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, totalRestartCount: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessLifecycleRestartBurstReports([
      report({ state: 'restart-burst-sustained' }), report({ state: 'no-processes', sampleCount: 1,
        processCount: 0, totalRestartCount: null, observedCount: 0, noProcessCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['restart-burst-sustained', 'restart-policy-review', 750], ['restart-burst-observed', 'restart-policy-observation', 1000],
      ['stable-lifecycle', 'stable-lifecycle-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['incomplete-restart-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessLifecycleRestartBurstPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, totalRestartCount: empty ? null : 0,
        observedCount: empty ? 0 : sampleCount, noProcessCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessLifecycleRestartBurstPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessLifecycleRestartBurstPlan(report({ sampleCount: 0, processCount: 0,
      totalRestartCount: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessLifecycleRestartBurstEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessLifecycleRestartBurstLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, totalRestartCount: null,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeProcessLifecycleRestartBurstReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessLifecycleRestartBurstReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessLifecycleRestartBurstReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ turbo: 'other' })])).toThrow('requires a restart-burst turbo report');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ restartThreshold: 0 })])).toThrow('restartThreshold must be from 1 to 4096');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount', 'restartSampleCount']) {
      expect(() => mergeProcessLifecycleRestartBurstReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ totalRestartCount: -1 })])).toThrow('totalRestartCount must be null or non-negative');
    expect(() => mergeProcessLifecycleRestartBurstReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessLifecycleRestartBurstEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessLifecycleRestartBurstEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
