import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkPcVq1,
  defaultVq1Root,
  formatReport
} from '../scripts/check-pc-vq1-completeness.js';

function write(root, relative) {
  const file = path.join(root, 'pc', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export default {};');
}

describe('VQ1 PC completeness', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vq1-pc-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('skips cleanly when VQ1 is not present', () => {
    const report = checkPcVq1({ stackRoot: path.join(root, 'missing') });
    expect(report.available).toBe(false);
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toMatch(/SKIPPED/);
  });

  test('handles an existing VQ1 root without a PC directory', () => {
    const report = checkPcVq1({ stackRoot: root });
    expect(report.available).toBe(false);
    expect(report.ok).toBe(true);
  });

  test('resolves a direct VQ1 root when the current working directory contains it', () => {
    const original = process.cwd();
    fs.mkdirSync(path.join(root, 'VQ 1'));
    try {
      process.chdir(root);
      expect(defaultVq1Root()).toBe(path.join(root, 'VQ 1'));
    } finally {
      process.chdir(original);
    }
  });

  test('uses the default root and reports a clean skip when no VQ1 root exists', () => {
    const original = process.cwd();
    try {
      process.chdir(root);
      const report = checkPcVq1();
      expect(report.available).toBe(false);
      expect(report.ok).toBe(true);
      expect(report.stackRoot).toBe(path.join(root, 'VQ 1'));
    } finally {
      process.chdir(original);
    }
  });

  test('accepts complete engine and turbo libraries', () => {
    write(root, 'engines/alpha/engine.js');
    write(root, 'engines/alpha/library.js');
    write(root, 'engines/alpha/turbos/one/turbo.js');
    write(root, 'engines/alpha/turbos/one/library.js');
    const report = checkPcVq1({
      stackRoot: root,
      expectedEngineCount: 1,
      expectedTurboCount: 1,
      expectedLibraryCount: 2
    });
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toMatch(/completeness OK/);
  });

  test('fails when an engine library is missing', () => {
    write(root, 'engines/alpha/engine.js');
    const report = checkPcVq1({
      stackRoot: root,
      expectedEngineCount: 1,
      expectedTurboCount: 0,
      expectedLibraryCount: 1
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(' ')).toMatch(/missing its library/);
  });

  test('reports engine, turbo, library, and turbo-library count mismatches', () => {
    write(root, 'engines/alpha/engine.js');
    write(root, 'engines/alpha/library.js');
    write(root, 'engines/alpha/turbos/one/turbo.js');
    const report = checkPcVq1({
      stackRoot: root,
      expectedEngineCount: 2,
      expectedTurboCount: 2,
      expectedLibraryCount: 4
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(' ')).toMatch(/engines/);
    expect(report.failures.join(' ')).toMatch(/turbos/);
    expect(report.failures.join(' ')).toMatch(/libraries/);
    expect(report.failures.join(' ')).toMatch(/turbos is missing/);
    expect(formatReport(report)).toMatch(/completeness FAILED/);
  });

  test('ignores non-file entries in the VQ1 PC tree', () => {
    write(root, 'engines/alpha/engine.js');
    write(root, 'engines/alpha/library.js');
    fs.symlinkSync(
      path.join(root, 'pc/engines/alpha/engine.js'),
      path.join(root, 'pc/ignored-link.js')
    );
    const report = checkPcVq1({
      stackRoot: root,
      expectedEngineCount: 1,
      expectedTurboCount: 0,
      expectedLibraryCount: 1
    });
    expect(report.ok).toBe(true);
    expect(report.inventory.files).not.toContain('ignored-link.js');
  });

  test('reports the real VQ1 inventory when the stack is available', () => {
    const realRoot = path.resolve(process.cwd(), '..', 'VQ 1');
    if (!fs.existsSync(path.join(realRoot, 'pc'))) return;
    const report = checkPcVq1({ stackRoot: realRoot });
    expect(report.ok).toBe(true);
    expect(report.inventory.engineCount).toBe(34);
    expect(report.inventory.turboCount).toBe(136);
    expect(report.inventory.libraryCount).toBe(170);
  });
});
