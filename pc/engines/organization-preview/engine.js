/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Organization-preview engine. It reports proposed user-file organization
 * without moving, renaming, deleting, or overwriting files.
 */

export const ORGANIZATION_PREVIEW_ENGINE_ID = 'organization-preview';
export const ORGANIZATION_PREVIEW_ENGINE_VERSION = 1;
export const ORGANIZATION_PREVIEW_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const CATEGORIES = Object.freeze(['documents', 'media', 'downloads', 'projects', 'archive']);
const EMPTY_ARRAY = Object.freeze([]);

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
  if (!isRecord(facts)) throw new TypeError('Organization-preview facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Organization-preview requires system-facts facts');
  if (!isRecord(facts.organization)) throw new TypeError('Organization-preview facts require an organization object');
  if (!Array.isArray(facts.organization.items)) {
    throw new TypeError('Organization-preview facts require an organization item list');
  }
  return facts;
}

function requireTrigger(trigger) {
  if (!ORGANIZATION_PREVIEW_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported organization-preview trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Organization-preview clock must return a number');
  return timestamp;
}

function operatingState(environment, count, unknownCount, userOwnedCount) {
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

export function runOrganizationPreviewEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
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
    protocolVersion: 1,
    engine: ORGANIZATION_PREVIEW_ENGINE_ID,
    engineVersion: ORGANIZATION_PREVIEW_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    itemCount: items.length,
    names: Object.freeze(items.map((item) => item.name).filter(Boolean)),
    categories: Object.freeze(items.map((item) => item.category)),
    proposals: Object.freeze(items.map((item) => item.proposal).filter(Boolean)),
    unknownCategoryCount: unknownCount,
    userOwnedCount,
    state: operatingState(environment, items.length, unknownCount, userOwnedCount),
    confidence: confidence(environment, items.length, unknownCount, namedCount),
    recommendations: recommendations(environment, items.length, unknownCount, userOwnedCount),
    actions: EMPTY_ARRAY
  });
}
