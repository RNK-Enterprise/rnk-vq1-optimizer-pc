import {
  STARTUP_LIBRARY_ID,
  STARTUP_LIBRARY_VERSION,
  buildStartupEnvelope,
  classifyStartup,
  compareStartup,
  createStartupLibrary
} from '../pc/engines/startup/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    startup: [
      { name: 'core', enabled: true, required: true, userOwned: false, delayMs: 100 },
      { name: 'required-disabled', enabled: false, required: true, userOwned: false, delayMs: 50 },
      { name: 'user-entry', enabled: true, required: false, userOwned: true, delayMs: 200 }
    ],
    ...overrides
  };
}

describe('Startup library', () => {
  test('classifies entries, ownership, requiredness, and delay', () => {
    expect(classifyStartup(facts())).toMatchObject({
      library: STARTUP_LIBRARY_ID,
      libraryVersion: STARTUP_LIBRARY_VERSION,
      environment: 'interactive', startupCount: 3,
      names: ['core', 'required-disabled', 'user-entry'], enabledCount: 2, disabledCount: 1,
      unknownCount: 0, requiredDisabledCount: 1, userOwnedEnabledCount: 1,
      maximumDelayMs: 200, state: 'required-review', confidence: 1,
      recommendations: ['review-required-startup-owner']
    });
    expect(classifyStartup(facts({ startup: [
      { name: 'user-entry', enabled: true, required: false, userOwned: true, delayMs: 20 }
    ] }))).toMatchObject({ userOwnedEnabledCount: 1, state: 'user-owned-review',
      recommendations: ['review-user-owned-startup-items'] });
    expect(classifyStartup(facts({ startup: [
      { name: 'normal', enabled: true, required: false, userOwned: false, delayMs: 0 }
    ] }))).toMatchObject({ state: 'observe', maximumDelayMs: 0,
      recommendations: ['no-change'] });
  });

  test('preserves unknown, empty, profile, and incomplete states', () => {
    expect(classifyStartup(facts({ startup: [
      { name: 'pending', enabled: null, required: false, userOwned: false, delayMs: null }
    ] }))).toMatchObject({ startupCount: 1, enabledCount: 0, disabledCount: 0, unknownCount: 1,
      requiredDisabledCount: 0, userOwnedEnabledCount: 0, maximumDelayMs: null,
      state: 'observation-required', confidence: 0.7,
      recommendations: ['request-startup-observation'] });
    expect(classifyStartup(facts({ startup: [] }))).toMatchObject({
      startupCount: 0, maximumDelayMs: null, state: 'no-startup-items', confidence: 0.2,
      recommendations: ['no-startup-review']
    });
    expect(classifyStartup(facts({ environment: 'other', startup: [] }))).toMatchObject({
      environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyStartup(facts({ startup: [null, {
      name: '', enabled: 'yes', required: true, userOwned: true, delayMs: -1
    }] }))).toMatchObject({ startupCount: 1, names: [], unknownCount: 1,
      requiredDisabledCount: 0, userOwnedEnabledCount: 0, maximumDelayMs: null, confidence: 0.4 });
  });

  test('compares startup samples and builds immutable local facades', () => {
    expect(compareStartup(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, enabledChanged: false,
      disabledChanged: false, unknownChanged: false, requiredChanged: false,
      userOwnedChanged: false, delayChanged: false
    });
    expect(compareStartup(facts(), facts({ startup: [
      { name: 'core', enabled: true, required: true, userOwned: false, delayMs: 300 },
      { name: 'required-disabled', enabled: true, required: true, userOwned: false, delayMs: 50 },
      { name: 'user-entry', enabled: false, required: false, userOwned: true, delayMs: 200 },
      { name: 'new', enabled: true, required: false, userOwned: false, delayMs: 10 }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, enabledChanged: true,
      disabledChanged: false, unknownChanged: false, requiredChanged: true,
      userOwnedChanged: true, delayChanged: true
    });
    const envelope = buildStartupEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStartupLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyStartup(null)).toThrow('facts must be an object');
    expect(() => classifyStartup({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyStartup({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyStartup({ ...facts(), startup: null }))
      .toThrow('requires a startup list');
    expect(() => buildStartupEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildStartupEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildStartupEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildStartupEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createStartupLibrary(null)).toThrow('options must be an object');
    expect(() => createStartupLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
