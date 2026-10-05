import {
  PROCESS_LIFECYCLE_ENGINE_ID,
  PROCESS_LIFECYCLE_ENGINE_VERSION,
  PROCESS_LIFECYCLE_TRIGGERS,
  runProcessLifecycleEngine
} from '../pc/engines/process-lifecycle/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    processes: [
      { name: 'app', state: 'running', uptimeSeconds: 100, restartCount: 0 },
      { name: 'service', state: 'sleeping', uptimeSeconds: 200, restartCount: 0 }
    ],
    ...overrides
  };
}

describe('Process-lifecycle engine', () => {
  test('publishes identity and triggers', () => {
    expect(PROCESS_LIFECYCLE_ENGINE_ID).toBe('process-lifecycle');
    expect(PROCESS_LIFECYCLE_ENGINE_VERSION).toBe(1);
    expect(PROCESS_LIFECYCLE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(PROCESS_LIFECYCLE_TRIGGERS)).toBe(true);
  });

  test('reports normal process lifecycle without changes', () => {
    const result = runProcessLifecycleEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: PROCESS_LIFECYCLE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      processCount: 2,
      names: ['app', 'service'],
      states: ['running', 'sleeping'],
      runningCount: 1,
      sleepingCount: 1,
      stoppedCount: 0,
      zombieCount: 0,
      unknownStateCount: 0,
      totalRestartCount: 0,
      maximumUptimeSeconds: 200,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('flags zombies and restart activity', () => {
    expect(runProcessLifecycleEngine(facts({ processes: [
      { name: 'zombie', state: 'zombie', uptimeSeconds: 1, restartCount: 0 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      zombieCount: 1,
      state: 'lifecycle-review',
      recommendations: ['review-zombie-process-ownership']
    });
    expect(runProcessLifecycleEngine(facts({ processes: [
      { name: 'service', state: 'stopped', uptimeSeconds: 1, restartCount: 2 }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      stoppedCount: 1,
      totalRestartCount: 2,
      state: 'restart-review',
      recommendations: ['review-restart-policy']
    });
  });

  test('reports unknown states and malformed process rows', () => {
    expect(runProcessLifecycleEngine(facts({ processes: [
      null,
      { name: '', state: 'vendor-state', uptimeSeconds: -1, restartCount: -2 },
      { name: '', state: '', uptimeSeconds: undefined, restartCount: undefined },
      { name: '', state: null, uptimeSeconds: undefined, restartCount: undefined }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      processCount: 3,
      names: [],
      states: ['unknown', 'unknown', 'unknown'],
      unknownStateCount: 3,
      totalRestartCount: null,
      maximumUptimeSeconds: null,
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-process-state-observation']
    });
  });

  test('handles empty and unknown environments', () => {
    expect(runProcessLifecycleEngine(facts({
      environment: 'headless',
      processes: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      processCount: 0,
      state: 'no-processes',
      confidence: 0.2,
      recommendations: ['no-process-lifecycle-review']
    });
    expect(runProcessLifecycleEngine(facts({
      environment: 'other',
      processes: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
  });

  test('requires facts, process list, triggers, and a clock', () => {
    expect(() => runProcessLifecycleEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runProcessLifecycleEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runProcessLifecycleEngine(facts({ processes: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a process list');
    expect(() => runProcessLifecycleEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported process-lifecycle trigger: bad');
    expect(() => runProcessLifecycleEngine(facts(), {}))
      .toThrow('Unsupported process-lifecycle trigger: unknown');
    expect(() => runProcessLifecycleEngine())
      .toThrow('Unsupported process-lifecycle trigger: unknown');
    expect(() => runProcessLifecycleEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Process-lifecycle clock must return a number');
  });
});
