import {
  PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_ID,
  runProcessLifecycleUptimeChurnTurbo
} from '../pc/engines/process-lifecycle/turbos/uptime-churn/turbo.js';

const facts = (processes, environment = 'interactive') => ({ engine: 'system-facts', environment, processes });

describe('process-lifecycle uptime-churn turbo', () => {
  test('detects sustained short-lived process evidence', () => {
    const result = runProcessLifecycleUptimeChurnTurbo([
      facts([{ uptimeSeconds: 10 }]), facts([{ uptimeSeconds: 20 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, shortLivedThreshold: 60, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_ID);
    expect(result.state).toBe('short-lived-sustained');
    expect(result.shortLivedSampleCount).toBe(2);
    expect(result.maximumUptimeSeconds).toBe(20);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runProcessLifecycleUptimeChurnTurbo([
      facts([{ uptimeSeconds: 10 }]), facts([{ uptimeSeconds: 100 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runProcessLifecycleUptimeChurnTurbo([
      facts([{ uptimeSeconds: 100 }]), facts([{ uptimeSeconds: 120 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runProcessLifecycleUptimeChurnTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runProcessLifecycleUptimeChurnTurbo([
      facts([{ name: 'service' }], 'unknown'), facts([{ name: 'service' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('short-lived-observed');
    expect(stable.state).toBe('stable-uptime');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-uptime-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessLifecycleUptimeChurnTurbo([
      facts([{ uptimeSeconds: 10 }]), facts([{ uptimeSeconds: 100 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessLifecycleUptimeChurnTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.maximumUptimeSeconds).toBe(100);
    expect(bounded.state).toBe('stable-uptime');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessLifecycleUptimeChurnTurbo()).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'health.interval', shortLivedThreshold: 86401 })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runProcessLifecycleUptimeChurnTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
