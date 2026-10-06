import { BACKGROUND_OWNERSHIP_TRIGGERS, BACKGROUND_OWNERSHIP_TURBO_ID,
  BACKGROUND_OWNERSHIP_TURBO_VERSION, runBackgroundOwnershipReviewTurbo } from '../pc/engines/background-services/turbos/ownership-review/turbo.js';

const service = (userOwned) => ({ name: 'svc', userOwned });
const facts = (services = [], overrides = {}) => ({ engine: 'system-facts', environment: 'interactive', services, ...overrides });

describe('background-services ownership-review turbo', () => {
  test('publishes identity and preserves user-owned evidence', () => {
    expect(BACKGROUND_OWNERSHIP_TURBO_ID).toBe('background-services.ownership-review');
    expect(BACKGROUND_OWNERSHIP_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(BACKGROUND_OWNERSHIP_TRIGGERS)).toBe(true);
    const result = runBackgroundOwnershipReviewTurbo([facts([service(true), { userOwned: false }])], { trigger: 'install.preflight', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ turbo: BACKGROUND_OWNERSHIP_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 1,
      serviceCount: 2, userOwnedCount: 1, systemOwnedCount: 1, unknownOwnershipCount: 0,
      state: 'user-owned-review', confidence: 1, recommendations: ['preserve-user-owned-service-boundary'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('covers system, unknown, empty, and insufficient states', () => {
    expect(runBackgroundOwnershipReviewTurbo([facts([service(false)]), facts([service(false)])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'system-owned-observe', confidence: 1, changeCount: 0 });
    expect(runBackgroundOwnershipReviewTurbo([facts([{ userOwned: 'yes' }])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'ownership-observation-required', unknownOwnershipCount: 1, confidence: 0 });
    expect(runBackgroundOwnershipReviewTurbo([facts([]), facts([])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-services', confidence: 0 });
    expect(runBackgroundOwnershipReviewTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('tracks changes and unknown environments', () => {
    expect(runBackgroundOwnershipReviewTurbo([facts([service(false)]), facts([service(true)])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ finalEnvironment: 'interactive', comparisonCount: 1, changeCount: 1, state: 'user-owned-review' });
    expect(runBackgroundOwnershipReviewTurbo([facts([service(false)], { environment: 'other' })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ finalEnvironment: 'unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runBackgroundOwnershipReviewTurbo([], { trigger: 'bad' })).toThrow('Unsupported background-services ownership-review trigger: bad');
    expect(() => runBackgroundOwnershipReviewTurbo()).toThrow('Unsupported background-services ownership-review trigger: unknown');
    expect(() => runBackgroundOwnershipReviewTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBackgroundOwnershipReviewTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBackgroundOwnershipReviewTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBackgroundOwnershipReviewTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBackgroundOwnershipReviewTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBackgroundOwnershipReviewTurbo([{ engine: 'system-facts', services: null }], { trigger: 'health.interval' })).toThrow('requires a service list');
    expect(() => runBackgroundOwnershipReviewTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
