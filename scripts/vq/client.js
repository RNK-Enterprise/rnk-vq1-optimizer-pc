/**
 * Vortex Quantum - Host-Neutral Optimizer Client Core
 *
 * Thin client per TANDEM_OPTIMIZER_ARCHITECTURE.md:
 *   1. Detects platform and capabilities (host adapter supplies environment)
 *   2. Collects bounded, consent-aware metrics
 *   3. Requests a plan from the server (data, never code)
 *   4. Applies only allow-listed, bounds-checked local actions
 *   5. Reports results over the shared event contract
 *
 * The core never touches the DOM or native APIs directly. The PC browser host
 * implements the HostAdapter boundary.
 *
 * @module optimizer/client
 * @version 1
 */

import {
  PROTOCOL_VERSION,
  validatePlan,
  validateAction,
  DEFAULT_LIMITS
} from './protocol.js';

export class OptimizerClient {
  /**
   * @param {Object} host - Host adapter (see README in this folder)
   * @param {Object} [options]
   */
  constructor(host, options = {}) {
    if (!host || typeof host !== 'object') {
      throw new TypeError('OptimizerClient requires a host adapter');
    }
    const required = ['getEnvironment', 'applyAction'];
    for (const fn of required) {
      if (typeof host[fn] !== 'function') {
        throw new TypeError(`Host adapter missing required method: ${fn}()`);
      }
    }

    this.host = host;
    this.options = {
      serverUrl: options.serverUrl || null,
      fetchFn: options.fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      limits: { ...DEFAULT_LIMITS, ...(options.limits || {}) },
      maxMetricsBytes: options.maxMetricsBytes || 8192,
      timeoutMs: options.timeoutMs || 6000
    };

    this._state = {
      lastPlan: null,
      lastReport: null,
      consent: options.consent !== false,
      busy: false
    };
  }

  /** Events (optional host adapter method). */
  _emit(event, data) {
    try {
      if (typeof this.host.emit === 'function') this.host.emit(event, data);
    } catch {
      /* listener errors must never break the optimizer */
    }
  }

  /**
   * Full optimization cycle: metrics -> plan -> apply -> report.
   * Safe local mode: when the server is unreachable, only local heuristic
   * actions are applied and the cycle still succeeds.
   */
  async run({ useServer = true } = {}) {
    if (this._state.busy) throw new Error('Optimizer cycle already running');
    this._state.busy = true;

    try {
      const environment = await this.host.getEnvironment();
      const metrics = this._collectMetrics(environment);

      let plan = null;
      let source = 'local';

      if (useServer && this.options.serverUrl && this.options.fetchFn) {
        try {
          plan = await this._requestPlan(metrics, environment);
          source = 'server';
        } catch (error) {
          this._emit('server-unavailable', { reason: error.message });
          plan = this._localFallbackPlan(environment);
        }
      } else {
        plan = this._localFallbackPlan(environment);
      }

      const applied = await this._applyPlan(plan, environment);
      const report = {
        protocolVersion: PROTOCOL_VERSION,
        platform: environment.platform?.host || environment.platform?.type || 'unknown',
        source,
        applied,
        skipped: plan.actions.length - applied.length,
        at: Date.now()
      };

      this._state.lastPlan = plan;
      this._state.lastReport = report;
      this._emit('cycle-complete', report);
      return report;
    } finally {
      this._state.busy = false;
    }
  }

  /**
   * Bounded, consent-aware metric collection. Raw environment data is never
   * sent raw; only an allow-listed projection, within the size bound.
   */
  _collectMetrics(environment) {
    if (!this._state.consent) return {};

    const p = environment.platform || {};
    const h = environment.hardware || {};
    const n = environment.network || {};

    const metrics = {
      platform: {
        host: p.host || p.type || 'unknown',
        mobile: p.mobile === true
      },
      hardware: {
        cores: typeof h.cpu?.cores === 'number' ? h.cpu.cores : null,
        memoryGB: h.memory?.total ? Math.round(h.memory.total / (1024 ** 3)) : null,
        onBattery: h.battery ? h.battery.charging === false : null
      },
      network: {
        effectiveType: n.effectiveType || null,
        saveData: n.saveData === true
      },
      capabilities: {
        wasm: environment.capabilities?.wasm === true,
        webgl: environment.capabilities?.webgl || null,
        webgpu: environment.capabilities?.webgpu === true
      }
    };

    const serialized = JSON.stringify(metrics);
    if (serialized.length > this.options.maxMetricsBytes) {
      return { truncated: true };
    }
    return metrics;
  }

  /**
   * Ask the server for a plan. Enforces protocol version on the response.
   */
  async _requestPlan(metrics, environment) {
    const body = {
      protocolVersion: PROTOCOL_VERSION,
      // Platform identity comes from the environment (needed to route the
      // plan); it is not part of consent-gated telemetry.
      platform: environment.platform?.host || environment.platform?.type || 'unknown',
      runtime: environment.runtime || undefined,
      capabilities: metrics.capabilities,
      metrics: {
        hardware: metrics.hardware,
        network: metrics.network
      },
      requestedOptimizations: []
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let res;
    try {
      res = await this.options.fetchFn(this.options.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res?.ok) {
      throw new Error(`Plan request failed: HTTP ${res?.status || 'unknown'}`);
    }

    const data = await res.json();
    if (!data?.success || !data.plan) {
      throw new Error(data?.error || 'Plan response missing plan payload');
    }

    // Structural + protocol-version validation happens here; per-action
    // bounds validation happens in _applyPlan so one bad action from the
    // server only skips itself instead of discarding the whole plan.
    this._validatePlanStructure(data.plan);
    const plan = data.plan;
    if (plan.expiresAt && Date.now() > Date.parse(plan.expiresAt)) {
      throw new Error('Plan expired');
    }
    return plan;
  }

  /**
   * Structural validation of a server plan: shape + protocol version.
   * Action-level checks are deferred to _applyPlan (per-action skip).
   */
  _validatePlanStructure(plan) {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.actions)) {
      throw new Error('Server plan must be an object with an actions array');
    }
    if (plan.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Server plan protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${plan.protocolVersion}`);
    }
  }

  /**
   * Local heuristic plan used in safe mode (no server / server down).
   * Still runs through the same allow-list validation.
   */
  _localFallbackPlan(environment) {
    const actions = [];
    const caps = environment.capabilities || {};
    const net = environment.network || {};

    if (net.saveData === true) {
      actions.push({ type: 'set-cache-size', key: 'cache.size', value: 512 });
    }
    if (environment.platform?.mobile === true && caps.webgpu !== true) {
      actions.push({ type: 'set-runtime-variant', key: 'lite' });
    }
    if (caps.wasm !== true) {
      actions.push({ type: 'disable-component', key: 'wasm-particle-effects' });
    }

    return validatePlan(
      { protocolVersion: PROTOCOL_VERSION, planId: 'local-safe-mode', actions },
      this.options.limits
    );
  }

  /**
   * Apply a plan. Every action is re-validated against local limits before
   * execution; a single invalid action skips only itself.
   */
  async _applyPlan(plan, environment) {
    const applied = [];
    for (const action of plan.actions) {
      let validated;
      try {
        validated = validateAction(action, this.options.limits);
      } catch (error) {
        this._emit('action-rejected', { action, reason: error.message });
        continue;
      }

      try {
        await this.host.applyAction(validated, environment);
        applied.push(validated);
        this._emit('action-applied', { action: validated });
      } catch (error) {
        this._emit('action-failed', { action: validated, reason: error.message });
      }
    }
    return applied;
  }

  /** Last completed report (or null). */
  getLastReport() {
    return this._state.lastReport;
  }

  /** Last accepted plan (or null). */
  getLastPlan() {
    return this._state.lastPlan;
  }

  /** Enable/disable telemetry + local heuristics. */
  setConsent(enabled) {
    this._state.consent = enabled === true;
  }

  /** True while a cycle is in flight. */
  isBusy() {
    return this._state.busy;
  }
}

export default OptimizerClient;
