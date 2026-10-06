import {
  PROCESS_IO_SERVICE_CONTENTION_LIBRARY_ID,
  PROCESS_IO_SERVICE_CONTENTION_LIBRARY_VERSION,
  buildProcessIoServiceContentionEnvelope,
  buildProcessIoServiceContentionPlan,
  createProcessIoServiceContentionLibrary,
  mergeProcessIoServiceContentionReports
} from '../pc/engines/process-io/turbos/service-contention/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-io.service-contention', state: 'service-contention-clear', sampleCount,
    minimumSamples: 2, contentionThreshold: 30, persistenceThreshold: 2,
    processCount: 2, serviceCount: 1, maximumServiceWaitPercent: 5,
    observedCount: sampleCount, incompleteCount: 0, disabledCount: 0, noProcessCount: 0,
    contentionCount: 0, serviceSampleCount: sampleCount, confidence: 1, ...overrides
  };
}

describe('process-io service-contention library', () => {
  test('publishes identity and merges service evidence', () => {
    const merged = mergeProcessIoServiceContentionReports([
      report({ sampleCount: 2, contentionCount: 1, maximumServiceWaitPercent: 35 }),
      report({ state: 'service-contention-sustained', sampleCount: 6, observedCount: 5,
        contentionCount: 3, maximumServiceWaitPercent: 45, confidence: 0.8333 })
    ]);
    expect(PROCESS_IO_SERVICE_CONTENTION_LIBRARY_ID).toBe('process-io.service-contention.library');
    expect(PROCESS_IO_SERVICE_CONTENTION_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'service-contention-sustained', sampleCount: 8,
      contentionCount: 4, serviceSampleCount: 8, maximumServiceWaitPercent: 45,
      confidence: 0.875, recommendations: ['protect-services', 'review-service-storage-contention'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessIoServiceContentionReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessIoServiceContentionReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, serviceCount: 0, maximumServiceWaitPercent: null,
      observedCount: 0, noProcessCount: 1, serviceSampleCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-processes', recommendations: ['no-process-io-review'] });
    expect(mergeProcessIoServiceContentionReports([report({ state: 'observation-disabled',
      maximumServiceWaitPercent: null, serviceSampleCount: 0, disabledCount: 1, confidence: 0 })])).toMatchObject({ state: 'observation-disabled', recommendations: ['keep-process-io-observation-disabled'] });
    expect(mergeProcessIoServiceContentionReports([report({ state: 'incomplete-service-evidence',
      maximumServiceWaitPercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-service-evidence', recommendations: ['request-service-io-observation'] });
    expect(mergeProcessIoServiceContentionReports([report({ state: 'service-contention-observed', contentionCount: 1 })]).recommendations).toEqual(['observe-next-service-sample']);
    expect(mergeProcessIoServiceContentionReports([report({ state: 'no-services', serviceCount: 0, serviceSampleCount: 0 })]).recommendations).toEqual(['request-service-role-observation']);
    expect(mergeProcessIoServiceContentionReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessIoServiceContentionReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, serviceCount: 1, observedCount: 0, serviceSampleCount: 1, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessIoServiceContentionReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, serviceCount: 0, observedCount: 0, serviceSampleCount: 0,
      maximumServiceWaitPercent: null, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessIoServiceContentionReports([
      report({ state: 'service-contention-sustained' }), report({ state: 'observation-disabled', disabledCount: 1,
        maximumServiceWaitPercent: null, serviceSampleCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'observation-disabled' });
    const states = [
      ['service-contention-sustained', 'service-contention-review', 750],
      ['service-contention-observed', 'service-contention-observation', 1000],
      ['service-contention-clear', 'service-contention-observation', 5000],
      ['no-services', 'service-role-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['observation-disabled', 'disabled-observation', 10000],
      ['incomplete-service-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const disabled = state === 'observation-disabled';
      const noServices = state === 'no-services';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty || disabled ? 0 : 1;
      expect(buildProcessIoServiceContentionPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, serviceCount: empty || noServices ? 0 : 1,
        maximumServiceWaitPercent: empty || disabled || noServices ? null : 5,
        observedCount: empty || disabled ? 0 : sampleCount, noProcessCount: empty ? 1 : 0,
        disabledCount: disabled ? sampleCount : 0, serviceSampleCount: noServices ? 0 : sampleCount,
        confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessIoServiceContentionPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessIoServiceContentionPlan(report({ sampleCount: 0, processCount: 0,
      serviceCount: 0, observedCount: 0, serviceSampleCount: 0, maximumServiceWaitPercent: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessIoServiceContentionEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_IO_SERVICE_CONTENTION_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessIoServiceContentionLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_IO_SERVICE_CONTENTION_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, serviceCount: 0,
      observedCount: 0, serviceSampleCount: 0, maximumServiceWaitPercent: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeProcessIoServiceContentionReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessIoServiceContentionReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessIoServiceContentionReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessIoServiceContentionReports([report({ turbo: 'other' })])).toThrow('requires a service-contention turbo report');
    expect(() => mergeProcessIoServiceContentionReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessIoServiceContentionReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessIoServiceContentionReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessIoServiceContentionReports([report({ contentionThreshold: 101 })])).toThrow('contentionThreshold must be between 0 and 100');
    expect(() => mergeProcessIoServiceContentionReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'disabledCount', 'noProcessCount', 'contentionCount', 'serviceSampleCount']) {
      expect(() => mergeProcessIoServiceContentionReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessIoServiceContentionReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessIoServiceContentionReports([report({ serviceCount: 3 })])).toThrow('serviceCount must fit inside processCount');
    expect(() => mergeProcessIoServiceContentionReports([report({ maximumServiceWaitPercent: 101 })])).toThrow('maximumServiceWaitPercent must be null or between 0 and 100');
    expect(() => mergeProcessIoServiceContentionReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessIoServiceContentionEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessIoServiceContentionEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
