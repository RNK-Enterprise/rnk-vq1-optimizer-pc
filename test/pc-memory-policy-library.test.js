import {
  MEMORY_POLICY_LIBRARY_ID,
  MEMORY_POLICY_LIBRARY_VERSION,
  buildMemoryPolicyEnvelope,
  classifyMemoryPolicy,
  compareMemoryPolicy,
  createMemoryPolicyLibrary
} from '../pc/engines/memory-policy/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    memory: { usedPercent: 50, swapUsedPercent: 10 },
    ...overrides
  };
}

describe('Memory-policy library', () => {
  test('classifies balanced, elevated, and bounded policy evidence', () => {
    expect(classifyMemoryPolicy(facts())).toMatchObject({
      library: MEMORY_POLICY_LIBRARY_ID,
      libraryVersion: MEMORY_POLICY_LIBRARY_VERSION,
      pressure: 'normal', policy: 'balanced', recommendations: ['no-change']
    });
    expect(classifyMemoryPolicy(facts({ memory: {
      usedPercent: 80, swapUsedPercent: 40
    } }))).toMatchObject({ pressure: 'elevated', policy: 'background-low' });
    expect(classifyMemoryPolicy(facts({ memory: {
      usedPercent: -1, swapUsedPercent: -2
    } }))).toMatchObject({ usedPercent: 0, swapUsedPercent: 0, pressure: 'normal' });
  });

  test('holds current policy for high, unknown, and unprofiled evidence', () => {
    expect(classifyMemoryPolicy(facts({ environment: 'headless', memory: {
      usedPercent: 95, swapUsedPercent: 80
    } })).recommendations).toEqual(['hold-current-memory-policy', 'hold-destructive-actions']);
    expect(classifyMemoryPolicy(facts({ memory: {
      usedPercent: 95, swapUsedPercent: 80
    } })).policy).toBe('hold-current');
    expect(classifyMemoryPolicy(facts({ environment: 'other', memory: {
      usedPercent: undefined, swapUsedPercent: undefined
    } }))).toMatchObject({
      environment: 'unknown', pressure: 'unknown', policy: 'hold-current',
      recommendations: ['request-environment-profile']
    });
    expect(classifyMemoryPolicy(facts({ memory: {
      usedPercent: undefined, swapUsedPercent: undefined
    } })).recommendations).toEqual(['request-memory-observation']);
  });

  test('compares policy snapshots and builds immutable local facades', () => {
    expect(compareMemoryPolicy(facts(), facts({ memory: {
      usedPercent: 80, swapUsedPercent: 10
    } }))).toMatchObject({ changed: true, policyChanged: true, pressureChanged: true, swapChanged: false });
    expect(compareMemoryPolicy(facts(), facts({ memory: {
      usedPercent: 50, swapUsedPercent: 20
    } }))).toMatchObject({ changed: true, policyChanged: false, pressureChanged: false, swapChanged: true });
    expect(compareMemoryPolicy(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildMemoryPolicyEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPolicyLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyMemoryPolicy(null)).toThrow('facts must be an object');
    expect(() => classifyMemoryPolicy({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyMemoryPolicy({ ...facts(), memory: null })).toThrow('requires memory facts');
    expect(() => buildMemoryPolicyEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildMemoryPolicyEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createMemoryPolicyLibrary(null)).toThrow('options must be an object');
    expect(() => createMemoryPolicyLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
