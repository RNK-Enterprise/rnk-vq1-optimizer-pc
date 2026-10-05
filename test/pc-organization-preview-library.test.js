import {
  ORGANIZATION_PREVIEW_LIBRARY_ID,
  ORGANIZATION_PREVIEW_LIBRARY_VERSION,
  buildOrganizationPreviewEnvelope,
  classifyOrganizationPreview,
  compareOrganizationPreview,
  createOrganizationPreviewLibrary
} from '../pc/engines/organization-preview/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    organization: { items: [
      { name: 'notes', category: 'documents', proposal: 'review-documents', userOwned: true },
      { name: 'projects', category: 'projects', proposal: 'review-projects', userOwned: false }
    ] },
    ...overrides
  };
}

describe('Organization-preview library', () => {
  test('classifies proposals and preserves explicit approval boundaries', () => {
    expect(classifyOrganizationPreview(facts())).toMatchObject({
      library: ORGANIZATION_PREVIEW_LIBRARY_ID,
      libraryVersion: ORGANIZATION_PREVIEW_LIBRARY_VERSION,
      environment: 'interactive', itemCount: 2, names: ['notes', 'projects'],
      categories: ['documents', 'projects'], proposals: ['review-documents', 'review-projects'],
      unknownCategoryCount: 0, userOwnedCount: 1, state: 'approval-required', confidence: 1,
      recommendations: ['request-explicit-organization-approval']
    });
    expect(classifyOrganizationPreview(facts({ organization: { items: [
      { name: 'server', category: 'archive', proposal: 'preview-archive', userOwned: false }
    ] } }))).toMatchObject({ userOwnedCount: 0, state: 'preview-only', confidence: 1,
      recommendations: ['preview-proposals-only'] });
  });

  test('preserves unknown, empty, profile, and incomplete states', () => {
    expect(classifyOrganizationPreview(facts({ organization: { items: [
      { name: 'unknown', category: 'other', proposal: '', userOwned: false }
    ] } }))).toMatchObject({ itemCount: 1, names: ['unknown'], categories: ['unknown'],
      proposals: [], unknownCategoryCount: 1, userOwnedCount: 0,
      state: 'observation-required', confidence: 0.7,
      recommendations: ['request-organization-category-observation'] });
    expect(classifyOrganizationPreview(facts({ organization: { items: [] } }))).toMatchObject({
      itemCount: 0, categories: [], proposals: [], state: 'no-organization-preview', confidence: 0.2,
      recommendations: ['no-organization-preview']
    });
    expect(classifyOrganizationPreview(facts({ environment: 'other', organization: { items: [] } })))
      .toMatchObject({ environment: 'unknown', state: 'profile-required', confidence: 0,
        recommendations: ['request-environment-profile'] });
    expect(classifyOrganizationPreview(facts({ organization: { items: [null, {
      name: '', category: null, proposal: null, userOwned: true
    }] } }))).toMatchObject({ itemCount: 1, names: [], categories: ['unknown'], proposals: [],
      unknownCategoryCount: 1, userOwnedCount: 1, confidence: 0.4 });
  });

  test('compares proposals and builds immutable local facades', () => {
    expect(compareOrganizationPreview(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, unknownChanged: false,
      ownershipChanged: false, categoriesChanged: false, proposalsChanged: false
    });
    expect(compareOrganizationPreview(facts(), facts({ organization: { items: [
      { name: 'notes', category: 'media', proposal: 'review-media', userOwned: false },
      { name: 'new', category: 'archive', proposal: 'review-archive', userOwned: false },
      { name: 'unknown', category: 'other', proposal: '', userOwned: false }
    ] } }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, unknownChanged: true,
      ownershipChanged: true, categoriesChanged: true, proposalsChanged: true
    });
    const envelope = buildOrganizationPreviewEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createOrganizationPreviewLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyOrganizationPreview(null)).toThrow('facts must be an object');
    expect(() => classifyOrganizationPreview({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyOrganizationPreview({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyOrganizationPreview({ ...facts(), organization: null }))
      .toThrow('requires an organization object');
    expect(() => classifyOrganizationPreview({ ...facts(), organization: { items: null } }))
      .toThrow('requires an organization item list');
    expect(() => buildOrganizationPreviewEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildOrganizationPreviewEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildOrganizationPreviewEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildOrganizationPreviewEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createOrganizationPreviewLibrary(null)).toThrow('options must be an object');
    expect(() => createOrganizationPreviewLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
