import {
  PROCESS_LIFECYCLE_RESTART_BURST_TURBO_ID,
  runProcessLifecycleRestartBurstTurbo
} from '../pc/engines/process-lifecycle/turbos/restart-burst/turbo.js';

const facts = (processes, environment = 'interactive') => ({ engine: 'system-facts', environment, processes });

describe('process-lifecycle restart-burst turbo', () => {
  test('detects sustained restart evidence without restarting processes', () => {
    const result = runProcessLifecycleRestartBurstTurbo([
      facts([{ name: 'service', restartCount: 2 }]), facts([{ name: 'service', restartCount: 3 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, restartThreshold: 1, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(PROCESS_LIFECYCLE_RESTART_BURST_TURBO_ID);
    expect(result.state).toBe('restart-burst-sustained');
    expect(result.restartSampleCount).toBe(2);
    expect(result.totalRestartCount).toBe(3);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runProcessLifecycleRestartBurstTurbo([
      facts([{ restartCount: 2 }]), facts([{ restartCount: 0 }])
    ], { trigger: 'health.interval', restartThreshold: 2, persistenceThreshold: 2, now: () => 0 });
    const stable = runProcessLifecycleRestartBurstTurbo([
      facts([{ restartCount: 0 }]), facts([{ restartCount: 0 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runProcessLifecycleRestartBurstTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runProcessLifecycleRestartBurstTurbo([
      facts([{ name: 'service' }], 'unknown'), facts([{ name: 'service' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('restart-burst-observed');
    expect(stable.state).toBe('stable-lifecycle');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-restart-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessLifecycleRestartBurstTurbo([
      facts([{ restartCount: 4 }]), facts([{ restartCount: 0 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessLifecycleRestartBurstTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.totalRestartCount).toBe(0);
    expect(bounded.state).toBe('stable-lifecycle');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessLifecycleRestartBurstTurbo()).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'health.interval', restartThreshold: 0 })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runProcessLifecycleRestartBurstTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
