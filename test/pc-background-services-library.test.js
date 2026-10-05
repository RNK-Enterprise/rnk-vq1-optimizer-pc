import {
  BACKGROUND_SERVICES_LIBRARY_ID,
  BACKGROUND_SERVICES_LIBRARY_VERSION,
  buildBackgroundServicesEnvelope,
  classifyBackgroundServices,
  compareBackgroundServices,
  createBackgroundServicesLibrary
} from '../pc/engines/background-services/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'headless',
    services: [
      { name: 'worker', state: 'running', critical: true, userOwned: false },
      { name: 'helper', state: 'stopped', critical: false, userOwned: true }
    ],
    capabilities: { backgroundServiceObservation: true },
    ...overrides
  };
}

describe('Background-services library', () => {
  test('classifies service states, failures, and ownership', () => {
    expect(classifyBackgroundServices(facts())).toMatchObject({
      library: BACKGROUND_SERVICES_LIBRARY_ID,
      libraryVersion: BACKGROUND_SERVICES_LIBRARY_VERSION,
      environment: 'headless', serviceCount: 2, names: ['worker', 'helper'],
      runningCount: 1, stoppedCount: 1, failedCount: 0, criticalFailureCount: 0,
      unknownStateCount: 0, userOwnedCount: 1, observationEnabled: true,
      state: 'observe', confidence: 1, recommendations: ['no-change']
    });
    expect(classifyBackgroundServices(facts({ services: [
      { name: 'worker', state: 'FAILED', critical: true, userOwned: false }
    ] }))).toMatchObject({ failedCount: 1, criticalFailureCount: 1,
      state: 'protect-services', confidence: 1,
      recommendations: ['protect-services', 'review-service-owner'] });
    expect(classifyBackgroundServices(facts({ services: [
      { name: 'helper', state: 'stopped', critical: false, userOwned: false },
      { name: 'unknown', state: 'pending', critical: false, userOwned: false }
    ] }))).toMatchObject({ stoppedCount: 1, failedCount: 0, criticalFailureCount: 0,
      unknownStateCount: 1, state: 'observation-required', confidence: 0.7,
      recommendations: ['request-service-state-observation'] });
  });

  test('preserves no-service, disabled, unknown, and incomplete states', () => {
    expect(classifyBackgroundServices(facts({ services: [] }))).toMatchObject({
      serviceCount: 0, state: 'no-services', confidence: 0.2,
      recommendations: ['no-background-service-review']
    });
    expect(classifyBackgroundServices(facts({ capabilities: { backgroundServiceObservation: false } })))
      .toMatchObject({ observationEnabled: false, state: 'observation-disabled',
        recommendations: ['keep-service-observation-disabled'] });
    expect(classifyBackgroundServices(facts({ environment: 'other', services: [] }))).toMatchObject({
      environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyBackgroundServices(facts({ services: [null, {
      name: '', state: '', critical: true, userOwned: true
    }] }))).toMatchObject({ serviceCount: 1, names: [], runningCount: 0, stoppedCount: 0,
      failedCount: 0, criticalFailureCount: 0, unknownStateCount: 1, userOwnedCount: 1,
      confidence: 0.4 });
  });

  test('compares service samples and builds immutable local facades', () => {
    expect(compareBackgroundServices(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, runningChanged: false,
      stoppedChanged: false, failedChanged: false, criticalChanged: false,
      unknownChanged: false, ownershipChanged: false, observationChanged: false
    });
    expect(compareBackgroundServices(facts(), facts({ services: [
      { name: 'worker', state: 'failed', critical: true, userOwned: true },
      { name: 'new', state: 'running', critical: false, userOwned: false },
      { name: 'other', state: 'failed', critical: false, userOwned: false }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, runningChanged: false,
      stoppedChanged: true, failedChanged: true, criticalChanged: true,
      unknownChanged: false, ownershipChanged: false, observationChanged: false
    });
    expect(compareBackgroundServices(facts(), facts({ services: [
      { name: 'worker', state: 'running', critical: true, userOwned: false },
      { name: 'helper', state: 'stopped', critical: false, userOwned: false }
    ] }))).toMatchObject({ changed: true, stateChanged: false,
      ownershipChanged: true });
    expect(compareBackgroundServices(facts(), facts({ capabilities: {
      backgroundServiceObservation: false
    } }))).toMatchObject({ changed: true, stateChanged: true, observationChanged: true });
    const envelope = buildBackgroundServicesEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBackgroundServicesLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyBackgroundServices(null)).toThrow('facts must be an object');
    expect(() => classifyBackgroundServices({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyBackgroundServices({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyBackgroundServices({ ...facts(), services: null }))
      .toThrow('requires a service list');
    expect(() => buildBackgroundServicesEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildBackgroundServicesEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildBackgroundServicesEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildBackgroundServicesEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createBackgroundServicesLibrary(null)).toThrow('options must be an object');
    expect(() => createBackgroundServicesLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
