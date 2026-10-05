import {
  ORGANIZATION_PREVIEW_ENGINE_ID,
  ORGANIZATION_PREVIEW_ENGINE_VERSION,
  ORGANIZATION_PREVIEW_TRIGGERS,
  runOrganizationPreviewEngine
} from '../pc/engines/organization-preview/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    organization: {
      items: [
        { name: 'report', category: 'documents', proposal: 'documents/report', userOwned: true },
        { name: 'video', category: 'media', proposal: 'media/video', userOwned: true }
      ]
    },
    ...overrides
  };
}

describe('Organization-preview engine', () => {
  test('publishes identity and triggers', () => {
    expect(ORGANIZATION_PREVIEW_ENGINE_ID).toBe('organization-preview');
    expect(ORGANIZATION_PREVIEW_ENGINE_VERSION).toBe(1);
    expect(ORGANIZATION_PREVIEW_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(ORGANIZATION_PREVIEW_TRIGGERS)).toBe(true);
  });

  test('reports proposals without changing user files', () => {
    const result = runOrganizationPreviewEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: ORGANIZATION_PREVIEW_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      itemCount: 2,
      names: ['report', 'video'],
      categories: ['documents', 'media'],
      proposals: ['documents/report', 'media/video'],
      unknownCategoryCount: 0,
      userOwnedCount: 2,
      state: 'approval-required',
      confidence: 1,
      recommendations: ['request-explicit-organization-approval'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('keeps unknown categories in observation review', () => {
    expect(runOrganizationPreviewEngine(facts({ organization: { items: [
      { name: 'item', category: 'vendor-category', proposal: 'unknown', userOwned: false }
    ] } }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      unknownCategoryCount: 1,
      userOwnedCount: 0,
      state: 'observation-required',
      recommendations: ['request-organization-category-observation']
    });
  });

  test('reports empty and malformed organization items', () => {
    expect(runOrganizationPreviewEngine(facts({ organization: { items: [{}] } }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      itemCount: 1,
      names: [],
      categories: ['unknown'],
      proposals: [],
      unknownCategoryCount: 1,
      userOwnedCount: 0,
      confidence: 0.4,
      state: 'observation-required'
    });
    expect(runOrganizationPreviewEngine(facts({ organization: { items: [null, {
      name: '', category: '', proposal: '', userOwned: 1
    }] } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      itemCount: 1,
      names: [],
      categories: ['unknown'],
      proposals: [],
      userOwnedCount: 0
    });
    expect(runOrganizationPreviewEngine(facts({ organization: { items: [
      { name: 'system-item', category: 'archive', proposal: 'archive/system-item', userOwned: false }
    ] } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      state: 'preview-only',
      recommendations: ['preview-proposals-only']
    });
    expect(runOrganizationPreviewEngine(facts({
      environment: 'headless',
      organization: { items: [] }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      itemCount: 0,
      state: 'no-organization-preview',
      confidence: 0.2,
      recommendations: ['no-organization-preview']
    });
  });

  test('handles unknown environments and rejects malformed inputs', () => {
    expect(runOrganizationPreviewEngine(facts({
      environment: 'other',
      organization: { items: [] }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runOrganizationPreviewEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runOrganizationPreviewEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runOrganizationPreviewEngine(facts({ organization: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require an organization object');
    expect(() => runOrganizationPreviewEngine(facts({ organization: {} }), {
      trigger: 'system.facts.request'
    })).toThrow('require an organization item list');
    expect(() => runOrganizationPreviewEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported organization-preview trigger: bad');
    expect(() => runOrganizationPreviewEngine(facts(), {}))
      .toThrow('Unsupported organization-preview trigger: unknown');
    expect(() => runOrganizationPreviewEngine())
      .toThrow('Unsupported organization-preview trigger: unknown');
    expect(() => runOrganizationPreviewEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Organization-preview clock must return a number');
  });
});
