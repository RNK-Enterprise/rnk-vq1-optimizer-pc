import {
  WORKLOAD_PROFILE_LIBRARY_ID,
  WORKLOAD_PROFILE_LIBRARY_VERSION,
  buildWorkloadProfileEnvelope,
  classifyWorkloadProfile,
  compareWorkloadProfile,
  createWorkloadProfileLibrary
} from '../pc/engines/workload-profile/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    workload: { kind: ' GAMING ', name: 'Phoenix', declared: true, interactive: true },
    ...overrides
  };
}

describe('Workload-profile library', () => {
  test('classifies interactive and service workload context', () => {
    expect(classifyWorkloadProfile(facts())).toMatchObject({
      library: WORKLOAD_PROFILE_LIBRARY_ID,
      libraryVersion: WORKLOAD_PROFILE_LIBRARY_VERSION,
      environment: 'interactive', workloadKind: 'gaming', workloadName: 'Phoenix',
      declared: true, interactive: true, state: 'interactive-profile', confidence: 1,
      recommendations: ['preserve-user-owned-workload']
    });
    expect(classifyWorkloadProfile(facts({ environment: 'headless', workload: {
      kind: 'server', name: 'Lisa', declared: true, interactive: false
    } }))).toMatchObject({ workloadKind: 'server', state: 'service-profile', confidence: 1,
      recommendations: ['preserve-service-workload'] });
    expect(classifyWorkloadProfile(facts({ workload: {
      kind: 'development', name: 'Phoenix', declared: true, interactive: true
    } }))).toMatchObject({ workloadKind: 'development', state: 'interactive-profile' });
  });

  test('preserves workload-required, unknown, and profile-required states', () => {
    expect(classifyWorkloadProfile(facts({ workload: {
      kind: 'gaming', name: 'Phoenix', declared: false, interactive: true
    } }))).toMatchObject({ declared: false, state: 'workload-required',
      recommendations: ['request-workload-profile'] });
    expect(classifyWorkloadProfile(facts({ workload: {
      kind: 'other', name: '', declared: null, interactive: null
    } }))).toMatchObject({ workloadKind: 'unknown', workloadName: null, declared: null,
      interactive: null, state: 'observation-required', confidence: 0.25,
      recommendations: ['request-documented-workload-kind'] });
    expect(classifyWorkloadProfile(facts({ environment: 'other', workload: {
      kind: null, name: null, declared: null, interactive: null
    } }))).toMatchObject({ environment: 'unknown', workloadKind: 'unknown',
      state: 'profile-required', confidence: 0, recommendations: ['request-environment-profile'] });
  });

  test('compares workload profiles and builds immutable local facades', () => {
    expect(compareWorkloadProfile(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, kindChanged: false, nameChanged: false,
      declaredChanged: false, interactiveChanged: false
    });
    expect(compareWorkloadProfile(facts(), facts({ workload: {
      kind: 'server', name: 'Lisa', declared: false, interactive: false
    } }))).toMatchObject({
      changed: true, stateChanged: true, kindChanged: true, nameChanged: true,
      declaredChanged: true, interactiveChanged: true
    });
    const envelope = buildWorkloadProfileEnvelope(facts(), { trigger: 'workload.changed', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createWorkloadProfileLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyWorkloadProfile(null)).toThrow('facts must be an object');
    expect(() => classifyWorkloadProfile({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyWorkloadProfile({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyWorkloadProfile({ ...facts(), workload: null }))
      .toThrow('requires a workload object');
    expect(() => buildWorkloadProfileEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildWorkloadProfileEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildWorkloadProfileEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildWorkloadProfileEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createWorkloadProfileLibrary(null)).toThrow('options must be an object');
    expect(() => createWorkloadProfileLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
