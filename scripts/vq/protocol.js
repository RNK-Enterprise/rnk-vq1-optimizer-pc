/**
 * Vortex Quantum - Shared Optimizer Protocol
 * Single source of truth for the client/server optimizer contract.
 *
 * The PC browser and native surfaces import these constants so the allow-list,
 * limits, and protocol version cannot drift.
 *
 * @module _meta/protocol
 * @version 1
 */

export const PROTOCOL_VERSION = 1;

/**
 * Actions a server plan may request. Anything outside this set is rejected
 * on both sides. The client never executes arbitrary server instructions.
 */
export const ALLOWED_ACTIONS = [
  'set-quality',
  'set-cache-size',
  'set-batch-size',
  'set-runtime-variant',
  'enable-component',
  'disable-component',
  'set-fps-cap',
  'set-effect-budget',
  'set-animation-budget',
  'set-network-batch'
];

/**
 * Action types whose `key`+`value` must fall inside a bounded range.
 */
export const BOUNDED_ACTIONS = [
  'set-quality',
  'set-cache-size',
  'set-batch-size',
  'set-fps-cap',
  'set-effect-budget',
  'set-animation-budget',
  'set-network-batch'
];

/**
 * Action types that address a component/variant by string key only.
 */
export const KEYED_ACTIONS = ['set-runtime-variant', 'enable-component', 'disable-component'];

/**
 * Default numeric bounds per bounded key. Hosts may extend, never loosen.
 */
export const DEFAULT_LIMITS = {
  'render.distance': { min: 2, max: 32 },
  'render.resolution': { min: 0.5, max: 2 },
  'effects.budget': { min: 0, max: 100 },
  'animation.budget': { min: 0, max: 100 },
  'cache.size': { min: 0, max: 4096 },
  'batch.size': { min: 1, max: 256 },
  'fps.cap': { min: 15, max: 240 },
  'network.batch': { min: 1, max: 128 }
};

/**
 * Runtime variants understood by the quantum loader.
 */
export const RUNTIME_VARIANTS = ['lite', 'standard', 'wasm', 'server'];

/**
 * Host platforms covered by the PC browser surface.
 */
export const PLATFORMS = ['pc'];

/**
 * Structural + semantic validation of one plan action. Shared by the server
 * (when composing plans) and the client (before applying anything).
 *
 * @param {Object} action - Candidate action
 * @param {Object} [limits] - Bounds for bounded actions (defaults to DEFAULT_LIMITS)
 * @returns {Object} A shallow copy of the validated action
 * @throws {TypeError|RangeError|Error} When the action violates the contract
 */
export function validateAction(action, limits = DEFAULT_LIMITS) {
  if (!action || typeof action !== 'object') {
    throw new TypeError('Optimizer action must be an object');
  }
  if (!ALLOWED_ACTIONS.includes(action.type)) {
    throw new Error(`Unsupported optimizer action: ${action.type || 'unknown'}`);
  }

  if (BOUNDED_ACTIONS.includes(action.type)) {
    if (typeof action.key !== 'string' || action.key.length === 0) {
      throw new TypeError(`Bounded action requires a string key: ${action.type}`);
    }
    if (typeof action.value !== 'number' || !Number.isFinite(action.value)) {
      throw new TypeError(`Bounded action requires a finite numeric value: ${action.type}`);
    }
    const limit = limits[action.key];
    if (!limit) {
      throw new Error(`No limits defined for optimizer key: ${action.key}`);
    }
    if (action.value < limit.min || action.value > limit.max) {
      throw new RangeError(
        `Optimizer value ${action.value} is outside limits for ${action.key} (${limit.min}-${limit.max})`
      );
    }
  }

  if (KEYED_ACTIONS.includes(action.type)) {
    if (typeof action.key !== 'string' || action.key.length === 0) {
      throw new TypeError(`Optimizer action requires a string key: ${action.type}`);
    }
    if (action.type === 'set-runtime-variant' && !RUNTIME_VARIANTS.includes(action.key)) {
      throw new Error(`Unknown runtime variant: ${action.key}`);
    }
  }

  return { ...action };
}

/**
 * Structural validation of a full plan. Returns a normalized copy.
 *
 * @param {Object} plan - Candidate plan
 * @param {Object} [limits] - Bounds for bounded actions
 * @returns {Object} Normalized plan with protocolVersion and validated actions
 * @throws When the plan violates the contract
 */
export function validatePlan(plan, limits = DEFAULT_LIMITS) {
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('Optimization plan must be an object');
  }
  if (!Array.isArray(plan.actions)) {
    throw new TypeError('Optimization plan must contain an actions array');
  }

  const version = typeof plan.protocolVersion === 'number' ? plan.protocolVersion : PROTOCOL_VERSION;
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Plan protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${version}`);
  }

  return {
    ...plan,
    protocolVersion: version,
    actions: plan.actions.map((action) => validateAction(action, limits))
  };
}
