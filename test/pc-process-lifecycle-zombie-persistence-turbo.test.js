import {
  PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_ID,
  runProcessLifecycleZombiePersistenceTurbo
} from '../pc/engines/process-lifecycle/turbos/zombie-persistence/turbo.js';

const facts = (processes, environment = 'interactive') => ({ engine: 'system-facts', environment, processes });

describe('process-lifecycle zombie-persistence turbo', () => {
  test('detects sustained zombie evidence without process mutation', () => {
    const result = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: 'zombie' }]), facts([{ state: 'zombie' }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_ID);
    expect(result.state).toBe('zombie-persistence-sustained');
    expect(result.zombieCount).toBe(1);
    expect(result.zombieSampleCount).toBe(2);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, clear, empty, and incomplete samples', () => {
    const observed = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: 'zombie' }]), facts([{ state: 'running' }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const clear = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: 'running' }]), facts([{ state: 'sleeping' }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runProcessLifecycleZombiePersistenceTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: 'unknown' }], 'unknown'), facts([{ state: 'vendor-state' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('zombie-persistence-observed');
    expect(clear.state).toBe('no-zombie-observed');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-zombie-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: 'zombie' }]), facts([{ state: 'running' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.zombieCount).toBe(0);
    expect(bounded.state).toBe('no-zombie-observed');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, and clocks', () => {
    expect(() => runProcessLifecycleZombiePersistenceTurbo()).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    const malformed = runProcessLifecycleZombiePersistenceTurbo([
      facts([{ state: null }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(malformed.state).toBe('incomplete-zombie-evidence');
    expect(() => runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runProcessLifecycleZombiePersistenceTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
