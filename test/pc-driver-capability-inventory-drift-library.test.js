import {
  DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
  DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION,
  buildDriverCapabilityInventoryDriftEnvelope,
  buildDriverCapabilityInventoryDriftPlan,
  createDriverCapabilityInventoryDriftLibrary,
  mergeDriverCapabilityInventoryDriftReports
} from '../pc/engines/driver-capability/turbos/inventory-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'driver-capability.inventory-drift', state: 'stable-inventory', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, driverCount: 2,
    addedCount: 0, removedCount: 0, inventoryChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noDriverCount: 0,
    comparisonCount: sampleCount - 1, inventoryChangeSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('driver-capability inventory-drift library', () => {
  test('publishes identity and merges inventory evidence', () => {
    const merged = mergeDriverCapabilityInventoryDriftReports([
      report({ sampleCount: 2, driverCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'inventory-drift-sustained', sampleCount: 6, observedCount: 5,
        addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
        comparisonCount: 5, inventoryChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID).toBe('driver-capability.inventory-drift.library');
    expect(DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'inventory-drift-sustained', sampleCount: 8,
      driverCount: 2, addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
      observedCount: 7, comparisonCount: 6, inventoryChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-driver-inventory-drift-without-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeDriverCapabilityInventoryDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-driver-inventory']
    });
    expect(mergeDriverCapabilityInventoryDriftReports([report({ state: 'no-drivers', sampleCount: 1,
      driverCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-drivers', recommendations: ['no-driver-inventory-review']
    });
    expect(mergeDriverCapabilityInventoryDriftReports([report({ state: 'incomplete-evidence',
      driverCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-driver-inventory-evidence']
    });
    expect(mergeDriverCapabilityInventoryDriftReports([report({ state: 'inventory-drift-observed',
      addedCount: 1, inventoryChangeCount: 1, inventoryChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-driver-inventory-stability']);
    expect(mergeDriverCapabilityInventoryDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeDriverCapabilityInventoryDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      driverCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeDriverCapabilityInventoryDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      driverCount: 0, addedCount: 0, removedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDriverCapabilityInventoryDriftReports([
      report({ state: 'inventory-drift-sustained' }), report({ state: 'no-drivers', sampleCount: 1,
        driverCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-drivers' });
    const states = [
      ['inventory-drift-sustained', 'driver-inventory-review', 750],
      ['inventory-drift-observed', 'driver-inventory-observation', 1000],
      ['stable-inventory', 'stable-driver-inventory-observation', 5000],
      ['no-drivers', 'no-driver-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-drivers';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildDriverCapabilityInventoryDriftPlan(report({ state, sampleCount,
        driverCount: empty ? 0 : 2, addedCount: 0, removedCount: 0,
        observedCount: empty ? 0 : sampleCount, noDriverCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildDriverCapabilityInventoryDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildDriverCapabilityInventoryDriftPlan(report({ sampleCount: 0, driverCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDriverCapabilityInventoryDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDriverCapabilityInventoryDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, driverCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeDriverCapabilityInventoryDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeDriverCapabilityInventoryDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeDriverCapabilityInventoryDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires an inventory-drift turbo report');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDriverCount', 'comparisonCount', 'inventoryChangeSampleCount']) {
      expect(() => mergeDriverCapabilityInventoryDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['addedCount', 'removedCount']) {
      expect(() => mergeDriverCapabilityInventoryDriftReports([report({ [field]: 3 })]))
        .toThrow('must fit inside driverCount');
    }
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ driverCount: 4097 })]))
      .toThrow('driverCount must be from 0 to 4096');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ inventoryChangeCount: 8193 })]))
      .toThrow('inventoryChangeCount must be from 0 to 8192');
    expect(() => mergeDriverCapabilityInventoryDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildDriverCapabilityInventoryDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDriverCapabilityInventoryDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
