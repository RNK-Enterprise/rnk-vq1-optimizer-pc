/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Canonical PC optimizer engine inventory. The catalog describes identity and
 * trigger ownership only; each engine keeps its own implementation, library,
 * turbos, and turbo libraries.
 */

export const PC_ENGINE_CATALOG_ID = 'pc-optimizer.engines';
export const PC_ENGINE_CATALOG_VERSION = 1;
export const PC_ENGINE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

export const PC_ENGINE_IDS = Object.freeze([
  'system-facts',
  'cpu-utilization',
  'cpu-scheduler',
  'cpu-affinity',
  'cpu-frequency',
  'memory-pressure',
  'memory-policy',
  'swap',
  'gpu-utilization',
  'gpu-policy',
  'gpu-memory',
  'frame-pacing',
  'fps-target',
  'display-pipeline',
  'process-priority',
  'process-io',
  'process-lifecycle',
  'storage-health',
  'storage-capacity',
  'disk-io',
  'cache-cleanup',
  'shader-cache',
  'temp-cleanup',
  'power-profile',
  'thermal',
  'battery',
  'network-observation',
  'network-safety',
  'background-services',
  'startup',
  'workload-profile',
  'driver-capability',
  'organization-preview',
  'safety-audit'
]);

const DEFINITIONS = Object.freeze(PC_ENGINE_IDS.map((id, index) => Object.freeze({
  id,
  ordinal: index + 1,
  triggers: PC_ENGINE_TRIGGERS,
  execution: 'analysis-only-until-approved'
})));
const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

export function getPcEngineDefinition(id) {
  return BY_ID.get(id) || null;
}

export function requirePcEngineDefinition(id) {
  const definition = getPcEngineDefinition(id);
  if (!definition) throw new Error(`Unknown PC optimizer engine: ${id || 'unknown'}`);
  return definition;
}

export function createPcEngineCatalog() {
  return Object.freeze({
    id: PC_ENGINE_CATALOG_ID,
    version: PC_ENGINE_CATALOG_VERSION,
    count: DEFINITIONS.length,
    engines: DEFINITIONS,
    triggers: PC_ENGINE_TRIGGERS
  });
}
