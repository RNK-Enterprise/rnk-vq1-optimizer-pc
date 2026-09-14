/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
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
 *
 * Bounded Foundry client telemetry. This collector measures only performance
 * signals; it never reads chat, documents, actors, tokens, or user content.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => Number.isFinite(value) ? value : null;

export class PerformanceTelemetry {
  constructor({ now = () => globalThis.performance?.now?.() ?? Date.now(), windowRef = globalThis } = {}) {
    this.now = now;
    this.windowRef = windowRef;
    this.frames = [];
    this.longTasks = 0;
    this.started = false;
    this.observer = null;
    this.rafId = null;
    this.lastFrameAt = null;
    this.clientId = null;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.clientId = this.clientId || `client-${Math.random().toString(36).slice(2, 10)}`;
    const Observer = this.windowRef.PerformanceObserver;
    if (typeof Observer === 'function') {
      try {
        this.observer = new Observer((list) => {
          this.longTasks += list.getEntries().length;
        });
        this.observer.observe({ entryTypes: ['longtask'] });
      } catch {
        this.observer = null;
      }
    }
    if (typeof this.windowRef.requestAnimationFrame === 'function') {
      try {
        const sample = (timestamp) => {
          if (!this.started) return;
          if (this.lastFrameAt !== null) {
            const delta = clamp(timestamp - this.lastFrameAt, 0, 1000);
            this.frames.push(delta);
            if (this.frames.length > 120) this.frames.shift();
          }
          this.lastFrameAt = timestamp;
          this.rafId = this.windowRef.requestAnimationFrame(sample);
        };
        this.rafId = this.windowRef.requestAnimationFrame(sample);
      } catch {
        this.rafId = null;
      }
    }
    return this;
  }

  stop() {
    this.started = false;
    if (this.rafId !== null && typeof this.windowRef.cancelAnimationFrame === 'function') {
      this.windowRef.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.observer?.disconnect?.();
    this.observer = null;
  }

  _frameMetrics() {
    const values = this.frames.filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return { average: null, low1Percent: null, frameTimeMs: null, varianceMs: null };
    const averageFrame = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sorted = values.slice().sort((a, b) => b - a);
    const lowIndex = Math.max(0, Math.floor(sorted.length * 0.01) - 1);
    const lowFrame = sorted[lowIndex];
    const variance = values.reduce((sum, value) => sum + ((value - averageFrame) ** 2), 0) / values.length;
    return {
      average: finite(1000 / averageFrame),
      low1Percent: finite(1000 / lowFrame),
      frameTimeMs: finite(averageFrame),
      varianceMs: finite(Math.sqrt(variance))
    };
  }

  snapshot() {
    const nav = this.windowRef.navigator || {};
    const memory = this.windowRef.performance?.memory;
    const connection = nav.connection || {};
    const frame = this._frameMetrics();
    const used = finite(memory?.usedJSHeapSize);
    const limit = finite(memory?.jsHeapSizeLimit);
    const canvas = this.windowRef.canvas?.app;
    return {
      clientId: this.clientId,
      capturedAt: new Date().toISOString(),
      fps: frame,
      memory: {
        usedMB: used === null ? null : Math.round(used / 1048576),
        limitMB: limit === null ? null : Math.round(limit / 1048576)
      },
      network: {
        latencyMs: null,
        jitterMs: null,
        effectiveType: connection.effectiveType ?? null,
        saveData: connection.saveData === true
      },
      workload: {
        longTasks: this.longTasks,
        activeEffects: null,
        activeAnimations: null,
        pendingTasks: null,
        tickerFPS: finite(canvas?.ticker?.maxFPS)
      },
      runtime: {
        mobile: Boolean(nav.userAgentData?.mobile || /Android|iPhone|iPad|Mobile/i.test(nav.userAgent || '')),
        cores: finite(nav.hardwareConcurrency),
        deviceMemoryGB: finite(nav.deviceMemory),
        webgpu: typeof nav.gpu?.requestAdapter === 'function',
        wasm: typeof WebAssembly === 'object' && WebAssembly !== null
      }
    };
  }

  resetWindow() {
    this.frames = [];
    this.longTasks = 0;
    this.lastFrameAt = null;
  }
}

export default PerformanceTelemetry;
