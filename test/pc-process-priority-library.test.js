import {
  PROCESS_PRIORITY_LIBRARY_ID,
  PROCESS_PRIORITY_LIBRARY_VERSION,
  buildProcessPriorityEnvelope,
  classifyProcessPriority,
  compareProcessPriority,
  createProcessPriorityLibrary
} from '../pc/engines/process-priority/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    processes: [
      { name: ' game ', priority: 'normal', foreground: true, protected: true },
      { name: 'worker', priority: 'above-normal', foreground: false, protected: false }
    ],
    ...overrides
  };
}

describe('Process-priority library', () => {
  test('classifies documented priorities and process ownership flags', () => {
    expect(classifyProcessPriority(facts())).toMatchObject({
      library: PROCESS_PRIORITY_LIBRARY_ID,
      libraryVersion: PROCESS_PRIORITY_LIBRARY_VERSION,
      processCount: 2, names: ['game', 'worker'], priorities: ['normal', 'above-normal'],
      foregroundCount: 1, protectedCount: 1, unknownPriorityCount: 0,
      elevatedPriorityCount: 1, recommendations: ['review-user-owned-priority-choices']
    });
    expect(classifyProcessPriority(facts({ processes: [
      { name: '', priority: 'idle', foreground: 'yes', protected: 1 },
      { name: null, priority: 'realtime', foreground: true, protected: true },
      { name: 'custom', priority: 'unsupported' },
      null
    ] }))).toMatchObject({
      processCount: 3, names: ['custom'], priorities: ['idle', 'realtime', 'unknown'],
      foregroundCount: 1, protectedCount: 1, unknownPriorityCount: 1,
      elevatedPriorityCount: 1, recommendations: ['request-documented-priority-observation']
    });
    expect(classifyProcessPriority(facts({ processes: [{ name: 'blank', priority: '  ' }] }))
      .priorities).toEqual(['unknown']);
  });

  test('preserves no-process and unknown environment states', () => {
    expect(classifyProcessPriority(facts({ processes: [] })).recommendations)
      .toEqual(['no-process-priority-review']);
    expect(classifyProcessPriority(facts({ environment: 'other', processes: [] })).recommendations)
      .toEqual(['request-environment-profile']);
    expect(classifyProcessPriority(facts({ processes: [
      { name: 'idle', priority: 'idle' }
    ] })).recommendations).toEqual(['no-change']);
  });

  test('compares priority snapshots and builds immutable local facades', () => {
    expect(compareProcessPriority(facts(), facts({ processes: [] })))
      .toMatchObject({ changed: true, countChanged: true });
    expect(compareProcessPriority(facts(), facts({ processes: [
      { name: 'game', priority: 'unknown' }, { name: 'worker', priority: 'above-normal' }
    ] }))).toMatchObject({ changed: true, unknownChanged: true, countChanged: false });
    expect(compareProcessPriority(facts(), facts({ processes: [
      { name: 'game', priority: 'normal' }, { name: 'worker', priority: 'normal' }
    ] }))).toMatchObject({ changed: true, elevatedChanged: true, foregroundChanged: true });
    expect(compareProcessPriority(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildProcessPriorityEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessPriorityLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyProcessPriority(null)).toThrow('facts must be an object');
    expect(() => classifyProcessPriority({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyProcessPriority({ ...facts(), processes: null }))
      .toThrow('requires a process list');
    expect(() => buildProcessPriorityEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildProcessPriorityEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createProcessPriorityLibrary(null)).toThrow('options must be an object');
    expect(() => createProcessPriorityLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
