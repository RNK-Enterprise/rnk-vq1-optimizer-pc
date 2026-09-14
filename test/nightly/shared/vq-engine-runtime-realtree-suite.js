/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Real-tree VQEngineRuntime suite - runs the runtime contract against an
 * actual stack's src/engines tree (1000+ engine directories). This is the
 * nightly complement to the fixture suite: the fixture suite is hermetic
 * and runs on every commit; this one catches problems only the real tree
 * can reveal (import resolution across engine-internal relative deps,
 * scale behavior of discovery, eviction on real module counts).
 *
 * The stacks' trees legitimately DIFFER (VQ 1 currently has 20 more engine
 * dirs than VQ 2), so this suite asserts invariants - not exact counts:
 *   - discovery scans every dir, loadable count within loose scale bounds
 *   - resolve by name works for a known probe engine
 *   - real invocation of probe engines returns structured results
 *   - unknown engines and unknown methods return structured errors
 *   - pool respects the 64-instance cap while serving many engines
 *
 * Runs only under the nightly config (test/nightly/*.test.js), excluded
 * from the main suite so commits stay fast.
 */

import path from 'path';
import fs from 'fs';

/** Probe engines verified to exist in BOTH stacks with usable methods. */
const PROBE_ENGINES = [
  { dir: 'event-engine-modular', method: 'emit', args: ['nightly.probe', { ok: true }], expectType: 'vq' },
  { dir: 'particle-engine-modular', method: 'createMacro', args: ['nightly-macro', 'test'] }
];

/**
 * Register the real-tree suite for one stack.
 * @param {string} label describe() heading, e.g. 'real tree - VQ 1'
 * @param {string} stackRootAbs absolute path of the stack root
 * @param {() => Promise<{default: *}>} importRuntime loads that stack's runtime
 * @param {object} [opts]
 * @param {number} [opts.minDiscovered] lower bound for discovered dir count
 * @param {number} [opts.minLoadable] lower bound for loadable engines
 */
export function registerRealTreeSuite(label, stackRootAbs, importRuntime, opts = {}) {
  const enginesDir = path.join(stackRootAbs, 'src', 'engines');
  const treePresent = fs.existsSync(enginesDir);

  // Everything below is meaningless without the real tree.
  const maybe = treePresent ? describe : describe.skip;

  maybe(label, () => {
    let RuntimeClass = null;
    let runtime = null;
    let discovery = null;

    beforeAll(async () => {
      ({ default: RuntimeClass } = await importRuntime());
      runtime = new RuntimeClass(stackRootAbs);
      discovery = runtime.discover();
    }, 120000);

    describe('discovery at real scale', () => {
      test('scans the real engine tree', () => {
        const actualDirs = fs.readdirSync(enginesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('_')).length;
        expect(discovery.discovered).toBe(actualDirs);
        if (opts.minDiscovered) expect(discovery.discovered).toBeGreaterThanOrEqual(opts.minDiscovered);
        if (opts.minLoadable) expect(discovery.loadable).toBeGreaterThanOrEqual(opts.minLoadable);
        // Loadable share: most of the tree must be resolvable.
        expect(discovery.loadable).toBeGreaterThan(discovery.discovered * 0.9);
      });

      test('resolves a known probe engine by name', () => {
        const r = runtime.resolve('event-engine-modular');
        expect(r).not.toBeNull();
        expect(r.dirName).toBe('event-engine-modular');
        expect(r.entry.classFile).toBeTruthy();
      });

      test('catalog views paginate the real tree', () => {
        const page = runtime.list({ limit: 50, offset: 0 });
        expect(page.total).toBe(discovery.discovered);
        expect(page.engines).toHaveLength(50);
        const page2 = runtime.list({ limit: 50, offset: 50 });
        expect(page2.engines[0].dirName).not.toBe(page.engines[0].dirName);
      });
    });

    describe('real engine invocation', () => {
      test.each(PROBE_ENGINES)('$dir.$method executes real domain logic', async (probe) => {
        const r = await runtime.invoke(probe.dir, probe.method, probe.args || [], { timeoutMs: 30000 });
        expect(r.ok).toBe(true);
        expect(r.engine).toBe(probe.dir);
        expect(r.method).toBe(probe.method);
        expect(r.elapsedMs).toBeLessThan(30000);
      }, 45000);

      test('repeated invocation hits the pooled instance', async () => {
        const first = await runtime.invoke('event-engine-modular', 'emit', ['nightly.pool', { n: 1 }]);
        expect(first.ok).toBe(true);
        const loadedBefore = runtime.stats.loaded;
        const second = await runtime.invoke('event-engine-modular', 'emit', ['nightly.pool', { n: 2 }]);
        expect(second.ok).toBe(true);
        expect(runtime.stats.loaded).toBe(loadedBefore); // no re-import
        expect(runtime.instances.get('event-engine-modular')).toBeTruthy();
      }, 45000);

      test('unknown engine and unknown method give structured errors', async () => {
        const unknownEngine = await runtime.invoke('definitely-not-an-engine-xyz', 'x');
        expect(unknownEngine.ok).toBe(false);
        expect(unknownEngine.error).toMatch(/Unknown engine/);

        const unknownMethod = await runtime.invoke('event-engine-modular', 'teleport');
        expect(unknownMethod.ok).toBe(false);
        expect(unknownMethod.error).toMatch(/No public method 'teleport'/);
        expect(unknownMethod.methods.length).toBeGreaterThan(0); // real method list
      }, 45000);
    });

    describe('pool behavior at real scale', () => {
      test('serving many engines respects the 64-instance cap', async () => {
        // Invoke a spread of engines across the catalog.
        const names = [...runtime.catalog.keys()]
          .filter((n) => runtime.catalog.get(n).classFile)
          .sort((a, b) => a.localeCompare(b));
        const sample = [];
        for (let i = 0; i < names.length && sample.length < 80; i += Math.max(1, Math.floor(names.length / 80))) {
          sample.push(names[i]);
        }
        const results = await Promise.all(sample.map((n) => runtime.invoke(n, '__vq_nonexistent_method__')));
        // All calls should complete with structured results (method missing
        // is fine - the point is module loading + instantiation + pooling).
        expect(results.every((r) => typeof r.ok === 'boolean')).toBe(true);
        expect(runtime.instances.size).toBeLessThanOrEqual(64);
      }, 180000);
    });
  });
}
