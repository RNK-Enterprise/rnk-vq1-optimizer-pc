import {
  POWER_PROFILE_ENGINE_ID,
  POWER_PROFILE_ENGINE_VERSION,
  POWER_PROFILE_TRIGGERS,
  runPowerProfileEngine
} from '../pc/engines/power-profile/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { powerProfileControl: true },
    powerProfile: {
      active: 'balanced',
      available: ['powersave', 'balanced', 'performance']
    },
    ...overrides
  };
}

describe('Power-profile engine', () => {
  test('publishes identity and triggers', () => {
    expect(POWER_PROFILE_ENGINE_ID).toBe('power-profile');
    expect(POWER_PROFILE_ENGINE_VERSION).toBe(1);
    expect(POWER_PROFILE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(POWER_PROFILE_TRIGGERS)).toBe(true);
  });

  test('reports a documented profile without switching it', () => {
    const result = runPowerProfileEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: POWER_PROFILE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      activeProfile: 'balanced',
      availableProfiles: ['powersave', 'balanced', 'performance'],
      controlEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('keeps custom profiles in review', () => {
    expect(runPowerProfileEngine(facts({
      powerProfile: { active: 'vendor-custom', available: ['vendor-custom'] }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      activeProfile: 'custom',
      state: 'review-custom',
      recommendations: ['review-user-owned-power-profile']
    });
  });

  test('reports disabled control and unknown profile evidence', () => {
    expect(runPowerProfileEngine(facts({
      capabilities: { powerProfileControl: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      controlEnabled: false,
      state: 'control-disabled',
      recommendations: ['preserve-power-profile-control-boundary']
    });
    expect(runPowerProfileEngine(facts({
      powerProfile: { active: undefined, available: undefined }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      activeProfile: 'unknown',
      availableProfiles: [],
      state: 'observation-required',
      confidence: 0.25,
      recommendations: ['request-power-profile-observation']
    });
  });

  test('handles unknown environments and malformed profile values', () => {
    expect(runPowerProfileEngine(facts({
      environment: 'other',
      capabilities: undefined,
      powerProfile: { active: '', available: [null, '', 'balanced'] }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      activeProfile: 'unknown',
      availableProfiles: ['balanced'],
      controlEnabled: true,
      state: 'profile-required',
      confidence: 0.25,
      recommendations: ['request-environment-profile']
    });
    expect(runPowerProfileEngine(facts({
      powerProfile: { active: null, available: 'balanced' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      activeProfile: 'unknown',
      availableProfiles: [],
      state: 'observation-required'
    });
  });

  test('requires facts, profile object, triggers, and clock', () => {
    expect(() => runPowerProfileEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runPowerProfileEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runPowerProfileEngine(facts({ powerProfile: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a profile object');
    expect(() => runPowerProfileEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported power-profile trigger: bad');
    expect(() => runPowerProfileEngine(facts(), {}))
      .toThrow('Unsupported power-profile trigger: unknown');
    expect(() => runPowerProfileEngine())
      .toThrow('Unsupported power-profile trigger: unknown');
    expect(() => runPowerProfileEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Power-profile clock must return a number');
  });
});
