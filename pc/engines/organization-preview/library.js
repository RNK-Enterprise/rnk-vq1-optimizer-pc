/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Organization-preview library. It classifies proposed user-file organization
 * without moving, renaming, deleting, or overwriting files.
 */

export const ORGANIZATION_PREVIEW_LIBRARY_ID = 'organization-preview-library';
export const ORGANIZATION_PREVIEW_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const CATEGORIES = Object.freeze(['documents', 'media', 'downloads', 'projects', 'archive']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function categoryOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return CATEGORIES.includes(normalized) ? normalized : 'unknown';
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Organization-preview library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Organization-preview library requires normalized system facts');
  }
  if (!isRecord(facts.organization)) {
    throw new TypeError('Organization-preview library requires an organization object');
  }
  if (!Array.isArray(facts.organization.items)) {
    throw new TypeError('Organization-preview library requires an organization item list');
  }
  return facts;
}

function stateFor(environment, count, unknownCount, userOwnedCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-organization-preview';
  if (unknownCount > 0) return 'observation-required';
  if (userOwnedCount > 0) return 'approval-required';
  return 'preview-only';
}

function recommendations(environment, count, unknownCount, userOwnedCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-organization-preview']);
  if (unknownCount > 0) return Object.freeze(['request-organization-category-observation']);
  if (userOwnedCount > 0) return Object.freeze(['request-explicit-organization-approval']);
  return Object.freeze(['preview-proposals-only']);
}

function confidence(environment, count, unknownCount, namedCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (count > 0 && unknownCount === 0) score += 0.3;
  if (count > 0 && namedCount === count) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function classifyOrganizationPreview(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const items = source.organization.items.filter(isRecord).map((item) => ({
    name: text(item.name),
    category: categoryOf(item.category),
    proposal: text(item.proposal),
    userOwned: item.userOwned === true
  }));
  const unknownCount = items.filter((item) => item.category === 'unknown').length;
  const userOwnedCount = items.filter((item) => item.userOwned).length;
  const namedCount = items.filter((item) => item.name !== null).length;
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_LIBRARY_VERSION,
    environment,
    itemCount: items.length,
    names: Object.freeze(items.map((item) => item.name).filter(Boolean)),
    categories: Object.freeze(items.map((item) => item.category)),
    proposals: Object.freeze(items.map((item) => item.proposal).filter(Boolean)),
    unknownCategoryCount: unknownCount,
    userOwnedCount,
    state: stateFor(environment, items.length, unknownCount, userOwnedCount),
    confidence: confidence(environment, items.length, unknownCount, namedCount),
    recommendations: recommendations(environment, items.length, unknownCount, userOwnedCount)
  });
}

export function compareOrganizationPreview(previous, current) {
  const before = classifyOrganizationPreview(previous);
  const after = classifyOrganizationPreview(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.itemCount !== after.itemCount;
  const unknownChanged = before.unknownCategoryCount !== after.unknownCategoryCount;
  const ownershipChanged = before.userOwnedCount !== after.userOwnedCount;
  const categoriesChanged = before.categories.join('|') !== after.categories.join('|');
  const proposalsChanged = before.proposals.join('|') !== after.proposals.join('|');
  return Object.freeze({
    changed: stateChanged || countChanged || unknownChanged || ownershipChanged
      || categoriesChanged || proposalsChanged,
    stateChanged,
    countChanged,
    unknownChanged,
    ownershipChanged,
    categoriesChanged,
    proposalsChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Organization-preview library clock must return a number');
  return timestamp;
}

export function buildOrganizationPreviewEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Organization-preview library trigger is required');
  }
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyOrganizationPreview(facts)
  });
}

export function createOrganizationPreviewLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Organization-preview library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: ORGANIZATION_PREVIEW_LIBRARY_ID,
    version: ORGANIZATION_PREVIEW_LIBRARY_VERSION,
    classify: classifyOrganizationPreview,
    compare: compareOrganizationPreview,
    envelope: (facts, envelopeOptions = {}) => buildOrganizationPreviewEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
