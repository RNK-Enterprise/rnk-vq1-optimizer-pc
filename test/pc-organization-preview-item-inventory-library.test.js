import {
  ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_ID,
  ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_VERSION,
  buildOrganizationPreviewItemInventoryEnvelope,
  buildOrganizationPreviewItemInventoryPlan,
  createOrganizationPreviewItemInventoryLibrary,
  mergeOrganizationPreviewItemInventoryReports
} from '../pc/engines/organization-preview/turbos/item-inventory/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'organization-preview.item-inventory', state: 'stable-item-inventory', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, itemCount: 2,
    addedCount: 0, removedCount: 0, inventoryChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noOrganizationCount: 0,
    comparisonCount: sampleCount - 1, inventoryChangeSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('organization-preview item-inventory library', () => {
  test('publishes identity and merges item evidence', () => {
    const merged = mergeOrganizationPreviewItemInventoryReports([
      report({ sampleCount: 2, itemCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'item-drift-sustained', sampleCount: 6, observedCount: 5,
        addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
        comparisonCount: 5, inventoryChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_ID).toBe('organization-preview.item-inventory.library');
    expect(ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'item-drift-sustained', sampleCount: 8,
      itemCount: 2, addedCount: 1, removedCount: 1, inventoryChangeCount: 2,
      observedCount: 7, comparisonCount: 6, inventoryChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-item-inventory-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeOrganizationPreviewItemInventoryReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-organization-items']
    });
    expect(mergeOrganizationPreviewItemInventoryReports([report({ state: 'no-organization-preview', sampleCount: 1,
      itemCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-organization-preview', recommendations: ['no-organization-preview']
    });
    expect(mergeOrganizationPreviewItemInventoryReports([report({ state: 'incomplete-evidence',
      itemCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-item-identity-observation']
    });
    expect(mergeOrganizationPreviewItemInventoryReports([report({ state: 'item-drift-observed',
      addedCount: 1, inventoryChangeCount: 1, inventoryChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-item-inventory-stability']);
    expect(mergeOrganizationPreviewItemInventoryReports([report()]).recommendations)
      .toEqual(['preview-proposals-only']);
    expect(mergeOrganizationPreviewItemInventoryReports([report({ state: 'insufficient-data', sampleCount: 1,
      itemCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeOrganizationPreviewItemInventoryReports([report({ state: 'insufficient-data', sampleCount: 0,
      itemCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeOrganizationPreviewItemInventoryReports([
      report({ state: 'item-drift-sustained' }), report({ state: 'no-organization-preview', sampleCount: 1,
        itemCount: 0, addedCount: 0, removedCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-organization-preview' });
    const states = [
      ['item-drift-sustained', 'item-inventory-review', 750],
      ['item-drift-observed', 'item-inventory-observation', 1000],
      ['stable-item-inventory', 'stable-item-observation', 5000],
      ['no-organization-preview', 'no-organization-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-organization-preview';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildOrganizationPreviewItemInventoryPlan(report({ state, sampleCount,
        itemCount: empty ? 0 : 2, addedCount: 0, removedCount: 0,
        observedCount: empty ? 0 : sampleCount, noOrganizationCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildOrganizationPreviewItemInventoryPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildOrganizationPreviewItemInventoryPlan(report({ sampleCount: 0, itemCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildOrganizationPreviewItemInventoryEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createOrganizationPreviewItemInventoryLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(ORGANIZATION_PREVIEW_ITEM_INVENTORY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, itemCount: 0,
      addedCount: 0, removedCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeOrganizationPreviewItemInventoryReports(null)).toThrow('reports must be an array');
    expect(() => mergeOrganizationPreviewItemInventoryReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeOrganizationPreviewItemInventoryReports([null])).toThrow('report must be an object');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ turbo: 'other' })]))
      .toThrow('requires an item-inventory turbo report');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noOrganizationCount', 'inventoryChangeSampleCount']) {
      expect(() => mergeOrganizationPreviewItemInventoryReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['addedCount', 'removedCount']) {
      expect(() => mergeOrganizationPreviewItemInventoryReports([report({ [field]: 3 })]))
        .toThrow('must fit inside itemCount');
    }
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ itemCount: 4097 })]))
      .toThrow('itemCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ inventoryChangeCount: 8193 })]))
      .toThrow('inventoryChangeCount must be from 0 to 8192');
    expect(() => mergeOrganizationPreviewItemInventoryReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildOrganizationPreviewItemInventoryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildOrganizationPreviewItemInventoryEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
