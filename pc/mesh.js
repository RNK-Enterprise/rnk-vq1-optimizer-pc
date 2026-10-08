/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * PC-wide local mesh. It registers every engine, dedicated library, turbo,
 * and turbo library behind typed in-process command/event routes. Loading is
 * lazy and dispatch is trigger-based; this file has no external transport.
 */

import { PC_ENGINE_IDS, PC_ENGINE_TRIGGERS } from './engines/catalog.js';

export const PC_MESH_ID = 'optimizer.pc.mesh';
export const PC_MESH_VERSION = 1;
export const PC_MESH_TRIGGERS = PC_ENGINE_TRIGGERS;

const NODE_KINDS = Object.freeze(['engine', 'library', 'turbo', 'turbo-library']);
const BRIDGE_TYPES = Object.freeze(['command', 'event']);
const TURBOS = Object.freeze({
  'system-facts': ['cadence', 'capability', 'pressure', 'stability'],
  'cpu-utilization': ['burst-window', 'core-skew', 'saturation-guard', 'trend-slope'],
  'cpu-scheduler': ['context-churn', 'governor-transitions', 'queue-utilization-mismatch', 'run-queue-burst'],
  'cpu-affinity': ['mask-drift', 'mask-skew', 'smt-layout', 'topology-drift'],
  'cpu-frequency': ['boost-headroom', 'frequency-residency', 'load-governor-mismatch', 'policy-shift'],
  'memory-pressure': ['headroom-volatility', 'oom-margin', 'swap-thrash', 'used-trend'],
  'memory-policy': ['consent-boundary', 'headless-posture', 'pressure-policy-drift', 'swap-policy-alignment'],
  swap: ['accounting-consistency', 'availability-drift', 'headroom-collapse', 'pressure-dwell'],
  'gpu-utilization': ['multi-gpu-skew', 'thermal-margin', 'utilization-burst', 'vram-pressure'],
  'gpu-policy': ['driver-drift', 'evidence-completeness', 'observation-boundary', 'vendor-mix'],
  'gpu-memory': ['allocation-headroom', 'capacity-skew', 'counter-integrity', 'occupancy-drift'],
  'frame-pacing': ['cadence-stability', 'drop-budget', 'jitter-drift', 'target-gap'],
  'fps-target': ['observation-confidence', 'refresh-headroom', 'target-source-drift', 'user-target-guard'],
  'display-pipeline': ['hdr-capability', 'refresh-drift', 'resolution-drift', 'vrr-stability'],
  'process-priority': ['foreground-protection', 'priority-drift', 'priority-volatility', 'unknown-label'],
  'process-io': ['contention-burst', 'observation-confidence', 'read-write-skew', 'service-contention'],
  'process-lifecycle': ['restart-burst', 'state-coverage', 'uptime-churn', 'zombie-persistence'],
  'storage-health': ['capacity-drift', 'health-degradation', 'read-only-drift', 'storage-confidence'],
  'storage-capacity': ['capacity-evidence', 'free-space-drift', 'headroom-trend', 'volume-skew'],
  'disk-io': ['io-evidence', 'throughput-skew', 'wait-burst', 'wait-trend'],
  'cache-cleanup': ['candidate-drift', 'evidence-completeness', 'ownership-boundary', 'size-trend'],
  'shader-cache': ['ownership-boundary', 'rebuild-evidence', 'size-trend', 'validity-drift'],
  'temp-cleanup': ['candidate-boundary', 'ownership-drift', 'preview-safety', 'size-trend'],
  'power-profile': ['availability-drift', 'control-boundary', 'environment-fit', 'profile-drift'],
  thermal: ['cooldown-recovery', 'sensor-stability', 'thermal-margin', 'throttle-onset'],
  battery: ['charge-ceiling', 'charge-trend', 'health-boundary', 'power-source-drift'],
  'network-observation': ['interface-inventory', 'link-health', 'mesh-evidence', 'route-stability'],
  'network-safety': ['encryption-drift', 'public-exposure', 'safety-evidence', 'trust-drift'],
  'background-services': ['criticality-boundary', 'observation-boundary', 'ownership-review', 'state-drift'],
  startup: ['delay-trend', 'entry-drift', 'ownership-boundary', 'requiredness-drift'],
  'workload-profile': ['context-drift', 'declaration-stability', 'environment-boundary', 'intensity-trend'],
  'driver-capability': ['evidence-drift', 'identity-completeness', 'inventory-drift', 'version-churn'],
  'organization-preview': ['category-drift', 'item-inventory', 'ownership-review', 'proposal-drift'],
  'safety-audit': ['admin-boundary', 'approval-drift', 'mutation-boundary', 'proposal-risk']
});

function authority(id) { return `optimizer.authority.${id}`; }
function dispatchName(id) { return `optimizer.dispatch.${id}`; }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireTrigger(trigger) {
  if (!PC_MESH_TRIGGERS.includes(trigger)) throw new Error(`Unsupported PC mesh trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireClock(now) {
  if (typeof now !== 'function') throw new TypeError('PC mesh clock must be a function');
  return now;
}
function modulePath(engine, kind, turbo) {
  if (kind === 'engine') return `./engines/${engine}/engine.js`;
  if (kind === 'library') return `./engines/${engine}/library.js`;
  return `./engines/${engine}/turbos/${turbo}/${kind === 'turbo' ? 'turbo' : 'library'}.js`;
}
function makeNode(engine, kind, turbo = null) {
  const suffix = turbo ? `${turbo}.${kind}` : kind;
  const id = `${engine}.${suffix}`;
  return Object.freeze({ id, engine, kind, turbo, authority: authority(id), dispatch: dispatchName(id), modulePath: modulePath(engine, kind, turbo), lazy: true, triggers: PC_MESH_TRIGGERS });
}
function makeNodes() {
  return Object.freeze(PC_ENGINE_IDS.flatMap((engine) => [
    makeNode(engine, 'engine'),
    makeNode(engine, 'library'),
    ...TURBOS[engine].flatMap((turbo) => [makeNode(engine, 'turbo', turbo), makeNode(engine, 'turbo-library', turbo)])
  ]));
}
function localBridges(nodes, engine) {
  const own = nodes.filter((node) => node.engine === engine);
  const root = own.find((node) => node.kind === 'engine');
  return own.filter((node) => node !== root).flatMap((node) => [
    Object.freeze({ type: 'command', from: root.dispatch, to: node.authority, engine }),
    Object.freeze({ type: 'event', from: node.dispatch, to: root.authority, engine })
  ]);
}
function engineBridges(nodes) {
  const engines = nodes.filter((node) => node.kind === 'engine');
  return engines.flatMap((from) => engines.filter((to) => to !== from).flatMap((to) => [
    Object.freeze({ type: 'command', from: from.dispatch, to: to.authority, engine: from.engine, targetEngine: to.engine }),
    Object.freeze({ type: 'event', from: to.dispatch, to: from.authority, engine: to.engine, targetEngine: from.engine })
  ]));
}
function makeBridges(nodes) {
  return Object.freeze(PC_ENGINE_IDS.flatMap((engine) => localBridges(nodes, engine)).concat(engineBridges(nodes)));
}
function findNode(nodes, reference) {
  if (typeof reference !== 'string') return null;
  return nodes.find((node) => node.id === reference || node.authority === reference || node.dispatch === reference) || null;
}
function routeKey(bridge) { return `${bridge.type}:${bridge.from}->${bridge.to}`; }
function loadedNodeIds(loaded) { return Object.freeze([...loaded.keys()]); }
function runnerName(engine) {
  const name = engine.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join('');
  return `run${name}Engine`;
}

export function createPcMesh({ now = Date.now } = {}) {
  const clock = requireClock(now);
  const nodes = makeNodes();
  const bridges = makeBridges(nodes);
  const routes = new Map(bridges.map((bridge) => [routeKey(bridge), bridge]));
  const loaded = new Map();

  async function loadNode(reference) {
    const node = findNode(nodes, reference);
    if (!node) throw new Error(`Unknown PC mesh node: ${reference || 'unknown'}`);
    if (loaded.has(node.id)) return loaded.get(node.id);
    const module = await import(node.modulePath);
    loaded.set(node.id, module);
    return module;
  }

  async function executeEngine(reference, input = {}, { trigger } = {}) {
    const node = findNode(nodes, reference);
    if (!node || node.kind !== 'engine') throw new Error('PC mesh execution requires an engine node');
    requireTrigger(trigger);
    const module = await loadNode(node.id);
    const run = module[runnerName(node.engine)];
    return run(input, { trigger, now: clock });
  }

  function dispatchMessage({ type, from, to, trigger, payload = {}, requestId = null } = {}) {
    requireTrigger(trigger);
    if (!BRIDGE_TYPES.includes(type)) throw new Error(`Unsupported PC mesh bridge type: ${type || 'unknown'}`);
    if (!isRecord(payload)) throw new TypeError('PC mesh payload must be an object');
    const source = findNode(nodes, from);
    const target = findNode(nodes, to);
    if (!source || !target) throw new Error('PC mesh route references an unknown node');
    const bridge = routes.get(`${type}:${source.dispatch}->${target.authority}`);
    if (!bridge) throw new Error('PC mesh route is not registered');
    const timestamp = clock();
    if (!Number.isFinite(timestamp)) throw new TypeError('PC mesh clock must return a number');
    return Object.freeze({ protocolVersion: 1, mesh: PC_MESH_ID, meshVersion: PC_MESH_VERSION, type, trigger,
      requestId: typeof requestId === 'string' && requestId.length > 0 ? requestId : `pc-mesh-${timestamp}`,
      from: source.dispatch, to: target.authority, payload: Object.freeze({ ...payload }), loadedNodes: loadedNodeIds(loaded), actions: Object.freeze([]) });
  }

  return Object.freeze({
    id: PC_MESH_ID,
    version: PC_MESH_VERSION,
    listNodes: () => nodes,
    listBridges: () => bridges,
    resolveNode: (reference) => findNode(nodes, reference),
    loadedNodes: () => loadedNodeIds(loaded),
    loadNode,
    executeEngine,
    dispatch: dispatchMessage
  });
}
