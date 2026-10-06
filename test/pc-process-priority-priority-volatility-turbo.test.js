import {
  PROCESS_PRIORITY_VOLATILITY_TURBO_ID,
  runProcessPriorityVolatilityTurbo
} from '../pc/engines/process-priority/turbos/priority-volatility/turbo.js';

const facts = (processes, environment = 'interactive') => ({
  engine: 'system-facts',
  environment,
  processes
});

describe('process-priority priority-volatility turbo', () => {
  test('detects sustained priority-state volatility', () => {
    const result = runProcessPriorityVolatilityTurbo([
      facts([{ name: 'game', priority: 'normal', foreground: false, protected: false }]),
      facts([{ name: 'game', priority: 'high', foreground: true, protected: false }]),
      facts([{ name: 'game', priority: 'realtime', foreground: true, protected: true }])
    ], { trigger: 'workload.changed', minimumSamples: 2, changeThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_PRIORITY_VOLATILITY_TURBO_ID);
    expect(result.state).toBe('priority-volatility-sustained');
    expect(result.volatilityCount).toBe(2);
    expect(result.comparisonCount).toBe(2);
    expect(result.latestPriorityStateSignature).toBe('game:realtime:true:true');
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, empty, and incomplete state', () => {
    const stable = runProcessPriorityVolatilityTurbo([
      facts([{ name: 'worker', priority: 'normal', foreground: false, protected: false }]),
      facts([{ name: 'worker', priority: 'normal', foreground: false, protected: false }])
    ], { trigger: 'health.interval', now: () => 0 });
    const observed = runProcessPriorityVolatilityTurbo([
      facts([{ name: 'worker', priority: 'normal', foreground: false, protected: false }]),
      facts([{ name: 'worker', priority: 'high', foreground: false, protected: false }])
    ], { trigger: 'health.interval', changeThreshold: 2, now: () => 0 });
    const empty = runProcessPriorityVolatilityTurbo([
      facts([]), facts([])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const incomplete = runProcessPriorityVolatilityTurbo([
      facts([{ name: 'worker', priority: 'normal' }], 'unknown'),
      facts([{ name: 'worker', priority: 'mystery' }])
    ], { trigger: 'install.preflight', now: () => 0 });

    expect(stable.state).toBe('stable-priority-state');
    expect(observed.state).toBe('priority-volatility-observed');
    expect(empty.state).toBe('no-processes');
    expect(empty.noProcessCount).toBe(2);
    expect(incomplete.state).toBe('incomplete-volatility-evidence');
    expect(incomplete.incompleteCount).toBe(2);
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessPriorityVolatilityTurbo([
      facts([{ name: 'old', priority: 'normal' }]),
      facts([{ name: 'new', priority: 'normal' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessPriorityVolatilityTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.processCount).toBe(1);
    expect(bounded.state).toBe('stable-priority-state');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
    expect(insufficient.latestPriorityStateSignature).toBeNull();
  });

  test('rejects invalid triggers, snapshots, bounds, and clocks', () => {
    expect(() => runProcessPriorityVolatilityTurbo()).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    const malformed = runProcessPriorityVolatilityTurbo([
      facts([{ name: '', priority: '' }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(malformed.state).toBe('incomplete-volatility-evidence');
    expect(() => runProcessPriorityVolatilityTurbo([], {
      trigger: 'health.interval', windowSize: 0
    })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([], {
      trigger: 'health.interval', changeThreshold: 0
    })).toThrow();
    expect(() => runProcessPriorityVolatilityTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
