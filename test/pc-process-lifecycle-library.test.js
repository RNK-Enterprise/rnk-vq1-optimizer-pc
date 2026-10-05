import {
  PROCESS_LIFECYCLE_LIBRARY_ID,
  PROCESS_LIFECYCLE_LIBRARY_VERSION,
  buildProcessLifecycleEnvelope,
  classifyProcessLifecycle,
  compareProcessLifecycle,
  createProcessLifecycleLibrary
} from '../pc/engines/process-lifecycle/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    processes: [
      { name: ' game ', state: 'running', uptimeSeconds: 100, restartCount: 0 },
      { name: 'worker', state: 'sleeping', uptimeSeconds: 50, restartCount: 1 }
    ],
    ...overrides
  };
}

describe('Process-lifecycle library', () => {
  test('classifies documented states, uptime, and restart evidence', () => {
    expect(classifyProcessLifecycle(facts())).toMatchObject({
      library: PROCESS_LIFECYCLE_LIBRARY_ID,
      libraryVersion: PROCESS_LIFECYCLE_LIBRARY_VERSION,
      processCount: 2, names: ['game', 'worker'], states: ['running', 'sleeping'],
      runningCount: 1, sleepingCount: 1, stoppedCount: 0, zombieCount: 0,
      unknownStateCount: 0, totalRestartCount: 1, maximumUptimeSeconds: 100,
      recommendations: ['review-restart-policy']
    });
    expect(classifyProcessLifecycle(facts({ processes: [
      { name: '', state: 'stopped', uptimeSeconds: -1, restartCount: -2 },
      { name: null, state: 'zombie', uptimeSeconds: 4, restartCount: 0 },
      { name: 'unknown', state: 'unsupported' },
      { name: 'blank', state: '  ' },
      null
    ] }))).toMatchObject({
      processCount: 4, names: ['unknown', 'blank'],
      states: ['stopped', 'zombie', 'unknown', 'unknown'], stoppedCount: 1,
      zombieCount: 1, unknownStateCount: 2, totalRestartCount: 0,
      maximumUptimeSeconds: 4, recommendations: ['request-process-state-observation']
    });
  });

  test('preserves empty, zombie, normal, and unknown environment states', () => {
    expect(classifyProcessLifecycle(facts({ processes: [] })).recommendations)
      .toEqual(['no-process-lifecycle-review']);
    expect(classifyProcessLifecycle(facts({ processes: [
      { name: 'z', state: 'zombie', restartCount: 0 }
    ] })).recommendations).toEqual(['review-zombie-process-ownership']);
    expect(classifyProcessLifecycle(facts({ processes: [
      { name: 's', state: 'stopped', restartCount: 0 }
    ] })).recommendations).toEqual(['no-change']);
    expect(classifyProcessLifecycle(facts({ processes: [{ name: 'n', state: null }] }))
      .states).toEqual(['unknown']);
    expect(classifyProcessLifecycle(facts({ environment: 'other', processes: [] })).recommendations)
      .toEqual(['request-environment-profile']);
  });

  test('compares lifecycle snapshots and builds immutable local facades', () => {
    expect(compareProcessLifecycle(facts(), facts({ processes: [] })))
      .toMatchObject({ changed: true, countChanged: true });
    expect(compareProcessLifecycle(facts(), facts({ processes: [
      { name: 'game', state: 'zombie', uptimeSeconds: 100, restartCount: 0 },
      { name: 'worker', state: 'sleeping', uptimeSeconds: 50, restartCount: 1 }
    ] }))).toMatchObject({ changed: true, zombieChanged: true, restartChanged: false });
    expect(compareProcessLifecycle(facts(), facts({ processes: [
      { name: 'game', state: 'running', uptimeSeconds: 100, restartCount: 2 },
      { name: 'worker', state: 'sleeping', uptimeSeconds: 50, restartCount: 1 }
    ] }))).toMatchObject({ changed: true, restartChanged: true, uptimeChanged: false });
    expect(compareProcessLifecycle(facts(), facts({ processes: [
      { name: 'game', state: 'running', uptimeSeconds: 200, restartCount: 0 },
      { name: 'worker', state: 'sleeping', uptimeSeconds: 50, restartCount: 1 }
    ] }))).toMatchObject({ changed: true, uptimeChanged: true });
    expect(compareProcessLifecycle(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildProcessLifecycleEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessLifecycleLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyProcessLifecycle(null)).toThrow('facts must be an object');
    expect(() => classifyProcessLifecycle({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyProcessLifecycle({ ...facts(), processes: null }))
      .toThrow('requires a process list');
    expect(() => buildProcessLifecycleEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildProcessLifecycleEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createProcessLifecycleLibrary(null)).toThrow('options must be an object');
    expect(() => createProcessLifecycleLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
