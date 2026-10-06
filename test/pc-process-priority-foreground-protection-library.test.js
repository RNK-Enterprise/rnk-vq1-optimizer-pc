import {
  PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
  PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION,
  buildProcessPriorityForegroundProtectionEnvelope,
  buildProcessPriorityForegroundProtectionPlan,
  createProcessPriorityForegroundProtectionLibrary,
  mergeProcessPriorityForegroundProtectionReports
} from '../pc/engines/process-priority/turbos/foreground-protection/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-priority.foreground-protection',
    state: 'no-foreground',
    sampleCount,
    minimumSamples: 2,
    persistenceThreshold: 2,
    processCount: 2,
    foregroundCount: 0,
    protectedForegroundCount: 0,
    elevatedForegroundCount: 0,
    unprotectedForegroundCount: 0,
    observedCount: sampleCount,
    incompleteCount: 0,
    noProcessCount: 0,
    elevatedSamples: 0,
    unprotectedSamples: 0,
    confidence: 1,
    ...overrides
  };
}

describe('process-priority foreground-protection library', () => {
  test('publishes identity and merges protection evidence', () => {
    const merged = mergeProcessPriorityForegroundProtectionReports([
      report({ sampleCount: 2, state: 'foreground-elevated-observed', foregroundCount: 1,
        elevatedForegroundCount: 1, unprotectedForegroundCount: 1, elevatedSamples: 1,
        unprotectedSamples: 1 }),
      report({ state: 'foreground-elevated-sustained', sampleCount: 6, observedCount: 5, foregroundCount: 1,
        protectedForegroundCount: 1, elevatedForegroundCount: 1, elevatedSamples: 2,
        confidence: 0.8333 })
    ]);

    expect(PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID)
      .toBe('process-priority.foreground-protection.library');
    expect(PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'foreground-elevated-sustained',
      sampleCount: 8,
      foregroundCount: 1,
      elevatedForegroundCount: 1,
      elevatedSamples: 3,
      unprotectedSamples: 1,
      confidence: 0.875,
      recommendations: ['review-foreground-elevation', 'hold-unapproved-priority-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessPriorityForegroundProtectionReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-foreground-samples']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, observedCount: 0, noProcessCount: 1, confidence: 0 })])
    ).toMatchObject({ state: 'no-processes', recommendations: ['no-process-protection-review'] });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'incomplete-protection-evidence',
      incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-protection-evidence', recommendations: ['request-documented-protection-observation']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'foreground-elevated-observed',
      elevatedForegroundCount: 1, elevatedSamples: 1 })])).toMatchObject({
      state: 'foreground-elevated-observed', recommendations: ['observe-next-foreground-sample']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'unprotected-foreground',
      foregroundCount: 1, unprotectedForegroundCount: 1, unprotectedSamples: 1 })])).toMatchObject({
      state: 'unprotected-foreground', recommendations: ['review-foreground-protection']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'protected-foreground',
      foregroundCount: 1, protectedForegroundCount: 1 })])).toMatchObject({
      state: 'protected-foreground', recommendations: ['preserve-user-owned-protection']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report()])).toMatchObject({
      state: 'no-foreground', recommendations: ['no-change']
    });
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'insufficient-data',
      sampleCount: 1, processCount: 1, observedCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeProcessPriorityForegroundProtectionReports([report({ state: 'insufficient-data',
      sampleCount: 0, processCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessPriorityForegroundProtectionReports([
      report({ state: 'foreground-elevated-sustained' }),
      report({ state: 'no-processes', sampleCount: 1, processCount: 0, observedCount: 0,
        noProcessCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['foreground-elevated-sustained', 'foreground-elevation-review', 750],
      ['foreground-elevated-observed', 'foreground-elevation-observation', 1000],
      ['unprotected-foreground', 'foreground-protection-review', 1000],
      ['protected-foreground', 'protected-foreground-observation', 5000],
      ['no-foreground', 'foreground-observation', 5000],
      ['no-processes', 'no-process-observation', 10000],
      ['incomplete-protection-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessPriorityForegroundProtectionPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessPriorityForegroundProtectionPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessPriorityForegroundProtectionPlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessPriorityForegroundProtectionEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessPriorityForegroundProtectionLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeProcessPriorityForegroundProtectionReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessPriorityForegroundProtectionReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeProcessPriorityForegroundProtectionReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityForegroundProtectionReports([[]])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ turbo: 'other' })]))
      .toThrow('requires a foreground-protection turbo report');
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount',
      'elevatedSamples', 'unprotectedSamples']) {
      expect(() => mergeProcessPriorityForegroundProtectionReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['processCount', 'foregroundCount', 'protectedForegroundCount',
      'elevatedForegroundCount', 'unprotectedForegroundCount']) {
      expect(() => mergeProcessPriorityForegroundProtectionReports([report({ [field]: 4097 })]))
        .toThrow('must be from 0 to 4096');
    }
    expect(() => mergeProcessPriorityForegroundProtectionReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessPriorityForegroundProtectionEnvelope(report()))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityForegroundProtectionEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityForegroundProtectionEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityForegroundProtectionEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
