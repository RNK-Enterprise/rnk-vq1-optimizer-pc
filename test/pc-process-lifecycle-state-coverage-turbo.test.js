import {
  PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_ID,
  runProcessLifecycleStateCoverageTurbo
} from '../pc/engines/process-lifecycle/turbos/state-coverage/turbo.js';

const facts = (processes, environment = 'interactive') => ({ engine: 'system-facts', environment, processes });

describe('process-lifecycle state-coverage turbo', () => {
  test('detects sustained low state coverage', () => {
    const result = runProcessLifecycleStateCoverageTurbo([
      facts([{ state: 'running' }, { state: 'vendor-state' }]),
      facts([{ state: 'sleeping' }, { state: null }])
    ], { trigger: 'workload.changed', minimumSamples: 2, coverageThreshold: 1, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_ID);
    expect(result.state).toBe('state-coverage-low-sustained');
    expect(result.lowCoverageCount).toBe(2);
    expect(result.knownStateCount).toBe(1);
    expect(result.latestCoverage).toBe(0.5);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, complete, empty, and incomplete samples', () => {
    const observed = runProcessLifecycleStateCoverageTurbo([
      facts([{ state: 'running' }, { state: 'vendor-state' }]), facts([{ state: 'running' }, { state: 'sleeping' }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const complete = runProcessLifecycleStateCoverageTurbo([
      facts([{ state: 'running' }]), facts([{ state: 'sleeping' }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runProcessLifecycleStateCoverageTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runProcessLifecycleStateCoverageTurbo([
      facts([{ state: 'running' }], 'unknown'), facts([{ state: 'running' }], 'other')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('state-coverage-low-observed');
    expect(complete.state).toBe('complete-state-observation');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-state-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessLifecycleStateCoverageTurbo([
      facts([{ state: 'vendor-state' }]), facts([{ state: 'running' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessLifecycleStateCoverageTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.latestCoverage).toBe(1);
    expect(bounded.state).toBe('complete-state-observation');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessLifecycleStateCoverageTurbo()).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'health.interval', coverageThreshold: 2 })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runProcessLifecycleStateCoverageTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
