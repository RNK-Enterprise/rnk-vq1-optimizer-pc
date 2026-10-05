import {
  BATTERY_LIBRARY_ID,
  BATTERY_LIBRARY_VERSION,
  buildBatteryEnvelope,
  classifyBattery,
  compareBattery,
  createBatteryLibrary
} from '../pc/engines/battery/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    battery: { present: true, chargePercent: 80, charging: true, health: 'healthy' },
    capabilities: { batteryObservation: true },
    ...overrides
  };
}

describe('Battery library', () => {
  test('classifies battery presence, charge, charging, and health', () => {
    expect(classifyBattery(facts())).toMatchObject({
      library: BATTERY_LIBRARY_ID,
      libraryVersion: BATTERY_LIBRARY_VERSION,
      environment: 'interactive',
      present: true,
      chargePercent: 80,
      charging: true,
      health: 'healthy',
      observationEnabled: true,
      state: 'observe', confidence: 1, recommendations: ['no-change']
    });
    expect(classifyBattery(facts({ battery: {
      present: true, chargePercent: 80, charging: false, health: ' DEGRADED '
    } }))).toMatchObject({ charging: false, health: 'degraded', state: 'review-health',
      recommendations: ['review-battery-health'] });
    expect(classifyBattery(facts({ battery: {
      present: true, chargePercent: 80, charging: false, health: 'failed'
    } }))).toMatchObject({ state: 'protect-power',
      recommendations: ['protect-power', 'request-user-approved-battery-review'] });
    expect(classifyBattery(facts({ battery: {
      present: true, chargePercent: 10, charging: false, health: 'healthy'
    } }))).toMatchObject({ state: 'low-charge',
      recommendations: ['review-user-owned-power-policy'] });
  });

  test('preserves no-battery, disabled, unknown, and bounded states', () => {
    expect(classifyBattery(facts({ environment: 'headless', battery: {
      present: false, chargePercent: null, charging: null, health: null
    } }))).toMatchObject({ present: false, state: 'no-battery', confidence: 0.4,
      recommendations: ['keep-battery-controls-disabled'] });
    expect(classifyBattery(facts({ capabilities: { batteryObservation: false } })))
      .toMatchObject({ observationEnabled: false, state: 'observation-disabled',
        recommendations: ['keep-battery-observation-disabled'] });
    expect(classifyBattery(facts({ battery: {
      present: null, chargePercent: null, charging: null, health: 'unknown'
    } }))).toMatchObject({ present: null, chargePercent: null, charging: null, health: 'unknown',
      state: 'observation-required', confidence: 0.2,
      recommendations: ['request-battery-observation'] });
    expect(classifyBattery(facts({ environment: 'other', battery: {
      present: null, chargePercent: 'bad', charging: null, health: 'other'
    } }))).toMatchObject({ environment: 'unknown', chargePercent: null, health: 'unknown',
      state: 'profile-required', confidence: 0, recommendations: ['request-environment-profile'] });
    expect(classifyBattery(facts({ battery: {
      present: true, chargePercent: 140, charging: false, health: 2
    } }))).toMatchObject({ chargePercent: 100, health: 'unknown', confidence: 0.8 });
  });

  test('compares samples and builds immutable local facades', () => {
    expect(compareBattery(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, presentChanged: false, chargeChanged: false,
      chargingChanged: false, healthChanged: false, observationChanged: false
    });
    expect(compareBattery(facts(), facts({ battery: {
      present: false, chargePercent: 70, charging: false, health: 'degraded'
    } }))).toMatchObject({
      changed: true, stateChanged: true, presentChanged: true, chargeChanged: true,
      chargingChanged: true, healthChanged: true, observationChanged: false
    });
    expect(compareBattery(facts(), facts({ capabilities: { batteryObservation: false } })))
      .toMatchObject({ changed: true, stateChanged: true, observationChanged: true });
    const envelope = buildBatteryEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBatteryLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyBattery(null)).toThrow('facts must be an object');
    expect(() => classifyBattery({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyBattery({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyBattery({ ...facts(), battery: null }))
      .toThrow('requires a battery object');
    expect(() => buildBatteryEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildBatteryEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildBatteryEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildBatteryEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createBatteryLibrary(null)).toThrow('options must be an object');
    expect(() => createBatteryLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
