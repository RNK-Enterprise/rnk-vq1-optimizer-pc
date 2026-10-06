import {
  PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_ID,
  PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_VERSION,
  buildProcessLifecycleZombiePersistenceEnvelope,
  buildProcessLifecycleZombiePersistencePlan,
  createProcessLifecycleZombiePersistenceLibrary,
  mergeProcessLifecycleZombiePersistenceReports
} from '../pc/engines/process-lifecycle/turbos/zombie-persistence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-lifecycle.zombie-persistence', state: 'no-zombie-observed', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, processCount: 2, zombieCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noProcessCount: 0,
    zombieSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('process-lifecycle zombie-persistence library', () => {
  test('publishes identity and merges zombie evidence', () => {
    const merged = mergeProcessLifecycleZombiePersistenceReports([
      report({ sampleCount: 2, processCount: 2, zombieCount: 1, zombieSampleCount: 1 }),
      report({ state: 'zombie-persistence-sustained', sampleCount: 6, observedCount: 5,
        zombieCount: 1, zombieSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_ID).toBe('process-lifecycle.zombie-persistence.library');
    expect(PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'zombie-persistence-sustained', sampleCount: 8,
      zombieCount: 1, zombieSampleCount: 4, confidence: 0.875,
      recommendations: ['review-zombie-process-ownership', 'hold-process-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessLifecycleZombiePersistenceReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessLifecycleZombiePersistenceReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, zombieCount: 0, observedCount: 0, noProcessCount: 1, zombieSampleCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-processes', recommendations: ['no-process-lifecycle-review'] });
    expect(mergeProcessLifecycleZombiePersistenceReports([report({ state: 'incomplete-zombie-evidence',
      incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-zombie-evidence', recommendations: ['request-process-state-observation'] });
    expect(mergeProcessLifecycleZombiePersistenceReports([report({ state: 'zombie-persistence-observed',
      processCount: 2, zombieCount: 1, zombieSampleCount: 1 })]).recommendations).toEqual(['observe-next-zombie-sample']);
    expect(mergeProcessLifecycleZombiePersistenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessLifecycleZombiePersistenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessLifecycleZombiePersistenceReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessLifecycleZombiePersistenceReports([
      report({ state: 'zombie-persistence-sustained' }), report({ state: 'no-processes', sampleCount: 1,
        processCount: 0, zombieCount: 0, observedCount: 0, noProcessCount: 1, zombieSampleCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['zombie-persistence-sustained', 'zombie-ownership-review', 750], ['zombie-persistence-observed', 'zombie-observation', 1000],
      ['no-zombie-observed', 'stable-zombie-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['incomplete-zombie-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessLifecycleZombiePersistencePlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, zombieCount: 0, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, zombieSampleCount: 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessLifecycleZombiePersistencePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessLifecycleZombiePersistencePlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessLifecycleZombiePersistenceEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessLifecycleZombiePersistenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeProcessLifecycleZombiePersistenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessLifecycleZombiePersistenceReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ turbo: 'other' })])).toThrow('requires a zombie-persistence turbo report');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount', 'zombieSampleCount']) {
      expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ zombieCount: 3 })])).toThrow('zombieCount must fit inside processCount');
    expect(() => mergeProcessLifecycleZombiePersistenceReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessLifecycleZombiePersistenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessLifecycleZombiePersistenceEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
