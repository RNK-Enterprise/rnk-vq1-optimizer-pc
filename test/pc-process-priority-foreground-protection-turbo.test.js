import {
  PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_ID,
  runProcessPriorityForegroundProtectionTurbo
} from '../pc/engines/process-priority/turbos/foreground-protection/turbo.js';

const facts = (processes, environment = 'interactive') => ({
  engine: 'system-facts',
  environment,
  processes
});

describe('process-priority foreground-protection turbo', () => {
  test('detects sustained elevated foreground work', () => {
    const result = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: 'high', foreground: true, protected: false }]),
      facts([{ name: 'game', priority: 'realtime', foreground: true, protected: true }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_ID);
    expect(result.state).toBe('foreground-elevated-sustained');
    expect(result.elevatedSamples).toBe(2);
    expect(result.foregroundCount).toBe(1);
    expect(result.protectedForegroundCount).toBe(1);
    expect(result.unprotectedForegroundCount).toBe(0);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, unprotected, protected, and no-foreground samples', () => {
    const observed = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: 'high', foreground: true, protected: false }]),
      facts([{ name: 'game', priority: 'normal', foreground: false, protected: false }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const unprotected = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: 'normal', foreground: true, protected: false }]),
      facts([{ name: 'game', priority: 'normal', foreground: false, protected: false }])
    ], { trigger: 'health.interval', now: () => 0 });
    const protectedForeground = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: 'normal', foreground: true, protected: true }]),
      facts([{ name: 'game', priority: 'normal', foreground: false, protected: false }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const noForeground = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'worker', priority: 'normal', foreground: false, protected: false }]),
      facts([{ name: 'worker', priority: 'normal', foreground: false, protected: false }])
    ], { trigger: 'install.preflight', now: () => 0 });

    expect(observed.state).toBe('foreground-elevated-observed');
    expect(unprotected.state).toBe('unprotected-foreground');
    expect(protectedForeground.state).toBe('protected-foreground');
    expect(noForeground.state).toBe('no-foreground');
  });

  test('reports empty and incomplete evidence with bounded counts', () => {
    const empty = runProcessPriorityForegroundProtectionTurbo([
      facts([]), facts([])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const incomplete = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: 'normal', foreground: true }], 'unknown'),
      facts([{ name: 'game', priority: 'mystery', foreground: true }])
    ], { trigger: 'health.interval', now: () => 0 });
    const insufficient = runProcessPriorityForegroundProtectionTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(empty.state).toBe('no-processes');
    expect(empty.noProcessCount).toBe(2);
    expect(incomplete.state).toBe('incomplete-protection-evidence');
    expect(incomplete.incompleteCount).toBe(2);
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, and clocks', () => {
    expect(() => runProcessPriorityForegroundProtectionTurbo()).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([facts({})], {
      trigger: 'health.interval'
    })).toThrow();
    const malformed = runProcessPriorityForegroundProtectionTurbo([
      facts([{ name: 'game', priority: '', foreground: true }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(malformed.state).toBe('incomplete-protection-evidence');
    expect(() => runProcessPriorityForegroundProtectionTurbo([], {
      trigger: 'health.interval', windowSize: 0
    })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessPriorityForegroundProtectionTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
