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
 * sync-stacks tests - fixture-stack coverage of the VQ 1 -> VQ 2 sync
 * helper: change detection, file creation (with nested dirs), dry-run,
 * reverse direction, and the no-delete guarantee. Also guards the real
 * stacks: the syncer must be a no-op whenever the parity gate is green,
 * and the parity gate must be green right now.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { syncStacks, formatSyncReport, defaultStackRoot } from '../scripts/sync-stacks.js';
import { PARITY_FILES, checkParity } from '../scripts/stack-parity.js';

function makeFixtureStack() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vq-sync-'));
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('syncStacks (fixture stacks)', () => {
  let a;
  let b;
  const FILES = ['mod.js'];

  beforeEach(() => {
    a = makeFixtureStack();
    b = makeFixtureStack();
  });

  afterEach(() => {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });

  test('identical files produce an empty, ok plan', () => {
    write(a, 'mod.js', 'same');
    write(b, 'mod.js', 'same');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES });
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  test('changed file is copied into the target, byte-exact', () => {
    write(a, 'mod.js', 'v2 content');
    write(b, 'mod.js', 'v1 content');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES });
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([
      expect.objectContaining({ rel: 'mod.js', action: 'copied' })
    ]);
    expect(fs.readFileSync(path.join(b, 'mod.js'), 'utf8')).toBe('v2 content');
    // mtime aligned so timestamp-sensitive tooling also agrees
    expect(fs.statSync(path.join(b, 'mod.js')).mtimeMs)
      .toBeCloseTo(fs.statSync(path.join(a, 'mod.js')).mtimeMs, 0);
  });

  test('missing target file is created, including nested directories', () => {
    write(a, 'deep/nested/mod.js', 'new shared file');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: ['deep/nested/mod.js'] });
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([
      expect.objectContaining({ rel: 'deep/nested/mod.js', action: 'created' })
    ]);
    expect(fs.readFileSync(path.join(b, 'deep/nested/mod.js'), 'utf8'))
      .toBe('new shared file');
  });

  test('dry-run reports the plan but writes nothing', () => {
    write(a, 'mod.js', 'changed');
    write(b, 'mod.js', 'original');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES, dryRun: true });
    expect(report.actions).toHaveLength(1);
    expect(fs.readFileSync(path.join(b, 'mod.js'), 'utf8')).toBe('original');
  });

  test('reverse copies VQ 2 -> VQ 1 instead', () => {
    write(a, 'mod.js', 'stale');
    write(b, 'mod.js', 'fresh');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES, reverse: true });
    expect(report.actions).toHaveLength(1);
    expect(fs.readFileSync(path.join(a, 'mod.js'), 'utf8')).toBe('fresh');
    expect(fs.readFileSync(path.join(b, 'mod.js'), 'utf8')).toBe('fresh');
  });

  test('no-delete guarantee: source-missing file is left untouched and reported', () => {
    write(b, 'mod.js', 'only in target');

    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain('missing from source');
    expect(report.actions).toEqual([]);
    expect(fs.existsSync(path.join(b, 'mod.js'))).toBe(true);
  });

  test('file missing from BOTH stacks is skipped silently (nothing to sync)', () => {
    const report = syncStacks({ stackRoot1: a, stackRoot2: b, files: ['ghost.js'] });
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  test('only manifest files are ever touched', () => {
    write(a, 'mod.js', 'shared');
    write(a, 'private.js', 'secret');
    write(b, 'mod.js', 'stale');
    write(b, 'private.js', 'old-secret');

    syncStacks({ stackRoot1: a, stackRoot2: b, files: FILES });
    expect(fs.readFileSync(path.join(b, 'mod.js'), 'utf8')).toBe('shared');
    expect(fs.readFileSync(path.join(b, 'private.js'), 'utf8')).toBe('old-secret');
  });

  test('formatSyncReport renders all outcomes', () => {
    const clean = formatSyncReport({ ok: true, actions: [], errors: [] });
    expect(clean).toContain('up-to-date');

    const busy = formatSyncReport(
      { ok: true, actions: [{ rel: 'mod.js', action: 'copied', from: 'a', to: 'b' }], errors: [] },
      { dryRun: true }
    );
    expect(busy).toContain('copied  mod.js');
    expect(busy).toContain('Dry run');

    const executed = formatSyncReport(
      { ok: true, actions: [{ rel: 'mod.js', action: 'created', from: 'a', to: 'b' }], errors: [] }
    );
    expect(executed).toContain('Done: 1 file(s) synced');
    expect(executed).toContain('never touched');

    const failed = formatSyncReport(
      { ok: false, actions: [], errors: ['x.js missing from source'] }
    );
    expect(failed).toContain('SKIPPED');
    expect(failed).toContain('1 problem(s)');
  });

  test('formatSyncReport names the reverse direction', () => {
    expect(formatSyncReport({ ok: true, actions: [], errors: [] }, { reverse: true }))
      .toContain('VQ 2 -> VQ 1');
  });
});

// Real-stack suite only applies inside the full RNK workspace.
const REAL_STACKS = ['VQ 1', 'VQ 2'].every((dir) =>
  fs.existsSync(path.resolve(process.cwd(), dir))
  || fs.existsSync(path.resolve(process.cwd(), '..', dir)));
const describeRealStacks = REAL_STACKS ? describe : describe.skip;

describeRealStacks('sync helper against the real stacks', () => {
  test('real parity is green and the syncer is a no-op on it', () => {
    const parity = checkParity();
    expect(parity.ok).toBe(true);

    const report = syncStacks({ dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('no-arg call uses the real stacks as defaults and is a no-op on green parity', () => {
    const report = syncStacks();
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('defaultStackRoot falls back to the cwd candidate when neither exists', () => {
    const rel = 'definitely-not-a-real-stack-dir-xyz';
    expect(defaultStackRoot(rel)).toBe(path.resolve(process.cwd(), rel));
  });

  test('defaultStackRoot finds the stacks from Optimizer (one level up)', () => {
    expect(fs.existsSync(path.join(defaultStackRoot('VQ 1'), 'vq-engine-runtime.js'))).toBe(true);
  });

  test('every parity manifest file exists in VQ 1 (the sync source)', () => {
    for (const rel of PARITY_FILES) {
      expect(fs.existsSync(path.join(process.cwd(), '..', 'VQ 1', rel))).toBe(true);
    }
  });
});
