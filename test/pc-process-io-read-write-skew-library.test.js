import {
  PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID,
  PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION,
  buildProcessIoReadWriteSkewEnvelope,
  buildProcessIoReadWriteSkewPlan,
  createProcessIoReadWriteSkewLibrary,
  mergeProcessIoReadWriteSkewReports
} from '../pc/engines/process-io/turbos/read-write-skew/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-io.read-write-skew', state: 'balanced-io', sampleCount,
    minimumSamples: 2, skewRatio: 1.5, persistenceThreshold: 2, processCount: 2,
    totalReadBytesPerSecond: 100, totalWriteBytesPerSecond: 100,
    observedCount: sampleCount, incompleteCount: 0, disabledCount: 0, noProcessCount: 0,
    readSkewCount: 0, writeSkewCount: 0, confidence: 1, ...overrides
  };
}

describe('process-io read-write-skew library', () => {
  test('publishes identity and merges direction evidence', () => {
    const merged = mergeProcessIoReadWriteSkewReports([
      report({ sampleCount: 2, readSkewCount: 1, totalReadBytesPerSecond: 300 }),
      report({ state: 'read-skew-sustained', sampleCount: 6, observedCount: 5,
        readSkewCount: 3, totalReadBytesPerSecond: 450, confidence: 0.8333 })
    ]);
    expect(PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID).toBe('process-io.read-write-skew.library');
    expect(PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'read-skew-sustained', sampleCount: 8,
      readSkewCount: 4, totalReadBytesPerSecond: 450, confidence: 0.875,
      recommendations: ['review-read-contention'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessIoReadWriteSkewReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null,
      observedCount: 0, noProcessCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-processes', recommendations: ['no-process-io-review']
    });
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'observation-disabled', disabledCount: 1,
      totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 })])).toMatchObject({
      state: 'observation-disabled', recommendations: ['keep-process-io-observation-disabled']
    });
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'incomplete-read-write-evidence',
      incompleteCount: 1, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 })])).toMatchObject({
      state: 'incomplete-read-write-evidence', recommendations: ['request-process-io-observation']
    });
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'write-skew-sustained', writeSkewCount: 2 })])
      .recommendations).toEqual(['review-write-contention']);
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'io-skew-observed', readSkewCount: 1 })])
      .recommendations).toEqual(['observe-next-read-write-sample']);
    expect(mergeProcessIoReadWriteSkewReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessIoReadWriteSkewReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, observedCount: 0, totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessIoReadWriteSkewReports([
      report({ state: 'read-skew-sustained' }), report({ state: 'observation-disabled', disabledCount: 1,
        totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 })
    ])).toMatchObject({ state: 'observation-disabled' });
    const states = [
      ['read-skew-sustained', 'read-contention-review', 750], ['write-skew-sustained', 'write-contention-review', 750],
      ['io-skew-observed', 'io-skew-observation', 1000], ['balanced-io', 'balanced-io-observation', 5000],
      ['no-processes', 'no-process-observation', 10000], ['observation-disabled', 'disabled-observation', 10000],
      ['incomplete-read-write-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const disabled = state === 'observation-disabled';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty || disabled ? 0 : 1;
      expect(buildProcessIoReadWriteSkewPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, totalReadBytesPerSecond: empty || disabled ? null : 100,
        totalWriteBytesPerSecond: empty || disabled ? null : 100,
        observedCount: empty || disabled ? 0 : sampleCount, noProcessCount: empty ? 1 : 0,
        disabledCount: disabled ? sampleCount : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessIoReadWriteSkewPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessIoReadWriteSkewPlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessIoReadWriteSkewEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessIoReadWriteSkewLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, observedCount: 0,
      totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, rates, triggers, and clocks', () => {
    expect(() => mergeProcessIoReadWriteSkewReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessIoReadWriteSkewReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessIoReadWriteSkewReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ turbo: 'other' })])).toThrow('requires a read-write-skew turbo report');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ skewRatio: 0 })])).toThrow('skewRatio must be between 1 and 100');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'disabledCount', 'noProcessCount', 'readSkewCount', 'writeSkewCount']) {
      expect(() => mergeProcessIoReadWriteSkewReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessIoReadWriteSkewReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ totalReadBytesPerSecond: -1 })])).toThrow('totalReadBytesPerSecond must be null or non-negative');
    expect(() => mergeProcessIoReadWriteSkewReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessIoReadWriteSkewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessIoReadWriteSkewEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
