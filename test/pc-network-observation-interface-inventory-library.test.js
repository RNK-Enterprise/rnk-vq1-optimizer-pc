import {
  NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
  NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION,
  buildNetworkObservationInterfaceInventoryEnvelope,
  buildNetworkObservationInterfaceInventoryPlan,
  createNetworkObservationInterfaceInventoryLibrary,
  mergeNetworkObservationInterfaceInventoryReports
} from '../pc/engines/network-observation/turbos/interface-inventory/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-observation.interface-inventory', state: 'stable-interface-inventory', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    addedCount: 0, removedCount: 0, inventoryChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noNetworkCount: 0,
    comparisonCount: sampleCount - 1, inventoryChangeSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('network-observation interface-inventory library', () => {
  test('publishes identity and merges interface evidence', () => {
    const merged = mergeNetworkObservationInterfaceInventoryReports([
      report({ sampleCount: 2, linkCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'interface-drift-sustained', sampleCount: 6, observedCount: 5,
        addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
        comparisonCount: 5, inventoryChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID).toBe('network-observation.interface-inventory.library');
    expect(NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'interface-drift-sustained', sampleCount: 8,
      linkCount: 2, addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
      observedCount: 7, comparisonCount: 6, inventoryChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-interface-inventory-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkObservationInterfaceInventoryReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-interface-inventory']
    });
    expect(mergeNetworkObservationInterfaceInventoryReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-interface-review']
    });
    expect(mergeNetworkObservationInterfaceInventoryReports([report({ state: 'incomplete-evidence',
      linkCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-interface-identity-evidence']
    });
    expect(mergeNetworkObservationInterfaceInventoryReports([report({ state: 'interface-drift-observed',
      addedCount: 1, inventoryChangeCount: 1, inventoryChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-interface-inventory-stability']);
    expect(mergeNetworkObservationInterfaceInventoryReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkObservationInterfaceInventoryReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkObservationInterfaceInventoryReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkObservationInterfaceInventoryReports([
      report({ state: 'interface-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['interface-drift-sustained', 'interface-inventory-review', 750],
      ['interface-drift-observed', 'interface-inventory-observation', 1000],
      ['stable-interface-inventory', 'stable-interface-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkObservationInterfaceInventoryPlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, addedCount: 0, removedCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkObservationInterfaceInventoryPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkObservationInterfaceInventoryPlan(report({ sampleCount: 0, linkCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkObservationInterfaceInventoryEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkObservationInterfaceInventoryLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkObservationInterfaceInventoryReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkObservationInterfaceInventoryReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ turbo: 'other' })]))
      .toThrow('requires an interface-inventory turbo report');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'inventoryChangeSampleCount']) {
      expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['addedCount', 'removedCount']) {
      expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ [field]: 3 })]))
        .toThrow('must fit inside linkCount');
    }
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ inventoryChangeCount: 8193 })]))
      .toThrow('inventoryChangeCount must be from 0 to 8192');
    expect(() => mergeNetworkObservationInterfaceInventoryReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkObservationInterfaceInventoryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkObservationInterfaceInventoryEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
