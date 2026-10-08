/**
 * Native quarantine authority tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyQuarantine, previewQuarantine, QUARANTINE_VERSION, rollbackQuarantine } from '../native/quarantine.js';

describe('native quarantine authority', () => {
  let parent;
  let source;
  let quarantine;

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-quarantine-'));
    source = path.join(parent, 'cache');
    quarantine = path.join(parent, 'quarantine');
    await fs.mkdir(source);
  });

  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  test('builds a bounded plan with protected and unsupported entries skipped', () => {
    const plan = previewQuarantine([
      { path: path.join(source, 'one.tmp'), kind: 'file', sizeBytes: 4 },
      { path: path.join(source, 'folder'), kind: 'directory', sizeBytes: 8 },
      { path: path.join(source, 'secret'), kind: 'file', sizeBytes: 2, protected: true },
      { path: path.join(parent, 'outside'), kind: 'file', sizeBytes: 2 },
      { path: path.join(source, 'link'), kind: 'symlink', sizeBytes: 2 },
      { path: path.join(source, 'unknown'), kind: 'file', sizeBytes: null },
      null,
      { path: path.join(source, 'protected-root'), kind: 'file', sizeBytes: 1 }
    ], { sourceRoots: [source], quarantineRoot: quarantine, protectedRoots: [path.join(source, 'protected-root')], maxEntries: 8 });
    expect(plan).toMatchObject({ version: QUARANTINE_VERSION, state: 'preview-ready', estimatedBytes: 12, requiresApproval: true, mutation: 'none', truncated: false });
    expect(plan.moves).toHaveLength(2);
    expect(plan.skipped.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'source-is-protected', 'source-is-outside-approved-roots', 'entry-type-is-unsupported', 'file-size-evidence-unavailable'
    ]));
    expect(previewQuarantine([{ path: path.join(source, 'one.tmp'), kind: 'file', sizeBytes: 1 }, { path: path.join(source, 'two.tmp'), kind: 'file', sizeBytes: 1 }], { sourceRoots: [source], quarantineRoot: quarantine, maxEntries: 1 }).truncated).toBe(true);
  });

  test('validates roots, entries, and bounds', () => {
    expect(() => previewQuarantine([])).toThrow('at least one root');
    expect(() => previewQuarantine(null, { sourceRoots: [source], quarantineRoot: quarantine })).toThrow('explicit entries');
    expect(() => previewQuarantine([], { sourceRoots: [], quarantineRoot: quarantine })).toThrow('at least one root');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: source })).toThrow('separate');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: path.join(source, 'nested') })).toThrow('separate');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: parent })).toThrow('separate');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: null })).toThrow('destination root');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: quarantine, maxEntries: 0 })).toThrow('maxEntries');
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: quarantine, protectedRoots: 'bad' })).not.toThrow();
    expect(() => previewQuarantine([], { sourceRoots: [source], quarantineRoot: quarantine, pathImpl: { ...path, resolve: () => quarantine } })).toThrow('separate');
    expect(previewQuarantine([{ path: path.join(source, 'one'), kind: 'file', sizeBytes: 1 }], { sourceRoots: [source], quarantineRoot: quarantine, pathImpl: { ...path, relative: () => '/escape', isAbsolute: () => true } })).toMatchObject({ state: 'no-safe-moves' });
    expect(previewQuarantine([{ path: path.join(source, 'one'), kind: 'file', sizeBytes: 1 }], { sourceRoots: [source], quarantineRoot: quarantine, pathImpl: { ...path, join: () => path.join(parent, 'outside') } })).toMatchObject({ state: 'no-safe-moves' });
  });

  test('applies same-volume quarantine and restores it', async () => {
    const file = path.join(source, 'one.tmp');
    const folder = path.join(source, 'folder');
    const nested = path.join(folder, 'nested.tmp');
    const link = path.join(source, 'link.tmp');
    await fs.writeFile(file, 'one');
    await fs.mkdir(folder);
    await fs.writeFile(nested, 'nested');
    await fs.symlink(file, link);
    const plan = previewQuarantine([
      { path: file, kind: 'file', sizeBytes: 3 },
      { path: folder, kind: 'directory', sizeBytes: 6 },
      { path: link, kind: 'file', sizeBytes: 3 }
    ], { sourceRoots: [source], quarantineRoot: quarantine });
    await expect(applyQuarantine(plan, { dryRun: false })).rejects.toThrow('explicit approval');
    expect(await applyQuarantine(plan)).toMatchObject({ dryRun: true, moved: [], skipped: expect.arrayContaining([expect.objectContaining({ reason: 'dry-run' })]) });
    const applied = await applyQuarantine(plan, { approved: true, dryRun: false });
    expect(applied).toMatchObject({ version: QUARANTINE_VERSION, dryRun: false, mutation: 'quarantine' });
    expect(applied.moved).toHaveLength(2);
    expect(applied.skipped).toEqual([expect.objectContaining({ reason: 'symlink' })]);
    await expect(fs.access(file)).rejects.toThrow();
    const restored = await rollbackQuarantine(applied);
    expect(restored).toMatchObject({ mutation: 'rollback', restored: [expect.anything(), expect.anything()] });
    await expect(fs.access(file)).resolves.toBeUndefined();
    await expect(fs.access(nested)).resolves.toBeUndefined();
  });

  test('keeps failed or unsafe mutations explicit', async () => {
    const file = path.join(source, 'one.tmp');
    const destination = path.join(quarantine, '000000', 'one.tmp');
    await fs.writeFile(file, 'one');
    const plan = previewQuarantine([{ path: file, kind: 'file', sizeBytes: 3 }], { sourceRoots: [source], quarantineRoot: quarantine });
    const boundaryPlan = { ...plan, moves: [{ ...plan.moves[0], destination: path.join(parent, 'outside') }] };
    expect((await applyQuarantine(boundaryPlan, { approved: true, dryRun: false })).skipped[0].reason).toBe('plan-path-boundary-failed');
    const existingFs = { lstat: jest.fn(async (target) => target === file ? { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false } : {}), mkdir: jest.fn(), rename: jest.fn() };
    expect((await applyQuarantine(plan, { approved: true, dryRun: false, fsImpl: existingFs })).skipped[0].reason).toBe('quarantine-destination-exists');
    const typeFs = { lstat: jest.fn(async () => ({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false })), mkdir: jest.fn(), rename: jest.fn() };
    expect((await applyQuarantine(plan, { approved: true, dryRun: false, fsImpl: typeFs })).skipped[0].reason).toBe('source-type-changed');
    let exdevCalls = 0;
    const exdevFs = { lstat: jest.fn(async () => { exdevCalls += 1; if (exdevCalls % 2 === 0) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }; }), mkdir: jest.fn(), rename: jest.fn(async () => { const error = new Error('cross'); error.code = 'EXDEV'; throw error; }) };
    expect((await applyQuarantine(plan, { approved: true, dryRun: false, fsImpl: exdevFs })).skipped[0].reason).toBe('quarantine-must-share-volume');
    let deniedCalls = 0;
    const deniedFs = { lstat: jest.fn(async () => { deniedCalls += 1; if (deniedCalls === 1) return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }; const error = new Error('denied'); error.code = 'EACCES'; throw error; }), mkdir: jest.fn(), rename: jest.fn() };
    expect((await applyQuarantine(plan, { approved: true, dryRun: false, fsImpl: deniedFs })).skipped[0].reason).toBe('denied');
    let renameDeniedCalls = 0;
    const renameDeniedFs = { lstat: jest.fn(async () => { renameDeniedCalls += 1; if (renameDeniedCalls === 1) return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), mkdir: jest.fn(), rename: jest.fn(async () => { throw new Error('rename-denied'); }) };
    expect((await applyQuarantine(plan, { approved: true, dryRun: false, fsImpl: renameDeniedFs })).skipped[0].reason).toBe('rename-denied');
    let rollbackCalls = 0;
    const rollbackFs = { lstat: jest.fn(async () => { rollbackCalls += 1; if (rollbackCalls === 1) return { isSymbolicLink: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), mkdir: jest.fn(), rename: exdevFs.rename };
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], destination }] }, { fsImpl: rollbackFs })).skipped[0].reason).toBe('rollback-must-share-volume');
    const symlinkRollbackFs = { lstat: jest.fn(async () => ({ isSymbolicLink: () => true })), mkdir: jest.fn(), rename: jest.fn() };
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], destination }] }, { fsImpl: symlinkRollbackFs })).skipped[0].reason).toBe('quarantine-source-is-symlink');
    const restoreExistsFs = { lstat: jest.fn(async () => ({ isSymbolicLink: () => false })), mkdir: jest.fn(), rename: jest.fn() };
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], destination }] }, { fsImpl: restoreExistsFs })).skipped[0].reason).toBe('restore-destination-exists');
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], source: path.join(parent, 'outside'), destination }] })).skipped[0].reason).toBe('rollback-path-boundary-failed');
    let rollbackDeniedCalls = 0;
    const rollbackDeniedFs = { lstat: jest.fn(async () => { rollbackDeniedCalls += 1; if (rollbackDeniedCalls === 1) return { isSymbolicLink: () => false }; const error = new Error('restore-denied'); error.code = 'EACCES'; throw error; }), mkdir: jest.fn(), rename: jest.fn() };
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], destination }] }, { fsImpl: rollbackDeniedFs })).skipped[0].reason).toBe('restore-denied');
    let rollbackRenameCalls = 0;
    const rollbackRenameFs = { lstat: jest.fn(async () => { rollbackRenameCalls += 1; if (rollbackRenameCalls === 1) return { isSymbolicLink: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), mkdir: jest.fn(), rename: jest.fn(async () => { throw new Error('restore-rename-denied'); }) };
    expect((await rollbackQuarantine({ ...plan, moved: [{ ...plan.moves[0], destination }] }, { fsImpl: rollbackRenameFs })).skipped[0].reason).toBe('restore-rename-denied');
    await expect(applyQuarantine({ ...plan, quarantineRoot: source })).rejects.toThrow('roots overlap');
    await expect(rollbackQuarantine({ ...plan, moved: [], quarantineRoot: source })).rejects.toThrow('roots overlap');
    await expect(applyQuarantine(null)).rejects.toThrow('Invalid quarantine plan');
    await expect(rollbackQuarantine(null)).rejects.toThrow('Invalid quarantine result');
  });
});
