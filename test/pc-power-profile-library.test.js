import {
  POWER_PROFILE_LIBRARY_ID,
  POWER_PROFILE_LIBRARY_VERSION,
  buildPowerProfileEnvelope,
  classifyPowerProfile,
  comparePowerProfile,
  createPowerProfileLibrary
} from '../pc/engines/power-profile/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    powerProfile: { active: ' performance ', available: ['powersave', 'balanced', 'performance'] },
    capabilities: { powerProfileControl: true },
    ...overrides
  };
}

describe('Power-profile library', () => {
  test('classifies documented profiles and control boundaries', () => {
    expect(classifyPowerProfile(facts())).toMatchObject({
      library: POWER_PROFILE_LIBRARY_ID,
      libraryVersion: POWER_PROFILE_LIBRARY_VERSION,
      environment: 'interactive',
      activeProfile: 'performance',
      availableProfiles: ['powersave', 'balanced', 'performance'],
      controlEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change']
    });
    expect(classifyPowerProfile(facts({ powerProfile: { active: 'custom-work', available: [] } })))
      .toMatchObject({ activeProfile: 'custom', state: 'review-custom', confidence: 0.75,
        recommendations: ['review-user-owned-power-profile'] });
  });

  test('preserves unknown, disabled, and bounded profile states', () => {
    expect(classifyPowerProfile(facts({ powerProfile: { active: '', available: null } })))
      .toMatchObject({ activeProfile: 'unknown', availableProfiles: [], state: 'observation-required',
        confidence: 0.25, recommendations: ['request-power-profile-observation'] });
    expect(classifyPowerProfile(facts({ capabilities: { powerProfileControl: false } })))
      .toMatchObject({ controlEnabled: false, state: 'control-disabled',
        recommendations: ['preserve-power-profile-control-boundary'] });
    expect(classifyPowerProfile(facts({ environment: 'other', powerProfile: { active: null } })))
      .toMatchObject({ environment: 'unknown', activeProfile: 'unknown', state: 'profile-required',
        confidence: 0, recommendations: ['request-environment-profile'] });
    expect(classifyPowerProfile(facts({ powerProfile: { active: 'balanced', available: [null, '', ' balanced '] },
      capabilities: undefined }))).toMatchObject({
      activeProfile: 'balanced', availableProfiles: ['balanced'], controlEnabled: true, confidence: 1
    });
  });

  test('compares profiles and builds immutable local facades', () => {
    expect(comparePowerProfile(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, activeChanged: false,
      availableChanged: false, controlChanged: false
    });
    expect(comparePowerProfile(facts(), facts({ powerProfile: {
      active: 'powersave', available: ['powersave']
    } }))).toMatchObject({
      changed: true, stateChanged: false, activeChanged: true,
      availableChanged: true, controlChanged: false
    });
    expect(comparePowerProfile(facts(), facts({ capabilities: { powerProfileControl: false } })))
      .toMatchObject({ changed: true, stateChanged: true, activeChanged: false,
        availableChanged: false, controlChanged: true });
    const envelope = buildPowerProfileEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createPowerProfileLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyPowerProfile(null)).toThrow('facts must be an object');
    expect(() => classifyPowerProfile({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyPowerProfile({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyPowerProfile({ ...facts(), powerProfile: null }))
      .toThrow('requires a profile object');
    expect(() => buildPowerProfileEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildPowerProfileEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildPowerProfileEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildPowerProfileEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createPowerProfileLibrary(null)).toThrow('options must be an object');
    expect(() => createPowerProfileLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
