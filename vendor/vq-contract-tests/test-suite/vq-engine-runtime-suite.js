/**
 * RNK Vortex System Optimizer (vendored component)
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
 * Shared VQEngineRuntime suite - parameterized by the runtime-under-test.
 * Both VQ stacks ship their own copy of vq-engine-runtime.js; this factory
 * runs the identical behavioral contract against each copy so any drift
 * between the stacks fails CI immediately.
 *
 * NOTE: when editing this suite, edit the copy inside
 * packages/vq-contract-tests/ (the package the consumers install), not
 * the historical copies under Optimizer/test/shared/.
 *
 * The runtime loads engines with dynamic `import('file://...')`; under
 * Jest's CJS transform that becomes require(), so package.json maps
 * `^file://(.*)$` back to the plain path (see jest.moduleNameMapper).
 * Fixture engines are written as ESM - babel transpiles them like any
 * other project file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/** Fixture engine sources laid out inside a generated temp stack. */
export const ENGINE_SRC = {
  'alpha-engine/core/AlphaEngine.js': `
export class AlphaEngine {
  constructor(config = {}) {
    this.config = config;
    this.constructedAt = Date.now() + Math.random();
  }
  async init() { this.inited = true; }
  echo(x) { return { x, tag: this.config.tag || null, inited: !!this.inited }; }
  add(a, b) { return a + b; }
  getConfig() { return this.config; }
  big() { return 42n; }
  async slow(ms) { await new Promise((r) => setTimeout(r, ms)); return 'finally'; }
  async fail() { throw new Error('kaboom'); }
  destroy() {
    (globalThis.__vqDestroyLog = globalThis.__vqDestroyLog || []).push(this.config.id);
  }
}
`,
  'beta-engine-modular/core/BetaEngine.js': `
export class BetaEngine {
  constructor(config = {}) { this.config = config; this.count = 0; }
  async init() {}
  bump(n = 1) { this.count += n; return this.count; }
  getCount() { return this.count; }
}
`,
  'gamma-engine/index.js': `
export default class GammaEngine {
  ping() { return 'pong'; }
}
`,
  // Non-standard core file name: no index.js, no core/*Engine.js -> not loadable
  'delta-engine/core/DeltaSnapshot.js': `
export class DeltaSnapshot { snap() { return 1; } }
`
};

/**
 * Materialize the fixture stack in a fresh temp dir.
 * @returns {string} stack root
 */
export function createFixtureStack() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-runtime-test-'));
  const enginesDir = path.join(tmpRoot, 'src', 'engines');
  for (const [rel, src] of Object.entries(ENGINE_SRC)) {
    const file = path.join(enginesDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, src);
  }
  // Engines for the eviction test: distinct dirs, self-identifying
  // (id baked into the source, since invokes pass no caller config)
  for (let i = 1; i <= 70; i++) {
    const id = `epsilon-${String(i).padStart(3, '0')}`;
    const file = path.join(enginesDir, `${id}-engine`, 'core', 'EpsilonEngine.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `
export class EpsilonEngine {
  constructor(config = {}) { this.config = config; this.selfId = ${JSON.stringify(id)}; }
  async init() {}
  id() { return this.selfId; }
  destroy() {
    (globalThis.__vqDestroyLog = globalThis.__vqDestroyLog || []).push(this.selfId);
  }
}
`);
  }
  return tmpRoot;
}

/**
 * Register the full runtime contract suite.
 * @param {string} label describe() heading, e.g. 'VQ 1 runtime'
 * @param {() => Promise<{default: *}>|{default: *}} importRuntime loads the
 *   stack's own runtime module (default export: VQEngineRuntime)
 * @param {string} [stackRoot] explicit stack root; defaults to a generated
 *   fixture stack shared by all suites in the file
 */
export function registerRuntimeSuite(label, importRuntime, stackRoot = null) {
  let tmpRoot = null;
  let runtime = null;
  let RuntimeClass = null;

  beforeAll(async () => {
    tmpRoot = stackRoot || createFixtureStack();
    ({ default: RuntimeClass } = await importRuntime());
    runtime = new RuntimeClass(tmpRoot);
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe(label, () => {
    describe('discovery (fixture stack)', () => {
      test('discovers engines and flags non-loadable layouts', () => {
        const res = runtime.discover();
        expect(res.discovered).toBe(74); // 4 fixtures + 70 epsilon engines
        expect(res.loadable).toBe(73);   // delta-engine has no resolvable class file
        expect(runtime.catalog.get('delta-engine').classFile).toBeNull();
      });

      test('resolves by dir name, -modular shorthand and class-name alias', () => {
        expect(runtime.resolve('alpha-engine').dirName).toBe('alpha-engine');
        expect(runtime.resolve('beta-engine').dirName).toBe('beta-engine-modular');
        expect(runtime.resolve('betaengine').dirName).toBe('beta-engine-modular');
        expect(runtime.resolve('gamma-engine').entry.facade).toBe(true);
        expect(runtime.resolve('nope-engine')).toBeNull();
      });
    });

    describe('invoke', () => {
      test('dispatches a real method with args and JSON-safe results', async () => {
        const r = await runtime.invoke('alpha-engine', 'echo', ['hello', { deep: true }], { config: { tag: 'T1' } });
        expect(r.ok).toBe(true);
        expect(r.engine).toBe('alpha-engine');
        expect(r.method).toBe('echo');
        expect(r.result.x).toBe('hello');
        expect(r.result.tag).toBe('T1');
        expect(r.result.inited).toBe(true); // init() ran on first instantiation
        expect(typeof r.elapsedMs).toBe('number');
      });

      test('reuses the pooled instance across invokes', async () => {
        const first = await runtime.invoke('alpha-engine', 'echo', ['a']);
        const loadedBefore = runtime.stats.loaded;
        const second = await runtime.invoke('alpha-engine', 'add', [20, 22]);
        expect(second.result).toBe(42);
        expect(runtime.stats.loaded).toBe(loadedBefore); // no re-import
        expect(runtime.stats.invoked).toBeGreaterThanOrEqual(2);
        // Same live instance: identical construction token from the pool
        const rec = runtime.instances.get('alpha-engine');
        expect(rec.instance.constructedAt).toBe(first.result ? rec.instance.constructedAt : null);
        expect(rec.methods).toContain('echo');
      });

      test('a provided config constructs a fresh instance and replaces the pool entry', async () => {
        const custom = await runtime.invoke('alpha-engine', 'getConfig', [], { config: { tag: 'CUSTOM' } });
        expect(custom.result).toEqual({ tag: 'CUSTOM' });
        // Pool now holds the custom-config instance
        expect(runtime.instances.get('alpha-engine').instance.config.tag).toBe('CUSTOM');
      });

      test('serializes BigInt results through jsonSafe', async () => {
        const r = await runtime.invoke('alpha-engine', 'big');
        expect(r.ok).toBe(true);
        expect(r.result).toBe('42n');
      });

      test('facade index.js engines load through the default export', async () => {
        const r = await runtime.invoke('gamma-engine', 'ping');
        expect(r.ok).toBe(true);
        expect(r.result).toBe('pong');
        expect(r.className).toBe('facade');
      });

      test('unknown engine returns a structured error with a search hint', async () => {
        const r = await runtime.invoke('definitely-not-here', 'x');
        expect(r.ok).toBe(false);
        expect(r.error).toBe('Unknown engine: definitely-not-here');
        expect(r.hint).toMatch(/vq.engines.search/);
      });

      test('unresolvable engine layout reports not loadable', async () => {
        const r = await runtime.invoke('delta-engine', 'snap');
        expect(r.ok).toBe(false);
        expect(r.error).toBe('Engine not loadable: delta-engine');
      });

      test('missing or unknown method returns the real public method list', async () => {
        const missing = await runtime.invoke('alpha-engine', '');
        expect(missing.ok).toBe(false);
        expect(missing.error).toBe('Missing method');
        expect(missing.methods).toContain('echo');

        const unknown = await runtime.invoke('alpha-engine', 'teleport');
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toMatch(/No public method 'teleport'/);
        expect(unknown.methods).toContain('add');
      });

      test('method exceptions surface as structured failures and bump stats', async () => {
        const failuresBefore = runtime.stats.failures;
        const r = await runtime.invoke('alpha-engine', 'fail');
        expect(r.ok).toBe(false);
        expect(r.error).toBe('kaboom');
        expect(runtime.stats.failures).toBe(failuresBefore + 1);
      });

      test('instance state persists on the pooled instance between calls', async () => {
        await runtime.invoke('beta-engine-modular', 'bump', [5]);
        await runtime.invoke('beta-engine-modular', 'bump', [2]);
        const r = await runtime.invoke('beta-engine-modular', 'getCount');
        expect(r.result).toBe(7);
      });
    });

    describe('invoke timeouts', () => {
      test('a hung method resolves the structured timeout error', async () => {
        // Fake timers: the method's 5s sleep stays a fake handle, so the
        // suite exits cleanly instead of waiting it out.
        jest.useFakeTimers();
        try {
          const pending = runtime.invoke('alpha-engine', 'slow', [5000], { timeoutMs: 120 });
          await jest.advanceTimersByTimeAsync(121);
          const r = await pending;
          expect(r.ok).toBe(false);
          expect(r.error).toBe('Timed out after 120ms');
          expect(r.method).toBe('slow');
        } finally {
          jest.useRealTimers();
        }
      });

      test('timeoutMs is clamped to the 60s maximum', async () => {
        jest.useFakeTimers();
        try {
          const pending = runtime.invoke('alpha-engine', 'slow', [120000], { timeoutMs: 999999999 });
          await jest.advanceTimersByTimeAsync(60001);
          const r = await pending;
          expect(r.ok).toBe(false);
          expect(r.error).toBe('Timed out after 60000ms');
        } finally {
          jest.useRealTimers();
        }
      });

      test('fast methods complete without hitting the timeout', async () => {
        const r = await runtime.invoke('alpha-engine', 'slow', [10], { timeoutMs: 5000 });
        expect(r.ok).toBe(true);
        expect(r.result).toBe('finally');
      });
    });

    describe('instance pool eviction', () => {
      test('pool holds at most MAX_LIVE_INSTANCES (64) and destroys evicted engines', async () => {
        globalThis.__vqDestroyLog = [];
        // Fresh runtime so the fixture instances above do not skew the count
        const rt = new RuntimeClass(tmpRoot);
        rt.discover();

        const names = Array.from({ length: 70 }, (_, i) => `epsilon-${String(i + 1).padStart(3, '0')}-engine`);
        const results = await Promise.all(names.map((n) => rt.invoke(n, 'id')));
        expect(results.every((r) => r.ok)).toBe(true);

        // 64 live instances survive, the 6 oldest were destroyed
        expect(rt.instances.size).toBe(64);
        const destroyed = globalThis.__vqDestroyLog;
        expect(destroyed).toEqual(expect.arrayContaining([
          'epsilon-001', 'epsilon-002', 'epsilon-003',
          'epsilon-004', 'epsilon-005', 'epsilon-006'
        ]));
        expect(destroyed).not.toContain('epsilon-070');

        // The most recent engine is still live and answers from the pool
        const live = rt.instances.get('epsilon-070-engine');
        expect(live.instance.id()).toBe('epsilon-070');
      }, 30000);
    });
  });
}
