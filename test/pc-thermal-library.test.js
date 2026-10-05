import {
  THERMAL_LIBRARY_ID,
  THERMAL_LIBRARY_VERSION,
  buildThermalEnvelope,
  classifyThermal,
  compareThermal,
  createThermalLibrary
} from '../pc/engines/thermal/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    thermal: { temperatureCelsius: 60, criticalCelsius: 100, fanPercent: 40 },
    capabilities: { thermalObservation: true },
    ...overrides
  };
}

describe('Thermal library', () => {
  test('classifies normal, elevated, high, critical, and headroom evidence', () => {
    expect(classifyThermal(facts())).toMatchObject({
      library: THERMAL_LIBRARY_ID,
      libraryVersion: THERMAL_LIBRARY_VERSION,
      temperatureCelsius: 60,
      criticalCelsius: 100,
      fanPercent: 40,
      thermalHeadroomCelsius: 40,
      level: 'normal', state: 'observe', confidence: 1,
      recommendations: ['no-change']
    });
    expect(classifyThermal(facts({ thermal: { temperatureCelsius: 75, criticalCelsius: 100, fanPercent: 50 } })))
      .toMatchObject({ level: 'elevated', state: 'watch',
        recommendations: ['observe-next-sample', 'review-thermal-headroom'] });
    expect(classifyThermal(facts({ thermal: { temperatureCelsius: 90, criticalCelsius: null, fanPercent: 101 } })))
      .toMatchObject({ fanPercent: 100, level: 'high', state: 'protect-foreground',
        recommendations: ['protect-thermal-headroom'] });
    expect(classifyThermal(facts({ thermal: { temperatureCelsius: 100, criticalCelsius: 100, fanPercent: 0 } })))
      .toMatchObject({ level: 'critical', state: 'protect-foreground',
        recommendations: ['protect-foreground', 'request-user-approved-thermal-response'] });
    expect(classifyThermal(facts({ environment: 'headless', thermal: {
      temperatureCelsius: 100, criticalCelsius: 100, fanPercent: 0
    } }))).toMatchObject({ state: 'protect-services',
      recommendations: ['protect-services', 'request-user-approved-thermal-response'] });
    expect(classifyThermal(facts({ environment: 'headless', thermal: {
      temperatureCelsius: 90, criticalCelsius: null, fanPercent: 0
    } }))).toMatchObject({ state: 'protect-services' });
  });

  test('preserves unknown, disabled, and incomplete thermal states', () => {
    expect(classifyThermal(facts({ environment: 'other', thermal: {
      temperatureCelsius: null, criticalCelsius: null, fanPercent: null
    } }))).toMatchObject({ environment: 'unknown', thermalHeadroomCelsius: null,
      level: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile'] });
    expect(classifyThermal(facts({ thermal: {
      temperatureCelsius: null, criticalCelsius: 100, fanPercent: -1
    } }))).toMatchObject({ temperatureCelsius: null, criticalCelsius: 100, fanPercent: 0,
      level: 'unknown', state: 'observation-required', confidence: 0.6,
      recommendations: ['request-thermal-observation'] });
    expect(classifyThermal(facts({ capabilities: { thermalObservation: false } })))
      .toMatchObject({ observationEnabled: false, state: 'observation-disabled',
        recommendations: ['keep-thermal-observation-disabled'] });
    expect(classifyThermal(facts({ capabilities: undefined, thermal: {
      temperatureCelsius: 'bad', criticalCelsius: -1, fanPercent: 'bad'
    } }))).toMatchObject({ observationEnabled: true, temperatureCelsius: null,
      criticalCelsius: null, fanPercent: null, thermalHeadroomCelsius: null });
  });

  test('compares samples and builds immutable local facades', () => {
    expect(compareThermal(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, temperatureChanged: false,
      criticalChanged: false, fanChanged: false, levelChanged: false, observationChanged: false
    });
    expect(compareThermal(facts(), facts({ thermal: {
      temperatureCelsius: 61, criticalCelsius: 99, fanPercent: 41
    } }))).toMatchObject({
      changed: true, stateChanged: false, temperatureChanged: true,
      criticalChanged: true, fanChanged: true, levelChanged: false, observationChanged: false
    });
    expect(compareThermal(facts(), facts({ thermal: {
      temperatureCelsius: 100, criticalCelsius: 100, fanPercent: 40
    } }))).toMatchObject({ changed: true, stateChanged: true, levelChanged: true });
    expect(compareThermal(facts(), facts({ capabilities: { thermalObservation: false } })))
      .toMatchObject({ changed: true, stateChanged: true, observationChanged: true });
    const envelope = buildThermalEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createThermalLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyThermal(null)).toThrow('facts must be an object');
    expect(() => classifyThermal({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyThermal({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyThermal({ ...facts(), thermal: null }))
      .toThrow('requires a thermal object');
    expect(() => buildThermalEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildThermalEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildThermalEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildThermalEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createThermalLibrary(null)).toThrow('options must be an object');
    expect(() => createThermalLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
