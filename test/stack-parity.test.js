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
 * Stack-parity tests:
 *  1. The REAL VQ 1 / VQ 2 trees pass the parity check (this is the
 *     actual guard - red CI means someone broke sync).
 *  2. The checker itself detects divergence and missing files against
 *     fixture directories, so the guard cannot rot silently.
 *  3. Meta-guard: the manifest must only list files that actually exist
 *     in both real stacks, so renamed/deleted files cannot drift past.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkParity, formatReport, defaultStackRoot, PARITY_FILES, PRESENCE_FILES } from '../scripts/stack-parity.js';

const HERE = process.cwd();
const ROOT = fs.existsSync(path.join(HERE, 'VQ 1')) ? HERE : path.resolve(HERE, '..');
const VQ1 = path.join(ROOT, 'VQ 1');
const VQ2 = path.join(ROOT, 'VQ 2');

function makeStackDir(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(base, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

describe('real stacks parity (the actual guard)', () => {
  test('VQ 1 and VQ 2 shared modules are byte-identical on disk', () => {
    const report = checkParity();
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    for (const r of report.results) {
      if (r.kind === 'parity') expect(r.status).toBe('identical');
      else expect(['identical', 'divergent']).toContain(r.status);
    }
  });
});

describe('checker behavior against fixture stacks', () => {
  let tmpBase = null;
  let a = null;
  let b = null;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-parity-'));
    a = path.join(tmpBase, 'A');
    b = path.join(tmpBase, 'B');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  const PARITY = ['mod.js'];
  const opts = (extra = {}) => ({
    stackRoot1: a,
    stackRoot2: b,
    parityFiles: PARITY,
    presenceFiles: [],
    ...extra
  });

  test('identical fixtures pass', () => {
    makeStackDir(a, { 'mod.js': 'same' });
    makeStackDir(b, { 'mod.js': 'same' });
    expect(checkParity(opts()).ok).toBe(true);
  });

  test('byte divergence in a parity file fails with a sync hint', () => {
    makeStackDir(a, { 'mod.js': 'version-one' });
    makeStackDir(b, { 'mod.js': 'version-two' });
    const report = checkParity(opts());
    expect(report.ok).toBe(false);
    expect(report.failures[0]).toMatch(/mod\.js differs between stacks/);
    expect(report.failures[0]).toMatch(/sync the fix across both stacks/);
    expect(report.results[0]).toEqual({ rel: 'mod.js', kind: 'parity', status: 'divergent' });
  });

  test('presence-only files may diverge without failing', () => {
    makeStackDir(a, { 'mod.js': 'same', 'unit.js': 'UNIT_ID=VQ-1' });
    makeStackDir(b, { 'mod.js': 'same', 'unit.js': 'UNIT_ID=VQ-2' });
    const report = checkParity(opts({ presenceFiles: ['unit.js'] }));
    expect(report.ok).toBe(true);
    const presence = report.results.find((r) => r.rel === 'unit.js');
    expect(presence.status).toBe('divergent');
    expect(presence.kind).toBe('presence');
  });

  test('missing from one stack fails even for presence-only files', () => {
    makeStackDir(a, { 'mod.js': 'same', 'unit.js': 'x' });
    makeStackDir(b, { 'mod.js': 'same' });
    const report = checkParity(opts({ presenceFiles: ['unit.js'] }));
    expect(report.ok).toBe(false);
    expect(report.failures[0]).toMatch(/missing from one stack/);
  });

  test('missing from one stack fails when VQ 1 lacks the file', () => {
    makeStackDir(a, { 'mod.js': 'same' });
    makeStackDir(b, { 'mod.js': 'same', 'unit.js': 'x' });
    const report = checkParity(opts({ presenceFiles: ['unit.js'] }));
    expect(report.ok).toBe(false);
    expect(report.failures[0]).toMatch(/missing from one stack/);
  });

  test('missing from both stacks is reported distinctly', () => {
    makeStackDir(a, { 'mod.js': 'same' });
    makeStackDir(b, { 'mod.js': 'same' });
    const report = checkParity(opts({ parityFiles: ['mod.js', 'gone.js'] }));
    expect(report.ok).toBe(false);
    expect(report.failures[0]).toMatch(/missing from BOTH stacks/);
  });

  test('defaultStackRoot falls back when neither candidate exists', () => {
    const rel = 'definitely-not-a-real-stack-dir-optimizer-xyz';
    expect(defaultStackRoot(rel)).toBe(path.resolve(process.cwd(), rel));
  });

  test('formatReport renders statuses and an OK summary', () => {
    makeStackDir(a, { 'mod.js': 'same', 'unit.js': 'A' });
    makeStackDir(b, { 'mod.js': 'same', 'unit.js': 'B' });
    const text = formatReport(checkParity(opts({ presenceFiles: ['unit.js'] })));
    expect(text).toMatch(/Stack parity OK/);
    expect(text).toMatch(/IDENTICAL\s+mod\.js/);
    expect(text).toMatch(/unit\.js\s+\(presence-only\)/);
  });

  test('formatReport renders missing statuses', () => {
    makeStackDir(a, { 'mod.js': 'same' });
    makeStackDir(b, { 'mod.js': 'same' });
    const text = formatReport(checkParity(opts({ parityFiles: ['mod.js', 'gone.js'] })));
    expect(text).toMatch(/MISSING\s+gone\.js/);
    expect(text).toMatch(/Stack parity FAILED \(1\)/);
  });

  test('formatReport renders unknown statuses using their uppercase label', () => {
    const text = formatReport({ ok: true, failures: [], results: [{ rel: 'unknown.js', kind: 'parity', status: 'unexpected' }] });
    expect(text).toMatch(/UNEXPECTED\s+unknown\.js/);
    expect(text).toMatch(/Stack parity OK/);
  });

  test('formatReport renders failures when parity breaks', () => {
    makeStackDir(a, { 'mod.js': 'one', 'unit.js': 'A' });
    makeStackDir(b, { 'mod.js': 'two', 'unit.js': 'B' });
    const text = formatReport(checkParity(opts({ presenceFiles: ['unit.js'] })));
    expect(text).toMatch(/Stack parity FAILED \(1\)/);
    expect(text).toMatch(/mod\.js differs between stacks/);
  });
});

describe('manifest integrity (meta-guard)', () => {
  test('every manifest file exists in both real stacks', () => {
    for (const rel of [...PARITY_FILES, ...PRESENCE_FILES]) {
      expect(fs.existsSync(path.join(VQ1, rel))).toBe(true);
      expect(fs.existsSync(path.join(VQ2, rel))).toBe(true);
    }
  });

  test('parity and presence lists do not overlap', () => {
    const overlap = PARITY_FILES.filter((f) => PRESENCE_FILES.includes(f));
    expect(overlap).toEqual([]);
  });
});
