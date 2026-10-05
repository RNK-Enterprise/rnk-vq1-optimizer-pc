import {
  PROCESS_PRIORITY_ENGINE_ID,
  PROCESS_PRIORITY_ENGINE_VERSION,
  PROCESS_PRIORITY_TRIGGERS,
  runProcessPriorityEngine
} from '../pc/engines/process-priority/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    processes: [
      { name: 'foreground-app', priority: 'normal', foreground: true, protected: true },
      { name: 'service', priority: 'below-normal', foreground: false, protected: false }
    ],
    ...overrides
  };
}

describe('Process-priority engine', () => {
  test('publishes identity and triggers', () => {
    expect(PROCESS_PRIORITY_ENGINE_ID).toBe('process-priority');
    expect(PROCESS_PRIORITY_ENGINE_VERSION).toBe(1);
    expect(PROCESS_PRIORITY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(PROCESS_PRIORITY_TRIGGERS)).toBe(true);
  });

  test('reports documented process priorities without changing them', () => {
    const result = runProcessPriorityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: PROCESS_PRIORITY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      processCount: 2,
      names: ['foreground-app', 'service'],
      priorities: ['normal', 'below-normal'],
      foregroundCount: 1,
      protectedCount: 1,
      unknownPriorityCount: 0,
      elevatedPriorityCount: 0,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('flags elevated documented priorities for review', () => {
    expect(runProcessPriorityEngine(facts({ processes: [
      { name: 'high-app', priority: 'high', foreground: true },
      { name: 'rt-app', priority: 'realtime', foreground: false }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      elevatedPriorityCount: 2,
      state: 'review-elevated',
      recommendations: ['review-user-owned-priority-choices']
    });
  });

  test('reports unknown priorities and malformed process rows conservatively', () => {
    expect(runProcessPriorityEngine(facts({ processes: [
      null,
      { name: '', priority: 'vendor-special', foreground: 'yes', protected: 1 },
      { name: '', priority: '', foreground: false, protected: false },
      { name: '', priority: null, foreground: false, protected: false }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      processCount: 3,
      names: [],
      priorities: ['unknown', 'unknown', 'unknown'],
      foregroundCount: 0,
      protectedCount: 0,
      unknownPriorityCount: 3,
      state: 'observation-required',
      confidence: 0.5,
      recommendations: ['request-documented-priority-observation']
    });
  });

  test('handles empty and unknown environments', () => {
    expect(runProcessPriorityEngine(facts({
      environment: 'headless',
      processes: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      processCount: 0,
      state: 'no-processes',
      confidence: 0.25,
      recommendations: ['no-process-priority-review']
    });
    expect(runProcessPriorityEngine(facts({
      environment: 'other',
      processes: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
  });

  test('requires facts, triggers, a clock, and a process list', () => {
    expect(() => runProcessPriorityEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runProcessPriorityEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runProcessPriorityEngine(facts({ processes: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a process list');
    expect(() => runProcessPriorityEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported process-priority trigger: bad');
    expect(() => runProcessPriorityEngine(facts(), {}))
      .toThrow('Unsupported process-priority trigger: unknown');
    expect(() => runProcessPriorityEngine())
      .toThrow('Unsupported process-priority trigger: unknown');
    expect(() => runProcessPriorityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Process-priority clock must return a number');
  });
});
