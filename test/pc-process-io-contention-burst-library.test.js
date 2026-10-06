import {
  PROCESS_IO_CONTENTION_BURST_LIBRARY_ID,
  PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION,
  buildProcessIoContentionBurstEnvelope,
  buildProcessIoContentionBurstPlan,
  createProcessIoContentionBurstLibrary,
  mergeProcessIoContentionBurstReports
} from '../pc/engines/process-io/turbos/contention-burst/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-io.contention-burst', state: 'stable-contention', sampleCount,
    minimumSamples: 2, contentionThreshold: 30, persistenceThreshold: 2,
    processCount: 2, maximumWaitPercent: 5, totalReadBytesPerSecond: 100,
    totalWriteBytesPerSecond: 50, observedCount: sampleCount, incompleteCount: 0,
    disabledCount: 0, noProcessCount: 0, contentionCount: 0, confidence: 1, ...overrides
  };
}

describe('process-io contention-burst library', () => {
  test('publishes identity and merges contention evidence', () => {
    const merged = mergeProcessIoContentionBurstReports([
      report({ sampleCount: 2, contentionCount: 1, maximumWaitPercent: 35 }),
      report({ state: 'contention-sustained', sampleCount: 6, observedCount: 5,
        contentionCount: 3, maximumWaitPercent: 45, confidence: 0.8333 })
    ]);
    expect(PROCESS_IO_CONTENTION_BURST_LIBRARY_ID).toBe('process-io.contention-burst.library');
    expect(PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'contention-sustained', sampleCount: 8,
      contentionCount: 4, maximumWaitPercent: 45, confidence: 0.875,
      recommendations: ['protect-services', 'review-storage-contention'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessIoContentionBurstReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessIoContentionBurstReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, maximumWaitPercent: null, totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null, observedCount: 0, noProcessCount: 1, confidence: 0 })])
    ).toMatchObject({ state: 'no-processes', recommendations: ['no-process-io-review'] });
    expect(mergeProcessIoContentionBurstReports([report({ state: 'observation-disabled',
      disabledCount: 1, maximumWaitPercent: null, confidence: 0 })])).toMatchObject({
      state: 'observation-disabled', recommendations: ['keep-process-io-observation-disabled']
    });
    expect(mergeProcessIoContentionBurstReports([report({ state: 'incomplete-contention-evidence',
      incompleteCount: 1, maximumWaitPercent: null, confidence: 0 })])).toMatchObject({
      state: 'incomplete-contention-evidence', recommendations: ['request-process-io-observation']
    });
    expect(mergeProcessIoContentionBurstReports([report({ state: 'contention-observed', contentionCount: 1 })])
      .recommendations).toEqual(['observe-next-contention-sample']);
    expect(mergeProcessIoContentionBurstReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessIoContentionBurstReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessIoContentionBurstReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, observedCount: 0, maximumWaitPercent: null,
      totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessIoContentionBurstReports([
      report({ state: 'contention-sustained' }), report({ state: 'observation-disabled', disabledCount: 1,
        maximumWaitPercent: null, confidence: 0 })
    ])).toMatchObject({ state: 'observation-disabled' });
    const states = [
      ['contention-sustained', 'contention-review', 750], ['contention-observed', 'contention-observation', 1000],
      ['stable-contention', 'stable-contention-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['observation-disabled', 'disabled-observation', 10000],
      ['incomplete-contention-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const disabled = state === 'observation-disabled';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty || disabled ? 0 : 1;
      expect(buildProcessIoContentionBurstPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, maximumWaitPercent: empty || disabled ? null : 5,
        totalReadBytesPerSecond: empty || disabled ? null : 100,
        totalWriteBytesPerSecond: empty || disabled ? null : 50,
        observedCount: empty || disabled ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, disabledCount: disabled ? sampleCount : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessIoContentionBurstPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessIoContentionBurstPlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, maximumWaitPercent: null, totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessIoContentionBurstEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_IO_CONTENTION_BURST_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessIoContentionBurstLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_IO_CONTENTION_BURST_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, observedCount: 0,
      maximumWaitPercent: null, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, rates, triggers, and clocks', () => {
    expect(() => mergeProcessIoContentionBurstReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessIoContentionBurstReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessIoContentionBurstReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessIoContentionBurstReports([report({ turbo: 'other' })])).toThrow('requires a contention-burst turbo report');
    expect(() => mergeProcessIoContentionBurstReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessIoContentionBurstReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessIoContentionBurstReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessIoContentionBurstReports([report({ contentionThreshold: 101 })])).toThrow('contentionThreshold must be between 0 and 100');
    expect(() => mergeProcessIoContentionBurstReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'disabledCount', 'noProcessCount', 'contentionCount']) {
      expect(() => mergeProcessIoContentionBurstReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessIoContentionBurstReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessIoContentionBurstReports([report({ maximumWaitPercent: 101 })])).toThrow('maximumWaitPercent must be null or between 0 and 100');
    expect(() => mergeProcessIoContentionBurstReports([report({ totalReadBytesPerSecond: -1 })])).toThrow('totalReadBytesPerSecond must be null or non-negative');
    expect(() => mergeProcessIoContentionBurstReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessIoContentionBurstEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessIoContentionBurstEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
