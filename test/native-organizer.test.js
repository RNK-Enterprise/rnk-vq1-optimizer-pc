/**
 * Native organizer tests.
 * Copyright © 2026 RNK Enterprise
 * Contributor: RNK Enterprise
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyOrganization, previewOrganization, rollbackOrganization } from '../native/organizer.js';

describe('native organizer', () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-organizer-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('previews top-level files by category and refuses links/hidden entries', async () => {
    for (const name of ['note.txt', 'photo.png', 'film.mp4', 'song.mp3', 'bundle.zip', 'script.js', 'unknown.bin']) {
      await fs.writeFile(path.join(root, name), name);
    }
    await fs.writeFile(path.join(root, '.hidden.txt'), 'hidden');
    await fs.mkdir(path.join(root, 'documents'));
    await fs.mkdir(path.join(root, 'nested'));
    await fs.writeFile(path.join(root, 'nested', 'nested.txt'), 'nested');
    await fs.symlink(path.join(root, 'note.txt'), path.join(root, 'linked.txt'));
    const plan = await previewOrganization(root);
    expect(plan.root).toBe(path.resolve(root));
    expect(plan.moves.map((move) => move.category)).toEqual(expect.arrayContaining(['documents', 'images', 'video', 'audio', 'archives', 'code', 'other']));
    expect(plan.moves.some((move) => move.source.endsWith('.hidden.txt'))).toBe(false);
    expect(plan.moves.some((move) => move.source.endsWith('nested.txt'))).toBe(false);
    expect(plan.moves.some((move) => move.source.endsWith('linked.txt'))).toBe(false);

    const recursive = await previewOrganization(root, { recursive: true, maxEntries: 1 });
    expect(recursive.moves).toHaveLength(1);
    expect(recursive.truncated).toBe(true);
    const fullRecursive = await previewOrganization(root, { recursive: true });
    expect(fullRecursive.moves.some((move) => move.source.endsWith('nested.txt'))).toBe(true);
    const sameDestinationPath = {
      ...path,
      join: (...parts) => parts.length === 3 && parts[1] === 'documents' ? path.join(parts[0], parts[2]) : path.join(...parts)
    };
    const sameDestination = await previewOrganization(root, { pathImpl: sameDestinationPath });
    expect(sameDestination.moves.some((move) => move.source.endsWith('note.txt'))).toBe(false);
    await expect(previewOrganization(root, { maxEntries: 0 })).rejects.toThrow('out of range');
    await expect(previewOrganization('')).rejects.toThrow('requires a root');
  });

  test('supports preview, approved moves, collision refusal, root refusal, and rollback', async () => {
    await fs.writeFile(path.join(root, 'note.txt'), 'note');
    const plan = await previewOrganization(root);
    expect(await applyOrganization(plan)).toEqual({ dryRun: true, moved: [], skipped: plan.moves.length });
    await expect(applyOrganization(plan, { dryRun: false })).rejects.toThrow('explicit approval');
    const first = await applyOrganization(plan, { approved: true, dryRun: false });
    expect(first.moved).toHaveLength(1);
    expect(first.moved[0].destination).toContain(path.join('documents', 'note.txt'));
    expect(await fs.readFile(first.moved[0].destination, 'utf8')).toBe('note');

    const collision = await applyOrganization({ ...plan, moves: [...plan.moves, plan.moves[0]] }, { approved: true, dryRun: false });
    expect(collision.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'destination-exists' })]));
    const outside = await applyOrganization({ root: plan.root, moves: [{ source: path.join(path.dirname(root), 'outside.txt'), destination: path.join(root, 'documents', 'outside.txt') }] }, { approved: true, dryRun: false });
    expect(outside.skipped[0].reason).toBe('outside-selected-root');

    const rollback = await rollbackOrganization(first);
    expect(rollback.restored).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'note.txt'), 'utf8')).toBe('note');
    const failedRollback = await rollbackOrganization({ moved: [{ source: path.join(root, 'missing.txt'), destination: path.join(root, 'also-missing.txt') }] });
    expect(failedRollback.skipped).toHaveLength(1);
    const failedMove = await applyOrganization({ root: plan.root, moves: [{ source: path.join(root, 'missing.txt'), destination: path.join(root, 'documents', 'missing.txt') }] }, { approved: true, dryRun: false });
    expect(failedMove.skipped[0].reason).toContain('no such file');
    const exactRoot = await applyOrganization({ root: plan.root, moves: [{ source: plan.root, destination: path.join(plan.root, 'documents', 'root') }] }, { approved: true, dryRun: false });
    expect(exactRoot.skipped[0].reason).toBe('outside-selected-root');
    const absolutePathImpl = { ...path, relative: () => '/absolute', isAbsolute: () => true };
    const absolute = await applyOrganization({ root: plan.root, moves: [{ source: path.join(root, 'missing.txt'), destination: path.join(root, 'documents', 'missing.txt') }] }, { approved: true, dryRun: false, pathImpl: absolutePathImpl });
    expect(absolute.skipped[0].reason).toBe('outside-selected-root');
    await expect(rollbackOrganization(null)).rejects.toThrow('Invalid organization result');
    await expect(applyOrganization(null)).rejects.toThrow('Invalid organization plan');
    await expect(previewOrganization(path.join(root, 'missing-directory'))).resolves.toEqual(expect.objectContaining({ moves: [] }));
    const race = await previewOrganization(root, {
      fsImpl: { readdir: async () => [{ name: 'gone.txt' }], lstat: async () => { throw new Error('gone'); } }
    });
    expect(race.moves).toEqual([]);
    const weird = await previewOrganization(root, {
      fsImpl: { readdir: async () => [{ name: 'weird' }], lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false }) }
    });
    expect(weird.moves).toEqual([]);
  });
});
