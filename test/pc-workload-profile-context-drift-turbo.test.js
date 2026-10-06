import { WORKLOAD_CONTEXT_DRIFT_TRIGGERS, WORKLOAD_CONTEXT_DRIFT_TURBO_ID,
  WORKLOAD_CONTEXT_DRIFT_TURBO_VERSION, runWorkloadContextDriftTurbo } from '../pc/engines/workload-profile/turbos/context-drift/turbo.js';

function facts(overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive',
    workload: { kind: 'gaming', name: 'Game', declared: true }, ...overrides };
}
function workload(overrides = {}) { return { kind: 'gaming', name: 'Game', declared: true, ...overrides }; }

describe('workload-profile context-drift turbo', () => {
  test('publishes identity and detects sustained context drift', () => {
    expect(WORKLOAD_CONTEXT_DRIFT_TURBO_ID).toBe('workload-profile.context-drift');
    expect(WORKLOAD_CONTEXT_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(WORKLOAD_CONTEXT_DRIFT_TRIGGERS)).toBe(true);
    const result = runWorkloadContextDriftTurbo([
      facts(), facts({ workload: workload({ kind: 'creative', name: 'Editor' }) }),
      facts({ environment: 'headless', workload: workload({ kind: 'server', name: 'Daemon' }) })
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: WORKLOAD_CONTEXT_DRIFT_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3, observedCount: 3,
      unknownCount: 0, comparisonCount: 2, changeCount: 2, environmentChangeCount: 1,
      kindChangeCount: 2, finalEnvironment: 'headless', finalWorkloadKind: 'server',
      state: 'context-drift-sustained', confidence: 1,
      recommendations: ['review-workload-context-drift'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes every context state and normalizes evidence', () => {
    expect(runWorkloadContextDriftTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', confidence: 0, finalEnvironment: 'unknown', finalWorkloadName: null });
    expect(runWorkloadContextDriftTurbo([facts({ environment: 'other', workload: workload({ kind: 'other' }) }),
      facts({ environment: 'other', workload: workload({ kind: 'other' }) })], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'profile-required', observedCount: 0, unknownCount: 2 });
    expect(runWorkloadContextDriftTurbo([facts(), facts({ workload: workload({ kind: 'creative', name: 'Editor' }) })], { trigger: 'workload.changed', now: () => 0 }))
      .toMatchObject({ state: 'context-drift-observed', changeCount: 1, unknownCount: 0 });
    expect(runWorkloadContextDriftTurbo([facts(), facts({ environment: 'other' })], { trigger: 'workload.changed', now: () => 0 }))
      .toMatchObject({ state: 'observation-required', changeCount: 1, unknownCount: 1 });
    expect(runWorkloadContextDriftTurbo([facts(), facts({ environment: 'other' })], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 }))
      .toMatchObject({ state: 'observation-required', changeCount: 1, unknownCount: 1 });
    expect(runWorkloadContextDriftTurbo([facts(), facts()], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'stable-context', changeCount: 0 });
    expect(runWorkloadContextDriftTurbo([facts(), facts({ workload: workload({ name: '', declared: undefined }) })], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'context-drift-observed', finalWorkloadName: null });
    expect(runWorkloadContextDriftTurbo([facts({ workload: workload({ kind: 10, name: 20, declared: 'yes' }) })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalWorkloadKind: 'unknown', finalWorkloadName: null, state: 'profile-required' });
  });
  test('bounds windows and validates all local inputs', () => {
    expect(runWorkloadContextDriftTurbo([facts(), facts(), facts()], { trigger: 'workload.changed', windowSize: 2, now: () => 0 }))
      .toMatchObject({ sampleCount: 2 });
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported workload-profile context-drift trigger: bad');
    expect(() => runWorkloadContextDriftTurbo()).toThrow('Unsupported workload-profile context-drift trigger: unknown');
    expect(() => runWorkloadContextDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must fit');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must fit');
    expect(() => runWorkloadContextDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runWorkloadContextDriftTurbo([{ engine: 'other', workload: {} }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runWorkloadContextDriftTurbo([{ engine: 'system-facts' }], { trigger: 'health.interval' })).toThrow('requires a workload object');
    expect(() => runWorkloadContextDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
