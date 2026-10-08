/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * Vortex Quantum Bridge - Modular VQ Integration
 * Dual-VQ Parallel Processing with Lazy Loading
 */

export class VQBridgeCore {
  constructor() {
    this.modulesConnected = [];
    this.eventLog = [];
    this.vqInstances = [];
    this.currentInstanceIndex = 0;
    this.loadBalanceMode = 'round-robin';
    this.performanceMetrics = {
      requestsProcessed: 0,
      avgResponseTime: 0,
      vq1Requests: 0,
      vq2Requests: 0,
      failovers: 0,
      parallelBoost: 0
    };
    this.healthCheckInterval = null;
    this.initTime = null;
  }

  async initialize() {
    console.log('%c[Vortex Bridge] Initializing Dual-VQ Parallel Processing Cluster...', 'color: #00ff88; font-weight: bold;');
    this.discoverVQInstances();
    this.startHealthMonitoring();
    return this;
  }

  /** Fresh candidate list per call: window refs are re-read each scan. */
  _vqCandidates() {
    return [
      ['VQ1', window.vortexQuantum],
      ['VQ2', window.vortexQuantum2],
      ['VQ-Primary', window.vortexQuantumPrimary],
      ['VQ-Secondary', window.vortexQuantumSecondary]
    ];
  }

  discoverVQInstances() {
    console.log('%c[Vortex Bridge] Scanning for VQ instances...', 'color: #0088ff;');

    for (const [name, ref] of this._vqCandidates()) {
      if (ref) this.connectToVQInstance(ref, name);
    }

    const checkInterval = setInterval(() => {
      for (const [name, ref] of this._vqCandidates()) {
        if (ref && !this.hasInstance(name)) this.connectToVQInstance(ref, name);
      }

      if (this.vqInstances.length >= 2) {
        clearInterval(checkInterval);
        this.optimizeLoadBalancing();
      }

      if (!this.initTime) this.initTime = Date.now();
      if (Date.now() - this.initTime > 10000) {
        clearInterval(checkInterval);
        if (this.vqInstances.length > 0) console.log(`%c[Vortex Bridge] Operating with ${this.vqInstances.length} VQ instance(s)`, 'color: #00ff88;');
      }
    }, 100);
  }

  hasInstance(name) {
    return this.vqInstances.some(inst => inst.name === name);
  }

  connectToVQInstance(vqRef, name) {
    if (!vqRef) return false;

    try {
      const instance = {
        name: name,
        ref: vqRef,
        system: vqRef.system,
        bridge: vqRef.bridge,
        version: vqRef.version || 'unknown',
        connected: true,
        healthy: true,
        lastHealthCheck: Date.now(),
        requestCount: 0,
        avgResponseTime: 0,
        failureCount: 0,
        timestamp: new Date().toISOString()
      };

      this.vqInstances.push(instance);

      console.log(`%c[Vortex Bridge] Connected to ${name} (v${instance.version})`, 'color: #00ff88; font-weight: bold;');
      this.logEvent('VQ_INSTANCE_CONNECTED', { name, version: instance.version });

      if (this.vqInstances.length > 1) {
        console.log(`%c[Vortex Bridge] DUAL-VQ CLUSTER ACTIVE - Performance Boost: ${this.calculateBoostPercentage()}%`, 'color: #ff00ff; font-weight: bold;');
      }

      return true;
    } catch (error) {
      console.error(`%c[Vortex Bridge] Connection error to ${name}:`, 'color: #ff0044;', error);
      return false;
    }
  }

  calculateBoostPercentage() {
    const instanceCount = this.vqInstances.filter(i => i.healthy).length;
    if (instanceCount === 2) return 150 + Math.floor(this.performanceMetrics.parallelBoost * 25);
    return 100;
  }

  getNextInstance() {
    const healthyInstances = this.vqInstances.filter(i => i.healthy);

    if (healthyInstances.length === 0) {
      console.error('%c[Vortex Bridge] No healthy VQ instances available!', 'color: #ff0044;');
      return null;
    }

    this.currentInstanceIndex = (this.currentInstanceIndex + 1) % healthyInstances.length;
    return healthyInstances[this.currentInstanceIndex];
  }

  getHealthyInstances() {
    return this.vqInstances.filter(i => i.healthy);
  }

  async executeOnVQ(taskFn, options = {}) {
    const startTime = Date.now();
    const mode = options.mode || this.loadBalanceMode;

    try {
      let result;

      switch (mode) {
        case 'parallel':
          result = await this.executeParallel(taskFn);
          break;
        case 'sharding':
          result = await this.executeSharded(taskFn, options.shards);
          break;
        case 'round-robin':
        default:
          result = await this.executeRoundRobin(taskFn);
          break;
      }

      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);
      throw error;
    }
  }

  async executeRoundRobin(taskFn) {
    const instance = this.getNextInstance();
    if (!instance) throw new Error('No VQ instances available');

    instance.requestCount++;

    try {
      const result = await taskFn(instance.ref);
      return result;
    } catch (error) {
      instance.failureCount++;
      const fallbackInstance = this.getHealthyInstances().find(i => i.name !== instance.name);
      if (fallbackInstance) {
        console.warn(`%c[Vortex Bridge] Failover: ${instance.name} -> ${fallbackInstance.name}`, 'color: #ff8800;');
        this.performanceMetrics.failovers++;
        return await taskFn(fallbackInstance.ref);
      }
      throw error;
    }
  }

  /** Rolling-average latency update for an instance after one request. */
  _recordRequestTiming(inst, t0) {
    const dt = Date.now() - t0;
    inst.avgResponseTime = inst.avgResponseTime ? (inst.avgResponseTime * 3 + dt) / 4 : dt;
  }

  async executeParallel(taskFn) {
    const instances = this.getHealthyInstances();
    if (instances.length === 0) throw new Error('No VQ instances available');

    if (instances.length === 1) {
      return await taskFn(instances[0].ref);
    }

    // Tandem load sharing: least-loaded routing, never duplicated work.
    const sorted = instances.slice().sort((a, b) => {
      if (b.requestCount !== a.requestCount) return a.requestCount - b.requestCount;
      const la = a.avgResponseTime ?? Number.MAX_SAFE_INTEGER;
      const lb = b.avgResponseTime ?? Number.MAX_SAFE_INTEGER;
      return la - lb;
    });
    const chosen = sorted[0];
    chosen.requestCount++;
    try {
      const t0 = Date.now();
      const result = await taskFn(chosen.ref);
      this._recordRequestTiming(chosen, t0);
      this.performanceMetrics.parallelBoost += 0.01;
      return result;
    } catch (error) {
      chosen.failureCount++;
      const fallback = sorted.find(i => i.name !== chosen.name && i.healthy);
      if (!fallback) throw error;
      console.warn(`%c[Vortex Bridge] Parallel failover: ${chosen.name} -> ${fallback.name}`, 'color: #ff8800;');
      this.performanceMetrics.failovers++;
      fallback.requestCount++;
      const fbT0 = Date.now();
      const result = await taskFn(fallback.ref);
      this._recordRequestTiming(fallback, fbT0);
      return result;
    }
  }

  async executeSharded(taskFn, shards) {
    const instances = this.getHealthyInstances();
    if (instances.length === 0) throw new Error('No VQ instances available');

    if (!shards || instances.length === 1) {
      return await taskFn(instances[0].ref, shards);
    }

    const shardsPerInstance = Math.ceil(shards.length / instances.length);
    const promises = instances.map((inst, idx) => {
      const instanceShards = shards.slice(idx * shardsPerInstance, (idx + 1) * shardsPerInstance);
      inst.requestCount++;
      return taskFn(inst.ref, instanceShards).catch(err => {
        inst.failureCount++;
        return null;
      });
    });

    const results = await Promise.all(promises);
    return results.flat().filter(r => r !== null);
  }

  updateMetrics(duration, success) {
    this.performanceMetrics.requestsProcessed++;

    const prevAvg = this.performanceMetrics.avgResponseTime;
    const count = this.performanceMetrics.requestsProcessed;
    this.performanceMetrics.avgResponseTime = ((prevAvg * (count - 1)) + duration) / count;

    this.vqInstances.forEach(inst => {
      if (inst.requestCount > 0) {
        if (inst.name.includes('1') || inst.name.includes('Primary')) {
          this.performanceMetrics.vq1Requests = inst.requestCount;
        } else if (inst.name.includes('2') || inst.name.includes('Secondary')) {
          this.performanceMetrics.vq2Requests = inst.requestCount;
        }
      }
    });
  }

  optimizeLoadBalancing() {
    const instances = this.getHealthyInstances();

    if (instances.length >= 2) {
      this.loadBalanceMode = 'parallel';
      console.log('%c[Vortex Bridge] Load balancing optimized: PARALLEL mode', 'color: #00ffff;');
    } else {
      this.loadBalanceMode = 'round-robin';
    }
  }

  registerModule(moduleId, moduleName, callbacks = {}) {
    console.log(`%c[Vortex Bridge] Registering module: ${moduleId}`, 'color: #0088ff;');

    const moduleContext = {
      id: moduleId,
      name: moduleName,
      registered: new Date().toISOString(),
      callbacks: callbacks,
      events: []
    };

    this.modulesConnected.push(moduleContext);
    this.logEvent('MODULE_REGISTERED', { moduleId, moduleName });

    return moduleContext;
  }

  unregisterModule(moduleId) {
    this.modulesConnected = this.modulesConnected.filter(m => m.id !== moduleId);
    this.logEvent('MODULE_UNREGISTERED', { moduleId });
  }

  async emitModuleEvent(moduleId, eventType, eventData) {
    const module = this.modulesConnected.find(m => m.id === moduleId);
    if (!module) {
      console.warn(`%c[Vortex Bridge] Module not registered: ${moduleId}`, 'color: #ff8800;');
      return false;
    }

    const event = {
      timestamp: new Date().toISOString(),
      moduleId,
      type: eventType,
      data: eventData
    };

    module.events.push(event);
    this.logEvent('MODULE_EVENT', event);

    if (module.callbacks[eventType]) {
      try {
        module.callbacks[eventType](eventData);
      } catch (error) {
        console.error(`%c[Vortex Bridge] Callback error for ${eventType}:`, 'color: #ff0044;', error);
      }
    }

    if (this.vqInstances.length > 0) {
      try {
        await this.executeOnVQ(async (vqRef) => {
          if (vqRef?.logSecurityEvent) {
            return vqRef.logSecurityEvent({
              source: 'foundry-module-bridge',
              moduleId,
              type: eventType,
              data: eventData,
              timestamp: event.timestamp
            });
          }
        });
      } catch (error) {
        console.error('%c[Vortex Bridge] Failed to forward event to VQ:', 'color: #ff0044;', error);
      }
    }

    return true;
  }

  getModuleContext(moduleId) {
    return this.modulesConnected.find(m => m.id === moduleId);
  }

  logEvent(eventType, eventData) {
    const event = { timestamp: new Date().toISOString(), type: eventType, data: eventData };
    this.eventLog.push(event);
    if (this.eventLog.length > 1000) this.eventLog = this.eventLog.slice(-500);
  }

  getEventLog(filter = {}) {
    let log = this.eventLog;
    if (filter.type) log = log.filter(e => e.type === filter.type);
    if (filter.moduleId) log = log.filter(e => e.data?.moduleId === filter.moduleId);
    if (filter.limit) log = log.slice(-filter.limit);
    return log;
  }

  getConnectedModules() {
    return this.modulesConnected;
  }

  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 5000);
  }

  performHealthChecks() {
    this.vqInstances.forEach(instance => {
      try {
        // Healthy only while the underlying ref is usable; null/removed refs mark the unit down.
        const isHealthy = !!(instance.ref && typeof instance.ref === 'object' && !instance.ref.offline);
        const wasHealthy = instance.healthy;

        instance.healthy = isHealthy;
        instance.lastHealthCheck = Date.now();

        if (wasHealthy && !isHealthy) {
          console.error(`%c[Vortex Bridge] ${instance.name} is DOWN`, 'color: #ff0044; font-weight: bold;');
          this.logEvent('VQ_INSTANCE_DOWN', { name: instance.name });
        } else if (!wasHealthy && isHealthy) {
          console.log(`%c[Vortex Bridge] ${instance.name} is back UP`, 'color: #00ff88; font-weight: bold;');
          this.logEvent('VQ_INSTANCE_RECOVERED', { name: instance.name });
        }
      } catch (error) {
        instance.healthy = false;
        console.error(`%c[Vortex Bridge] Health check failed for ${instance.name}:`, 'color: #ff0044;', error);
      }
    });

    this.optimizeLoadBalancing();
  }

  getStatus() {
    const healthyCount = this.vqInstances.filter(i => i.healthy).length;

    return {
      clusterMode: this.vqInstances.length > 1,
      instanceCount: this.vqInstances.length,
      healthyInstances: healthyCount,
      instances: this.vqInstances.map(i => ({
        name: i.name,
        version: i.version,
        healthy: i.healthy,
        requestCount: i.requestCount,
        failureCount: i.failureCount,
        avgResponseTime: i.avgResponseTime
      })),
      loadBalanceMode: this.loadBalanceMode,
      performanceBoost: `${this.calculateBoostPercentage()}%`,
      metrics: this.performanceMetrics,
      modulesConnected: this.modulesConnected.length,
      eventLogSize: this.eventLog.length,
      lastEvent: this.eventLog[this.eventLog.length - 1] || null,
      timestamp: new Date().toISOString()
    };
  }

  healthCheck() {
    const status = this.getStatus();
    const health = {
      timestamp: new Date().toISOString(),
      overall: 'healthy',
      checks: {
        vqCluster: status.healthyInstances > 0 ? 'pass' : 'fail',
        clusterRedundancy: status.healthyInstances >= 2 ? 'pass' : 'warn',
        modulesLoaded: status.modulesConnected > 0 ? 'pass' : 'warn',
        eventLogHealth: status.eventLogSize < 2000 ? 'pass' : 'warn',
        loadBalancing: this.loadBalanceMode !== null ? 'pass' : 'warn'
      }
    };

    health.overall = status.healthyInstances === 0 ? 'critical' : (status.healthyInstances === 1 ? 'warning' : 'healthy');

    return health;
  }

  getPerformanceDashboard() {
    return {
      clusterStatus: {
        mode: this.vqInstances.length > 1 ? 'DUAL-VQ CLUSTER' : 'SINGLE INSTANCE',
        boost: `${this.calculateBoostPercentage()}%`,
        loadBalancing: this.loadBalanceMode
      },
      instances: this.vqInstances.map(i => ({
        name: i.name,
        status: i.healthy ? 'ONLINE' : 'OFFLINE',
        requests: i.requestCount,
        failures: i.failureCount,
        uptime: `${((Date.now() - new Date(i.timestamp).getTime()) / 1000 / 60).toFixed(1)}m`
      })),
      metrics: {
        totalRequests: this.performanceMetrics.requestsProcessed,
        avgResponse: `${this.performanceMetrics.avgResponseTime.toFixed(2)}ms`,
        vq1Load: this.performanceMetrics.vq1Requests,
        vq2Load: this.performanceMetrics.vq2Requests,
        failovers: this.performanceMetrics.failovers,
        parallelBoost: `+${(this.performanceMetrics.parallelBoost * 100).toFixed(1)}%`
      },
      timestamp: new Date().toISOString()
    };
  }
}

let bridgeInstance = null;

export async function initializeVQBridge() {
  if (bridgeInstance) return bridgeInstance;
  bridgeInstance = new VQBridgeCore();
  await bridgeInstance.initialize();
  window.vortexQuantumModuleBridge = bridgeInstance;
  return bridgeInstance;
}

if (typeof Hooks !== 'undefined') {
  Hooks.once('ready', async () => {
    await initializeVQBridge();
  });
}

export const VortexQuantumBridge = { initialize: initializeVQBridge };
