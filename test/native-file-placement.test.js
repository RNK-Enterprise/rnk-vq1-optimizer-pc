/**
 * Native file placement tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyFilePlacement, FILE_PLACEMENT_VERSION, previewFilePlacement as buildFilePlacementPreview, rollbackFilePlacement } from '../native/file-placement.js';

const safeStorage = { volumes: [{ mount: '/', volumeId: 'root-volume', physicalDiskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', writable: true }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }] };
function previewFilePlacement(options = {}) { return buildFilePlacementPreview({ ...options, storageEvidence: options.storageEvidence || safeStorage }); }

describe('native file placement', () => {
  let root;
  let sourceRoot;
  let targetRoot;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-placement-')); sourceRoot = path.join(root, 'downloads'); targetRoot = path.join(root, 'archive'); await fs.mkdir(sourceRoot); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('previews safe cross-volume placement and protects boundaries', () => {
    const files = [{ path: path.join(sourceRoot, 'movie.mkv'), sizeBytes: 40, category: 'video' }, { path: path.join(sourceRoot, 'secret.txt'), sizeBytes: 10, protected: true }, { path: path.join(root, 'repo', 'code.js'), sizeBytes: 10, category: 'code' }, { path: path.join(sourceRoot, 'unknown.bin'), sizeBytes: null }, { path: path.join(sourceRoot, 'same.txt'), sizeBytes: 1, category: '../escape' }];
    const plan = previewFilePlacement({ files, sourceRoots: [sourceRoot], targetRoot, protectedRoots: [path.join(root, 'repo')], targetFreeBytes: 50 });
    expect(plan).toMatchObject({ version: FILE_PLACEMENT_VERSION, state: 'preview-ready', estimatedBytes: 41, remainingFreeBytes: 9, mutation: 'none' });
    expect(plan.moves[0]).toMatchObject({ category: 'video', sizeBytes: 40, reversible: true });
    expect(plan.skipped.map((item) => item.reason)).toEqual(expect.arrayContaining(['source-is-protected', 'source-is-outside-approved-roots', 'file-size-evidence-unavailable']));
    expect(plan.moves[0].destination).toContain(path.join('archive', 'video', 'movie.mkv'));
    const noProtected = previewFilePlacement({ files: [{ path: path.join(sourceRoot, 'plain.txt'), sizeBytes: 1 }], sourceRoots: [sourceRoot], protectedRoots: null, targetRoot, targetFreeBytes: 1 });
    expect(noProtected.moves).toHaveLength(1);
    const outsideDestination = previewFilePlacement({ files: [{ path: path.join(sourceRoot, 'outside.txt'), sizeBytes: 1 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, pathImpl: { ...path, join: () => '/outside/destination' } });
    expect(outsideDestination.skipped[0].reason).toBe('destination-is-outside-target-root');
    const sameDestination = previewFilePlacement({ files: [{ path: path.join(targetRoot, 'video', 'movie.mkv'), sizeBytes: 1, category: 'video' }], sourceRoots: [targetRoot], targetRoot, targetFreeBytes: 1 });
    expect(sameDestination.skipped[0].reason).toBe('source-already-at-destination');
    const preservePlan = previewFilePlacement({ files: [{ path: path.join(sourceRoot, 'copy.txt'), sizeBytes: 1 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, preserveSource: true });
    expect(preservePlan).toMatchObject({ preserveSource: true, moves: [expect.objectContaining({ preserveSource: true })] });
  });

  test('returns observation-required or no-safe-moves when evidence or space is unavailable', () => {
    expect(buildFilePlacementPreview({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1 })).toMatchObject({ state: 'storage-target-rejected', mutation: 'none' });
    expect(buildFilePlacementPreview({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, storageEvidence: { state: 'HEALTHY', admission: 'ALLOW' } })).toMatchObject({ state: 'no-safe-moves' });
    expect(buildFilePlacementPreview({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, storageEvidence: { volumes: [], drives: [] } })).toMatchObject({ state: 'storage-target-rejected' });
    expect(buildFilePlacementPreview({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, storageEvidence: {} })).toMatchObject({ state: 'storage-target-rejected' });
    expect(buildFilePlacementPreview({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, storageEvidence: { state: 'UNKNOWN', admission: 'DENY' } })).toMatchObject({ state: 'storage-target-rejected', skipped: [{ reason: 'storage-suitability-required' }] });
    expect(() => buildFilePlacementPreview()).toThrow('file facts');
    expect(previewFilePlacement({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: null })).toMatchObject({ state: 'observation-required', remainingFreeBytes: null });
    expect(previewFilePlacement({ files: [{ path: path.join(sourceRoot, 'large.bin'), sizeBytes: 10 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1 })).toMatchObject({ state: 'no-safe-moves', skipped: [{ reason: 'target-volume-lacks-space' }] });
    expect(() => previewFilePlacement({ files: [], sourceRoots: [], targetRoot, targetFreeBytes: 1 })).toThrow('at least one root');
    expect(() => previewFilePlacement({ files: [], sourceRoots: [sourceRoot], targetRoot: '', targetFreeBytes: 1 })).toThrow('target root');
    expect(() => previewFilePlacement({ files: [], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1, maxEntries: 0 })).toThrow('maxEntries');
    expect(() => previewFilePlacement({ files: null, sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 1 })).toThrow('file facts');
    expect(() => previewFilePlacement()).toThrow('file facts');
    const limited = previewFilePlacement({ files: [{ path: path.join(sourceRoot, 'a.txt'), sizeBytes: 1 }, { path: path.join(sourceRoot, 'b.txt'), sizeBytes: 1 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 2, maxEntries: 1 });
    expect(limited.moves).toHaveLength(1);
    const invalidRows = previewFilePlacement({ files: [null, { path: '', sizeBytes: 1 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 2 });
    expect(invalidRows.skipped).toHaveLength(2);
  });

  test('applies, refuses collisions, handles cross-device transfer, and rolls back', async () => {
    const source = path.join(sourceRoot, 'note.txt');
    await fs.writeFile(source, 'note');
    const plan = previewFilePlacement({ files: [{ path: source, sizeBytes: 4, category: 'documents' }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 10 });
    expect(await applyFilePlacement(plan)).toMatchObject({ dryRun: true, moved: [], skipped: [expect.objectContaining({ reason: 'dry-run' })] });
    await expect(applyFilePlacement(plan, { dryRun: false })).rejects.toThrow('explicit approval');
    const applied = await applyFilePlacement(plan, { approved: true, dryRun: false });
    expect(applied.moved[0].method).toBe('copy-delete');
    expect(await fs.readFile(applied.moved[0].destination, 'utf8')).toBe('note');
    const collision = await applyFilePlacement(plan, { approved: true, dryRun: false });
    expect(collision.skipped[0].reason).toBe('destination-exists');
    const rollback = await rollbackFilePlacement(applied);
    expect(rollback.restored[0].method).toBe('copy-delete');
    expect(await fs.readFile(source, 'utf8')).toBe('note');
    const failedRollback = await rollbackFilePlacement({ moved: [plan.moves[0]] }, { fsImpl: { rename: jest.fn(async () => { throw new Error('rollback failed'); }) } });
    expect(failedRollback.skipped[0].reason).toBe('fsImpl.copyFile is not a function');
    await expect(rollbackFilePlacement(null)).rejects.toThrow('Invalid file placement result');
    await expect(applyFilePlacement(null)).rejects.toThrow('Invalid file placement plan');
  });

  test('preserves sources when copy verification or path boundary fails', async () => {
    const source = path.join(sourceRoot, 'copy.bin');
    await fs.writeFile(source, 'copy');
    const plan = previewFilePlacement({ files: [{ path: source, sizeBytes: 4 }], sourceRoots: [sourceRoot], targetRoot, targetFreeBytes: 10 });
    const crossFs = { mkdir: fs.mkdir, lstat: jest.fn(async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), rename: jest.fn(async (from, to) => { if (String(from).endsWith('.rnk-partial')) return fs.rename(from, to); const error = new Error('cross'); error.code = 'EXDEV'; throw error; }), copyFile: fs.copyFile, stat: fs.stat, unlink: fs.unlink, open: fs.open };
    const moved = await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: crossFs });
    expect(moved.moved[0].method).toBe('copy-delete');
    const bad = { ...plan, moves: [{ ...plan.moves[0], source: path.join(root, 'outside.txt') }] };
    expect((await applyFilePlacement(bad, { approved: true, dryRun: false })).skipped[0].reason).toBe('plan-path-boundary-failed');
    await fs.writeFile(source, 'copy');
    const verify = { ...plan, moves: [{ ...plan.moves[0], destination: path.join(targetRoot, 'bad.txt') }] };
    const failingFs = { ...crossFs, stat: jest.fn(async () => ({ size: 99 })) };
    const failed = await applyFilePlacement(verify, { approved: true, dryRun: false, fsImpl: failingFs });
    expect(failed.skipped[0].reason).toBe('copy verification failed');
    const protectedPlan = { ...plan, protectedRoots: [sourceRoot], moves: [plan.moves[0]] };
    expect((await applyFilePlacement(protectedPlan, { approved: true, dryRun: false })).skipped[0].reason).toBe('plan-path-boundary-failed');
    const noProtectedField = { ...plan, protectedRoots: undefined };
    const missingSourceFs = { mkdir: jest.fn(async () => {}), lstat: jest.fn(async () => { const error = new Error('missing destination'); error.code = 'ENOENT'; throw error; }), rename: jest.fn(async () => { throw new Error('missing source'); }) };
    expect((await applyFilePlacement(noProtectedField, { approved: true, dryRun: false, fsImpl: missingSourceFs })).skipped[0].reason).toBe('fsImpl.copyFile is not a function');
    const deniedFs = { ...crossFs, lstat: jest.fn(async () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: deniedFs })).skipped[0].reason).toBe('denied');
    const deniedDestinationFs = { ...crossFs, lstat: jest.fn(async (file) => { if (file === plan.moves[0].source) return { isSymbolicLink: () => false }; if (String(file).endsWith('.rnk-partial')) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } const error = new Error('destination denied'); error.code = 'EACCES'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: deniedDestinationFs })).skipped[0].reason).toBe('destination denied');
    const partialLinkFs = { ...crossFs, lstat: jest.fn(async (file) => { if (file === plan.moves[0].source) return { isSymbolicLink: () => false }; if (String(file).endsWith('.rnk-partial')) return { isSymbolicLink: () => true, isDirectory: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: partialLinkFs })).skipped[0].reason).toBe('partial destination is not a regular file');
    const partialDirectoryFs = { ...partialLinkFs, lstat: jest.fn(async (file) => { if (file === plan.moves[0].source) return { isSymbolicLink: () => false }; if (String(file).endsWith('.rnk-partial')) return { isSymbolicLink: () => false, isDirectory: () => true }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: partialDirectoryFs })).skipped[0].reason).toBe('partial destination is not a regular file');
    const existingPartialFs = { ...crossFs, lstat: jest.fn(async (file) => { if (file === plan.moves[0].source) return { isSymbolicLink: () => false }; if (String(file).endsWith('.rnk-partial')) return { isSymbolicLink: () => false, isDirectory: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), unlink: jest.fn(async () => {}) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: existingPartialFs })).moved[0]).toMatchObject({ method: 'copy-delete' });
    const existingCopyFs = { ...crossFs, lstat: existingPartialFs.lstat, copyFile: jest.fn(async () => { const error = new Error('exists'); error.code = 'EEXIST'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: existingCopyFs })).skipped[0].reason).toBe('exists');
    const cleanupMissingFs = { ...crossFs, copyFile: jest.fn(async () => { throw new Error('copy-failed'); }), unlink: jest.fn(async () => { const error = new Error('cleanup-missing'); error.code = 'ENOENT'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: cleanupMissingFs })).skipped[0].reason).toBe('copy-failed');
    const cleanupDeniedFs = { ...crossFs, copyFile: jest.fn(async () => { throw new Error('copy-failed'); }), unlink: jest.fn(async () => { const error = new Error('cleanup-denied'); error.code = 'EACCES'; throw error; }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: cleanupDeniedFs })).skipped[0].reason).toBe('copy-failed');
    const renameFailure = { ...crossFs, rename: jest.fn(async () => { throw new Error('rename failed'); }) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: renameFailure })).skipped[0].reason).toBe('rename failed');
    const fallbackFs = { mkdir: crossFs.mkdir, lstat: crossFs.lstat, rename: crossFs.rename, copyFile: crossFs.copyFile, stat: crossFs.stat, unlink: crossFs.unlink, readFile: jest.fn(async () => Buffer.from('copy')) };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: fallbackFs })).moved[0]).toMatchObject({ method: 'copy-delete', verificationState: 'verified' });
    await fs.writeFile(source, 'copy');
    const noHashFs = { ...fallbackFs, readFile: undefined };
    expect((await applyFilePlacement(plan, { approved: true, dryRun: false, fsImpl: noHashFs })).skipped[0].reason).toBe('copy hash verification unavailable');
    await fs.writeFile(source, 'copy');
    const noReadFs = { ...crossFs, open: jest.fn(async () => ({ close: jest.fn(async () => {}) })) };
    expect((await applyFilePlacement({ ...plan, moves: [{ ...plan.moves[0], destination: path.join(targetRoot, 'no-read.txt') }] }, { approved: true, dryRun: false, fsImpl: noReadFs })).skipped[0].reason).toBe('copy hash verification unavailable');
    await fs.writeFile(source, 'copy');
    let oddCalls = 0;
    const oddFs = { ...crossFs, open: jest.fn(async () => {
      oddCalls += 1;
      if (oddCalls === 1) return {};
      let reads = 0;
      return { read: jest.fn(async (buffer) => { if (reads++ > 0) return { bytesRead: 0 }; buffer.fill(1, 0, 4); return { bytesRead: 4 }; }), ...(oddCalls === 3 ? { close: jest.fn(async () => {}) } : {}) };
    }) };
    expect((await applyFilePlacement({ ...plan, preserveSource: true, moves: [{ ...plan.moves[0], preserveSource: true, destination: path.join(targetRoot, 'odd-handles.txt') }] }, { approved: true, dryRun: false, fsImpl: oddFs })).moved[0]).toMatchObject({ verificationState: 'verified', sourceDeletionState: 'preserved' });
    const preserved = await applyFilePlacement({ ...plan, preserveSource: true, moves: [{ ...plan.moves[0], preserveSource: true, destination: path.join(targetRoot, 'preserved.txt') }] }, { approved: true, dryRun: false, fsImpl: fallbackFs });
    expect(preserved.moved[0]).toMatchObject({ verificationState: 'verified', sourceDeletionState: 'preserved' });
    expect((await rollbackFilePlacement(preserved, { fsImpl: { ...fallbackFs, unlink: jest.fn(async () => {}) } })).restored[0]).toMatchObject({ method: 'delete-copy', sourceDeletionState: 'preserved' });
  });
});
