import {
  PROCESS_PRIORITY_DRIFT_TURBO_ID,
  runProcessPriorityDriftTurbo
} from '../pc/engines/process-priority/turbos/priority-drift/turbo.js';

const facts = (processes, environment = 'interactive') => ({
  engine: 'system-facts',
  environment,
  processes
});

describe('process-priority priority-drift turbo', () => {
  test('detects sustained priority movement with bounded evidence', () => {
    const result = runProcessPriorityDriftTurbo([
      facts([{ name: 'game', priority: 'normal' }]),
      facts([{ name: 'game', priority: 'high' }]),
      facts([{ name: 'game', priority: 'realtime' }])
    ], { trigger: 'workload.changed', minimumSamples: 2, changeThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_PRIORITY_DRIFT_TURBO_ID);
    expect(result.state).toBe('priority-drift-sustained');
    expect(result.transitionCount).toBe(2);
    expect(result.comparisonCount).toBe(2);
    expect(result.processCount).toBe(1);
    expect(result.latestPrioritySignature).toBe('game:realtime');
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, empty, and incomplete samples', () => {
    const stable = runProcessPriorityDriftTurbo([
      facts([{ name: 'game', priority: 'normal' }]),
      facts([{ name: 'game', priority: 'normal' }])
    ], { trigger: 'health.interval', now: () => 0 });
    const observed = runProcessPriorityDriftTurbo([
      facts([{ name: 'game', priority: 'normal' }]),
      facts([{ name: 'game', priority: 'high' }])
    ], { trigger: 'health.interval', changeThreshold: 2, now: () => 0 });
    const empty = runProcessPriorityDriftTurbo([
      facts([]),
      facts([])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const incomplete = runProcessPriorityDriftTurbo([
      facts([{ name: 'game', priority: 'normal' }], 'unknown'),
      facts([{ name: 'game', priority: 'mystery' }])
    ], { trigger: 'install.preflight', now: () => 0 });

    expect(stable.state).toBe('stable-priority');
    expect(stable.recommendations).toEqual(['no-change']);
    expect(observed.state).toBe('priority-drift-observed');
    expect(empty.state).toBe('no-processes');
    expect(empty.noProcessCount).toBe(2);
    expect(incomplete.state).toBe('incomplete-priority-evidence');
    expect(incomplete.incompleteCount).toBe(2);
  });

  test('reports insufficient data and applies the bounded window', () => {
    const result = runProcessPriorityDriftTurbo([
      facts([{ name: 'old', priority: 'normal' }]),
      facts([{ name: 'new', priority: 'normal' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessPriorityDriftTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(result.sampleCount).toBe(1);
    expect(result.processCount).toBe(1);
    expect(result.state).toBe('stable-priority');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
    expect(insufficient.latestPrioritySignature).toBeNull();
  });

  test('rejects invalid triggers, snapshots, bounds, and clocks', () => {
    expect(() => runProcessPriorityDriftTurbo()).toThrow();
    expect(() => runProcessPriorityDriftTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([])).toThrow();
    expect(() => runProcessPriorityDriftTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    const malformed = runProcessPriorityDriftTurbo([
      facts([{ priority: '' }], 'server')
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(malformed.state).toBe('incomplete-priority-evidence');
    expect(() => runProcessPriorityDriftTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([], {
      trigger: 'health.interval', changeThreshold: 0
    })).toThrow();
    expect(() => runProcessPriorityDriftTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
