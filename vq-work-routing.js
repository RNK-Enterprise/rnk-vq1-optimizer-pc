/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * VQ Work Routing - capability-aware request classification and unit
 * selection for the LISA Secure Proxy tandem cluster.
 *
 * The two units advertise their speciality in every health frame:
 *   VQ-1: role "compute-optimized", capabilities ["compute"]
 *   VQ-2: role "render-optimized",  capabilities ["render"]
 * The proxy *prefers* the matching unit for classified work but never
 * requires it: speciality is a hint, not an exclusivity. Whenever the
 * preferred unit is down, busy, or has not advertised a matching
 * capability yet, selection degrades to the ordinary least-loaded rule so
 * routing never dead-ends.
 */

/** Workload classes the classifier can assign. */
const WORK_CLASSES = {
  RENDER: 'render',
  COMPUTE: 'compute',
  GENERAL: 'general'
};

/** Command type -> class. Engine execution is classified by engine name below. */
const TYPE_CLASS = {
  'vq.bench': WORK_CLASSES.COMPUTE,
  'vq.render.effect': WORK_CLASSES.RENDER,
  'vq.render.stop': WORK_CLASSES.RENDER,
  'vq.engines.search': WORK_CLASSES.COMPUTE,
  'vq.engines.list': WORK_CLASSES.COMPUTE,
  'vq.engine.info': WORK_CLASSES.COMPUTE
};

/**
 * Engine-name keywords, highest specificity first. A request that executes
 * a render-domain engine is render-class even though the command is a
 * generic "execute".
 */
const RENDER_ENGINE_HINTS = [
  'render', 'particle', 'shader', 'canvas', 'viewport', 'sprite', 'mesh',
  'texture', 'animation', 'visual', 'graphics', 'draw', 'scene', 'camera',
  'light', 'material', 'model', 'video', 'image', 'display', 'screen',
  'gesture', 'overlay', 'ui-engine', 'spatial-audio', '3d', 'webgl'
];

const COMPUTE_ENGINE_HINTS = [
  'compute', 'physics', 'collision', 'quantum', 'crypto', 'hash', 'compress',
  'matrix', 'vector', 'signal', 'simulate', 'solver', 'event', 'state',
  'time', 'data', 'ml', 'neural', 'inference', 'training', 'ai-engine'
];

function _includesAny(name, hints) {
  return hints.some((h) => name.includes(h));
}

/**
 * Classify an outgoing request payload.
 * Priority: explicit override > command type > engine-name hints > general.
 * @param {object} payload the request about to be dispatched
 * @returns {{ workClass: string, reason: string }}
 */
function classifyWork(payload) {
  if (!payload || typeof payload !== 'object') {
    return { workClass: WORK_CLASSES.GENERAL, reason: 'no-payload' };
  }

  // 1) Explicit client override: routingHint: 'render' | 'compute' | 'general'
  const hint = payload.routingHint;
  if (typeof hint === 'string' && hint.length > 0) {
    return { workClass: hint.toLowerCase(), reason: 'explicit-hint' };
  }

  const type = typeof payload.type === 'string' ? payload.type : '';

  // 2) Command-type table
  const typeClass = TYPE_CLASS[type];
  if (typeClass) return { workClass: typeClass, reason: 'command-type' };

  // 3) Engine execution: classify by the target engine's name.
  if (type === 'vq.work.execute') {
    const raw = (payload.payload && payload.payload.engine) || payload.engine || '';
    const name = String(raw).toLowerCase();
    if (name) {
      if (_includesAny(name, RENDER_ENGINE_HINTS)) {
        return { workClass: WORK_CLASSES.RENDER, reason: 'engine-name' };
      }
      if (_includesAny(name, COMPUTE_ENGINE_HINTS)) {
        return { workClass: WORK_CLASSES.COMPUTE, reason: 'engine-name' };
      }
    }
    return { workClass: WORK_CLASSES.GENERAL, reason: 'unclassified-engine' };
  }

  return { workClass: WORK_CLASSES.GENERAL, reason: 'no-match' };
}

/**
 * Does this unit advertise the capability a class needs?
 * Units that have never advertised capabilities (older builds) match
 * everything - capability preference must never *block* dispatch.
 * @param {import('./lisa-secure-proxy.js').VQUnit} unit
 * @param {string} workClass
 */
function unitSupports(unit, workClass) {
  if (!Array.isArray(unit.capabilities) || unit.capabilities.length === 0) return true;
  if (workClass === WORK_CLASSES.GENERAL) return true;
  // A "compute-optimized" unit implicitly supports general compute work;
  // "render-optimized" implies render work.
  const role = typeof unit.role === 'string' ? unit.role : '';
  const roleImplicit =
    (workClass === WORK_CLASSES.RENDER && role.includes('render')) ||
    (workClass === WORK_CLASSES.COMPUTE && role.includes('compute'));
  return unit.capabilities.includes(workClass) || roleImplicit;
}

/**
 * Choose the unit for a request.
 * 1. Healthy units that support the work class: least in-flight, then
 *    lowest latency (as pickUnit).
 * 2. No supporter healthy: fall back to ALL healthy units - work still
 *    flows, just to a non-specialist.
 * @param {import('./lisa-secure-proxy.js').VQUnit[]} healthy
 * @param {string} workClass
 * @returns {{ unit: object|null, matched: boolean }}
 */
function pickUnitForWork(healthy, workClass) {
  if (!Array.isArray(healthy) || healthy.length === 0) {
    return { unit: null, matched: false };
  }
  const loadOrder = healthy.slice().sort((a, b) => {
    if (b.load !== a.load) return a.load - b.load;
    const la = a.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const lb = b.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
    return la - lb;
  });

  const supporters = loadOrder.filter((u) => unitSupports(u, workClass));
  if (supporters.length > 0) {
    return { unit: supporters[0], matched: true };
  }
  return { unit: loadOrder[0], matched: false };
}

export { classifyWork, pickUnitForWork, unitSupports, WORK_CLASSES };
