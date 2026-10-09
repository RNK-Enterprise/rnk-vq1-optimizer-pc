/**
 * Native file placement policy tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyPlacementPolicy, FILE_PLACEMENT_POLICY_VERSION, previewPlacementPolicy as buildPlacementPolicyPreview, recommendPlacementTargets as buildPlacementRecommendations, rollbackPlacementPolicy } from '../native/file-placement-policy.js';

const safeStorageEvidence = { volumes: [{ mount: '/', volumeId: 'root-volume', physicalDiskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', writable: true }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }] };
function previewPlacementPolicy(scan, options = {}) { return buildPlacementPolicyPreview(scan, { ...options, storageEvidence: options.storageEvidence || safeStorageEvidence }); }
function recommendPlacementTargets(options = {}) { const volumes = Array.isArray(options.volumes) ? options.volumes.map((item, index) => item && ({ ...item, health: item.health || 'healthy', volumeId: item.volumeId || `volume-${index}`, physicalDiskNumber: item.physicalDiskNumber ?? index, physicalDevicePath: item.physicalDevicePath || `disk${index}` })) : options.volumes; const drives = options.drives || (Array.isArray(volumes) ? volumes.map((item, index) => ({ diskNumber: index, physicalDevicePath: `disk${index}`, health: 'healthy', smart: 'passed' })) : [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }]); return buildPlacementRecommendations({ ...options, volumes, drives }); }

describe('native file placement policy', () => {
  test('groups approved categories and excludes unsafe evidence', () => {
    const scan = {
      root: '/home/test/Downloads',
      entries: [
        { path: '/home/test/Downloads/model.gguf', category: 'MODEL', sizeBytes: 4 },
        { path: '/home/test/Downloads/archive.zip', category: 'archive', sizeBytes: 5 },
        { path: '/home/test/Downloads/partial.part', category: 'incomplete-download', sizeBytes: 1 },
        { path: '/home/test/Downloads/secret.gguf', category: 'model', sizeBytes: 1, protected: true },
        { path: '/home/test/Downloads/duplicate.gguf', category: 'model', sizeBytes: 1 },
        { path: '/home/test/Downloads/readme.txt', category: 'other', sizeBytes: 1 },
        { path: null, category: 'model', sizeBytes: 1 },
        null
      ],
      duplicates: [{ paths: ['/home/test/Downloads/duplicate.gguf'] }]
    };
    const plan = previewPlacementPolicy(scan, {
      targetRoots: { model: '/mnt/archive/models', archive: '/mnt/archive/archives' },
      targetFreeBytes: { '/mnt/archive/models': 10, '/mnt/archive/archives': 10 },
      pathImpl: path.posix
    });
    expect(plan).toMatchObject({ version: FILE_PLACEMENT_POLICY_VERSION, state: 'preview-ready', estimatedBytes: 9, requiresApproval: true, mutation: 'none' });
    expect(plan.plans).toHaveLength(2);
    expect(plan.plans[0].moves.length + plan.plans[1].moves.length).toBe(2);
    expect(plan.skipped.map((item) => item.reason)).toEqual(expect.arrayContaining(['category-requires-review', 'source-is-protected', 'duplicate-requires-review', 'category-has-no-approved-target', 'file-path-evidence-unavailable']));
    expect(previewPlacementPolicy({ root: '/home/test/Downloads', entries: [{ path: '/home/test/Downloads/model.gguf', category: 'model', sizeBytes: 1 }], duplicates: [] }, { targetRoots: { model: '/mnt/archive/models' }, targetFreeBytes: {}, pathImpl: path.posix })).toMatchObject({ state: 'no-safe-moves', plans: [expect.objectContaining({ state: 'observation-required' })] });
  });

  test('validates roots and scan bounds', () => {
    expect(() => previewPlacementPolicy(null, { targetRoots: { model: '/mnt/archive' } })).toThrow('file insight scan');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: null })).toThrow('category target roots');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: {} })).toThrow('at least one target');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: { model: '' } })).toThrow('at least one target');
    expect(() => previewPlacementPolicy({ root: '/home/test/Downloads', entries: [] })).toThrow('category target roots');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: { model: '/mnt/archive' }, sourceRoots: [] })).toThrow('source root');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: { model: '/mnt/archive' }, maxEntries: 0 })).toThrow('maxEntries');
    expect(() => previewPlacementPolicy({ entries: [] }, { targetRoots: { model: '/mnt/archive' }, targetFreeBytes: null })).toThrow('source root');
    expect(previewPlacementPolicy({ root: '/home/test/Downloads', entries: [] }, { targetRoots: { model: '/mnt/archive' }, targetFreeBytes: null })).toMatchObject({ state: 'no-safe-moves', plans: [] });
    expect(previewPlacementPolicy({ root: '/home/test/Downloads', entries: [{ path: '/home/test/Downloads/model.gguf', category: 'model', sizeBytes: 1 }], duplicates: [{ paths: 'bad' }, null] }, { targetRoots: { model: '/mnt/archive' }, targetFreeBytes: { '/mnt/archive': 'bad' }, sourceRoots: ['/home/test/Downloads'] })).toMatchObject({ state: 'no-safe-moves' });
    expect(previewPlacementPolicy({ root: '/home/test/Downloads', entries: [{ path: '/home/test/Downloads/model.gguf', category: 'model', sizeBytes: 1 }], duplicates: 'bad' }, { targetRoots: { model: '/mnt/archive' }, targetFreeBytes: { '/mnt/archive': 'bad' }, sourceRoots: ['/home/test/Downloads'] })).toMatchObject({ state: 'no-safe-moves' });
  });

  test('recommends only evidenced, healthy, writable media targets', () => {
    const result = recommendPlacementTargets({
      volumes: [
        { mount: '/fast', mediaType: 'ssd', freeBytes: 10, health: 'healthy' },
        { mount: '/archive', mediaType: 'hdd', freeBytes: 100, health: 'healthy' },
        { mount: '/archive-small', mediaType: 'hdd', freeBytes: 80, health: 'healthy' },
        { mount: '/degraded', mediaType: 'hdd', freeBytes: 1000, health: 'degraded' },
        { mount: '/protected', mediaType: 'hdd', freeBytes: 1000, health: 'healthy', protected: true },
        { mount: '/readonly', mediaType: 'hdd', freeBytes: 1000, health: 'healthy', readOnly: true },
        { mount: '/unknown', mediaType: 'unknown', freeBytes: 1000, health: 'unknown' },
        { mount: '/missing-media', freeBytes: 1000, health: 'healthy' },
        null,
        { mount: null, mediaType: 'hdd', freeBytes: 1000 }
      ],
      categories: ['model', 'archive', 'other'],
      protectedRoots: ['/never-use'],
      minFreeBytes: 50,
      pathImpl: path.posix
    });
    expect(result).toMatchObject({ state: 'recommendations-ready', mutation: 'none', requiresApproval: true, recommendations: [
      { category: 'model', state: 'recommended', desiredMedia: 'hdd', targetVolume: '/archive', targetRoot: '/archive/model', freeBytes: 100 },
      { category: 'archive', state: 'recommended', targetRoot: '/archive/archive' },
      { category: 'other', state: 'review-required', reason: 'category-needs-explicit-media-policy' }
    ] });
    expect(recommendPlacementTargets({ volumes: [{ mount: '/fast', mediaType: 'ssd', freeBytes: 10 }], categories: ['model'], minFreeBytes: 20, pathImpl: path.posix })).toMatchObject({ state: 'review-required', recommendations: [{ state: 'no-safe-target', reason: 'no-volume-with-requested-media-type' }] });
    expect(recommendPlacementTargets({ volumes: [{ mount: '/unknown', mediaType: 'unknown', freeBytes: 100 }], categories: ['model'], pathImpl: path.posix })).toMatchObject({ state: 'review-required', recommendations: [{ state: 'no-safe-target', reason: 'media-type-evidence-unavailable' }] });
  });

  test('validates placement recommendation inputs', () => {
    expect(buildPlacementRecommendations()).toMatchObject({ state: 'review-required' });
    expect(buildPlacementRecommendations({ volumes: [{ root: '/raw', uniqueId: 'raw-id', freeBytes: 10, mediaType: 'hdd' }, { root: '/device', device: '/dev/raw', freeBytes: 10, mediaType: 'hdd', physicalDiskNumber: 0, physicalDevicePath: 'disk0' }], categories: ['model'], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }], pathImpl: path.posix })).toMatchObject({ state: 'review-required' });
    expect(() => buildPlacementPolicyPreview({ entries: [] })).toThrow('category target roots');
    expect(() => recommendPlacementTargets({ volumes: null })).toThrow('volume evidence');
    expect(() => recommendPlacementTargets({ categories: null })).toThrow('categories');
    expect(() => recommendPlacementTargets({ mediaPreferences: null })).toThrow('media preferences');
    expect(() => recommendPlacementTargets({ protectedRoots: null })).toThrow('protected roots');
    expect(() => recommendPlacementTargets({ minFreeBytes: -1 })).toThrow('free-space floor');
    expect(recommendPlacementTargets()).toMatchObject({ state: 'review-required' });
    expect(recommendPlacementTargets({ volumes: [{ mount: '/archive', mediaType: 'hdd', freeBytes: 100 }], categories: ['model'], protectedRoots: ['/archive'] })).toMatchObject({ state: 'review-required', recommendations: [{ state: 'no-safe-target' }] });
    expect(recommendPlacementTargets({ volumes: [{ root: '/archive', mediaType: 'hdd', freeBytes: 100 }], categories: ['model'], mediaPreferences: { model: 'HDD' } })).toMatchObject({ state: 'recommendations-ready' });
  });

  test('applies and rolls back through the existing placement authority', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-placement-policy-'));
    const source = path.join(root, 'downloads');
    const target = path.join(root, 'archive');
    await fs.mkdir(source);
    const file = path.join(source, 'model.gguf');
    await fs.writeFile(file, 'model');
    const plan = previewPlacementPolicy({ root: source, entries: [{ path: file, category: 'model', sizeBytes: 5 }], duplicates: [] }, { targetRoots: { model: target }, targetFreeBytes: { [target]: 20 } });
    try {
      expect(await applyPlacementPolicy(plan)).toMatchObject({ dryRun: true, results: [expect.objectContaining({ dryRun: true })] });
      await expect(applyPlacementPolicy(plan, { dryRun: false })).rejects.toThrow('explicit approval');
      const applied = await applyPlacementPolicy(plan, { approved: true, dryRun: false });
      expect(applied.results[0].moved).toHaveLength(1);
      await expect(rollbackPlacementPolicy(applied)).resolves.toMatchObject({ rollbacks: [expect.objectContaining({ restored: expect.any(Array) })] });
      await expect(applyPlacementPolicy(null)).rejects.toThrow('Invalid placement policy plan');
      await expect(rollbackPlacementPolicy(null)).rejects.toThrow('Invalid placement policy result');
      expect(await rollbackPlacementPolicy({ results: [] })).toEqual({ rollbacks: [] });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
