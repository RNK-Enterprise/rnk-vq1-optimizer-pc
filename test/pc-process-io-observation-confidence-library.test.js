import {
  PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID,
  PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION,
  buildProcessIoObservationConfidenceEnvelope,
  buildProcessIoObservationConfidencePlan,
  createProcessIoObservationConfidenceLibrary,
  mergeProcessIoObservationConfidenceReports
} from '../pc/engines/process-io/turbos/observation-confidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-io.observation-confidence', state: 'complete-observation', sampleCount,
    minimumSamples: 2, completenessThreshold: 0.8, persistenceThreshold: 2,
    processCount: 2, completeProcessCount: 2, latestObservationRate: 1,
    observedCount: sampleCount, incompleteCount: 0, disabledCount: 0, noProcessCount: 0,
    lowConfidenceCount: 0, confidence: 1, ...overrides
  };
}

describe('process-io observation-confidence library', () => {
  test('publishes identity and merges confidence evidence', () => {
    const merged = mergeProcessIoObservationConfidenceReports([
      report({ sampleCount: 2, processCount: 2, completeProcessCount: 1,
        latestObservationRate: 0.5, lowConfidenceCount: 1 }),
      report({ state: 'low-confidence-sustained', sampleCount: 6, observedCount: 5,
        processCount: 2, completeProcessCount: 0, latestObservationRate: 0,
        lowConfidenceCount: 3, confidence: 0.8333 })
    ]);
    expect(PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID).toBe('process-io.observation-confidence.library');
    expect(PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'low-confidence-sustained', sampleCount: 8,
      processCount: 2, completeProcessCount: 0, latestObservationRate: 0,
      lowConfidenceCount: 4, confidence: 0.875,
      recommendations: ['review-process-io-sensor-coverage', 'hold-unapproved-io-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessIoObservationConfidenceReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, completeProcessCount: 0, latestObservationRate: 0,
      observedCount: 0, noProcessCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-processes', recommendations: ['no-process-io-review'] });
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'observation-disabled',
      processCount: 2, completeProcessCount: 0, latestObservationRate: 0, disabledCount: 1,
      confidence: 0 })])).toMatchObject({ state: 'observation-disabled', recommendations: ['keep-process-io-observation-disabled'] });
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'incomplete-confidence-evidence',
      incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-confidence-evidence', recommendations: ['request-process-io-observation'] });
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'low-confidence-observed',
      lowConfidenceCount: 1, latestObservationRate: 0.5 })]).recommendations)
      .toEqual(['observe-next-process-io-sample']);
    expect(mergeProcessIoObservationConfidenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, completeProcessCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessIoObservationConfidenceReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, completeProcessCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessIoObservationConfidenceReports([
      report({ state: 'low-confidence-sustained' }), report({ state: 'observation-disabled', disabledCount: 1,
        processCount: 2, completeProcessCount: 0, latestObservationRate: 0, confidence: 0 })
    ])).toMatchObject({ state: 'observation-disabled' });
    const states = [
      ['low-confidence-sustained', 'sensor-coverage-review', 750], ['low-confidence-observed', 'sensor-coverage-observation', 1000],
      ['complete-observation', 'complete-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['observation-disabled', 'disabled-observation', 10000], ['incomplete-confidence-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const disabled = state === 'observation-disabled';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty || disabled ? 0 : 1;
      expect(buildProcessIoObservationConfidencePlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, completeProcessCount: empty || disabled ? 0 : 2,
        latestObservationRate: empty || disabled ? 0 : 1,
        observedCount: empty || disabled ? 0 : sampleCount, noProcessCount: empty ? 1 : 0,
        disabledCount: disabled ? sampleCount : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessIoObservationConfidencePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessIoObservationConfidencePlan(report({ sampleCount: 0, processCount: 0,
      completeProcessCount: 0, observedCount: 0, latestObservationRate: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessIoObservationConfidenceEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessIoObservationConfidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, completeProcessCount: 0,
      observedCount: 0, latestObservationRate: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeProcessIoObservationConfidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessIoObservationConfidenceReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessIoObservationConfidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ turbo: 'other' })])).toThrow('requires an observation-confidence turbo report');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ completenessThreshold: 2 })])).toThrow('completenessThreshold must be between 0 and 1');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'disabledCount', 'noProcessCount', 'lowConfidenceCount']) {
      expect(() => mergeProcessIoObservationConfidenceReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessIoObservationConfidenceReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ completeProcessCount: 3 })])).toThrow('completeProcessCount must fit inside processCount');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ latestObservationRate: 2 })])).toThrow('latestObservationRate must be between 0 and 1');
    expect(() => mergeProcessIoObservationConfidenceReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessIoObservationConfidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessIoObservationConfidenceEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
