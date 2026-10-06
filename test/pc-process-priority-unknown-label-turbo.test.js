import {
  PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_ID,
  runProcessPriorityUnknownLabelTurbo
} from '../pc/engines/process-priority/turbos/unknown-label/turbo.js';

const facts = (processes, environment = 'interactive') => ({
  engine: 'system-facts',
  environment,
  processes
});

describe('process-priority unknown-label turbo', () => {
  test('detects sustained undocumented labels and rates them', () => {
    const result = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'game', priority: 'mystery' }, { name: 'shell', priority: 'normal' }]),
      facts([{ name: 'game', priority: 'unknown-mode' }, { name: 'shell', priority: 'normal' }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_ID);
    expect(result.state).toBe('unknown-priority-sustained');
    expect(result.unknownCount).toBe(2);
    expect(result.unknownSamples).toBe(2);
    expect(result.latestUnknownRate).toBe(0.5);
    expect(result.maximumRate).toBe(0.5);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes documented, observed, empty, and incomplete samples', () => {
    const documented = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'game', priority: 'normal' }]),
      facts([{ name: 'game', priority: 'high' }])
    ], { trigger: 'health.interval', now: () => 0 });
    const observed = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'game', priority: 'mystery' }]),
      facts([{ name: 'game', priority: 'normal' }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const empty = runProcessPriorityUnknownLabelTurbo([
      facts([]),
      facts([])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const incomplete = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'game', priority: 'normal' }], 'unknown'),
      facts([{ name: 'game', priority: 'normal' }], 'server')
    ], { trigger: 'install.preflight', now: () => 0 });

    expect(documented.state).toBe('documented-priority');
    expect(documented.recommendations).toEqual(['no-change']);
    expect(observed.state).toBe('unknown-priority-observed');
    expect(empty.state).toBe('no-processes');
    expect(empty.noProcessCount).toBe(2);
    expect(incomplete.state).toBe('incomplete-priority-evidence');
    expect(incomplete.incompleteCount).toBe(2);
  });

  test('bounds the sample window and reports insufficient evidence', () => {
    const bounded = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'old', priority: 'mystery' }]),
      facts([{ name: 'new', priority: 'normal' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.processCount).toBe(1);
    expect(bounded.latestUnknownCount).toBe(0);
    expect(bounded.state).toBe('documented-priority');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, rates, and clocks', () => {
    expect(() => runProcessPriorityUnknownLabelTurbo()).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    const malformed = runProcessPriorityUnknownLabelTurbo([
      facts([{ name: 'unnamed', priority: '' }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(malformed.unknownCount).toBe(1);
    expect(() => runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'health.interval', windowSize: 0
    })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'health.interval', rateThreshold: 2
    })).toThrow();
    expect(() => runProcessPriorityUnknownLabelTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
