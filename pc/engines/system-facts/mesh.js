/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Standalone system-facts mesh. It connects the engine, its dedicated library,
 * four turbos, and four turbo libraries through typed in-process routes. The
 * mesh is lazy, trigger-driven, and has no external transport or file action.
 */

export const SYSTEM_FACTS_MESH_ID = 'optimizer.system-facts.mesh';
export const SYSTEM_FACTS_MESH_VERSION = 1;
export const SYSTEM_FACTS_MESH_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENGINE_NODE = 'engine';
const COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'engine',
    kind: 'engine',
    authority: 'optimizer.authority.engine.system-facts',
    dispatch: 'optimizer.dispatch.engine.system-facts'
  }),
  Object.freeze({
    id: 'engine-library',
    kind: 'library',
    authority: 'optimizer.authority.library.system-facts',
    dispatch: 'optimizer.dispatch.library.system-facts'
  }),
  Object.freeze({
    id: 'stability-turbo',
    kind: 'turbo',
    authority: 'optimizer.authority.turbo.system-facts-stability',
    dispatch: 'optimizer.dispatch.turbo.system-facts-stability'
  }),
  Object.freeze({
    id: 'stability-library',
    kind: 'turbo-library',
    authority: 'optimizer.authority.turbo-library.system-facts-stability',
    dispatch: 'optimizer.dispatch.turbo-library.system-facts-stability'
  }),
  Object.freeze({
    id: 'pressure-turbo',
    kind: 'turbo',
    authority: 'optimizer.authority.turbo.system-facts-pressure',
    dispatch: 'optimizer.dispatch.turbo.system-facts-pressure'
  }),
  Object.freeze({
    id: 'pressure-library',
    kind: 'turbo-library',
    authority: 'optimizer.authority.turbo-library.system-facts-pressure',
    dispatch: 'optimizer.dispatch.turbo-library.system-facts-pressure'
  }),
  Object.freeze({
    id: 'capability-turbo',
    kind: 'turbo',
    authority: 'optimizer.authority.turbo.system-facts-capability',
    dispatch: 'optimizer.dispatch.turbo.system-facts-capability'
  }),
  Object.freeze({
    id: 'capability-library',
    kind: 'turbo-library',
    authority: 'optimizer.authority.turbo-library.system-facts-capability',
    dispatch: 'optimizer.dispatch.turbo-library.system-facts-capability'
  }),
  Object.freeze({
    id: 'cadence-turbo',
    kind: 'turbo',
    authority: 'optimizer.authority.turbo.system-facts-cadence',
    dispatch: 'optimizer.dispatch.turbo.system-facts-cadence'
  }),
  Object.freeze({
    id: 'cadence-library',
    kind: 'turbo-library',
    authority: 'optimizer.authority.turbo-library.system-facts-cadence',
    dispatch: 'optimizer.dispatch.turbo-library.system-facts-cadence'
  })
]);

const LOADERS = Object.freeze({
  engine: () => import('./engine.js'),
  'engine-library': () => import('./library.js'),
  'stability-turbo': () => import('./turbos/stability/turbo.js'),
  'stability-library': () => import('./turbos/stability/library.js'),
  'pressure-turbo': () => import('./turbos/pressure/turbo.js'),
  'pressure-library': () => import('./turbos/pressure/library.js'),
  'capability-turbo': () => import('./turbos/capability/turbo.js'),
  'capability-library': () => import('./turbos/capability/library.js'),
  'cadence-turbo': () => import('./turbos/cadence/turbo.js'),
  'cadence-library': () => import('./turbos/cadence/library.js')
});

const TURBOS_BY_TRIGGER = Object.freeze({
  'install.preflight': Object.freeze(['capability', 'cadence']),
  'system.facts.request': Object.freeze(['stability', 'pressure', 'capability', 'cadence']),
  'workload.changed': Object.freeze(['stability', 'pressure', 'cadence']),
  'health.interval': Object.freeze(['stability', 'pressure', 'capability', 'cadence'])
});

function component(id) {
  return COMPONENTS.find((item) => item.id === id);
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_MESH_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported system-facts mesh trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireHistory(history) {
  if (!Array.isArray(history)) throw new TypeError('System-facts mesh history must be an array');
  return history;
}

function bridgeList() {
  const engine = component(ENGINE_NODE);
  return Object.freeze(COMPONENTS
    .filter((item) => item.id !== ENGINE_NODE)
    .flatMap((item) => [
      Object.freeze({
        type: 'command',
        from: engine.dispatch,
        to: item.authority,
        component: item.id
      }),
      Object.freeze({
        type: 'event',
        from: item.dispatch,
        to: engine.authority,
        component: item.id
      })
    ]));
}

function loadedFqns(loaded) {
  return Object.freeze([...loaded]
    .map((id) => component(id))
    .filter(Boolean)
    .flatMap((item) => [item.authority, item.dispatch]));
}

function selectTurboIds(trigger) {
  return TURBOS_BY_TRIGGER[trigger];
}

function turboComponentId(name) {
  return `${name}-turbo`;
}

function libraryComponentId(name) {
  return `${name}-library`;
}

async function load(loaderCache, loaded, id) {
  if (loaderCache.has(id)) return loaderCache.get(id);
  const loader = LOADERS[id];
  const pending = loader();
  loaderCache.set(id, pending);
  loaded.add(id);
  return pending;
}

function runTurboModule(name, module, facts, trigger, history, now) {
  if (name === 'stability') {
    return module.runStabilityTurbo(history, { trigger, now });
  }
  if (name === 'pressure') return module.runPressureTurbo(facts, { trigger, now });
  if (name === 'capability') return module.runCapabilityTurbo(facts, { trigger, now });
  return module.runCadenceTurbo(facts, { trigger, history, now });
}

function mergeTurboModule(name, module, report, environment) {
  if (name === 'stability') {
    return {
      aggregate: module.mergeStabilityReports([report]),
      plan: module.buildStabilityPlan(report, environment)
    };
  }
  if (name === 'pressure') {
    return {
      aggregate: module.mergePressureReports([report]),
      plan: module.buildPressurePlan(report, environment)
    };
  }
  if (name === 'capability') {
    return {
      aggregate: module.mergeCapabilityReports([report]),
      plan: module.buildCapabilityPlan(report, environment)
    };
  }
  return {
    aggregate: module.mergeCadenceReports([report]),
    plan: module.buildCadencePolicy(report, environment)
  };
}

function requireClock(now) {
  if (typeof now !== 'function') throw new TypeError('System-facts mesh clock must be a function');
  return now;
}

export function createSystemFactsMesh({ now = Date.now } = {}) {
  const clock = requireClock(now);
  const loaderCache = new Map();
  const loaded = new Set();

  async function dispatch(input = {}, { trigger, history = [] } = {}) {
    requireTrigger(trigger);
    const samples = requireHistory(history);
    const engineModule = await load(loaderCache, loaded, 'engine');
    const engineResult = engineModule.runSystemFactsEngine(input, { trigger, now: clock });
    const engineLibrary = await load(loaderCache, loaded, 'engine-library');
    const library = engineLibrary.createSystemFactsLibrary({ now: clock });
    const envelope = library.envelope(engineResult.facts, { trigger });
    const results = {};
    for (const name of selectTurboIds(trigger)) {
      const turboModule = await load(loaderCache, loaded, turboComponentId(name));
      const report = runTurboModule(name, turboModule, engineResult.facts, trigger, samples, clock);
      const turboLibrary = await load(loaderCache, loaded, libraryComponentId(name));
      results[name] = Object.freeze({ report, ...mergeTurboModule(name, turboLibrary, report, engineResult.facts.environment) });
    }
    return Object.freeze({
      protocolVersion: 1,
      mesh: SYSTEM_FACTS_MESH_ID,
      meshVersion: SYSTEM_FACTS_MESH_VERSION,
      trigger,
      engine: engineResult,
      envelope,
      turbos: Object.freeze(results),
      loadedNodes: loadedFqns(loaded),
      actions: Object.freeze([])
    });
  }

  return Object.freeze({
    id: SYSTEM_FACTS_MESH_ID,
    version: SYSTEM_FACTS_MESH_VERSION,
    listNodes: () => Object.freeze(COMPONENTS.flatMap((item) => [item.authority, item.dispatch])),
    listBridges: bridgeList,
    resolveNode: (fqn) => COMPONENTS.find((item) => item.authority === fqn || item.dispatch === fqn) || null,
    loadedComponents: () => Object.freeze([...loaded]),
    dispatch
  });
}
