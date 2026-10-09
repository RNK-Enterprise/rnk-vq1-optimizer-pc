import {
  findCoverageFailures,
  isCoverageEntrypoint,
  runCoverageEntrypoint,
  setCoverageExitCode,
  verifyCoverageFile
} from '../scripts/verify-coverage.mjs';
import { fileURLToPath } from 'url';

function coverage(overrides = {}) {
  return {
    '/tmp/covered.js': {
      s: { 0: 1, 1: 2 },
      f: { 0: 1 },
      b: { 0: [1, 2] },
      statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
      ...overrides
    }
  };
}

describe('per-file coverage verifier', () => {
  test('accepts every covered statement, branch, function, and line', () => {
    expect(findCoverageFailures(coverage())).toEqual([]);
  });

  test('reports uncovered metrics without global compensation', () => {
    const failures = findCoverageFailures(coverage({ s: { 0: 1, 1: 0 }, f: { 0: 0 }, b: { 0: [1, 0] } }));
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'statements', uncovered: 1 }),
      expect.objectContaining({ metric: 'functions', uncovered: 1 }),
      expect.objectContaining({ metric: 'branches', uncovered: 1 })
    ]));
    expect(failures.some((failure) => failure.metric === 'lines')).toBe(true);
  });

  test('rejects missing coverage records and metric maps', () => {
    expect(findCoverageFailures({ '/tmp/missing.js': null })).toEqual([
      { filePath: '/tmp/missing.js', metric: 'file', reason: 'coverage record is missing' }
    ]);
    expect(findCoverageFailures({ '/tmp/empty.js': {} })).toHaveLength(4);
    expect(() => findCoverageFailures(null)).toThrow('Coverage data must be an object');
  });

  test('handles scalar branch counters and verifies valid coverage files', async () => {
    expect(findCoverageFailures(coverage({ b: { 0: 1 } }))).toEqual([]);
    expect(findCoverageFailures(coverage({ statementMap: { 0: { start: { line: 0 } }, 1: { start: { line: 2 } } } }))).toEqual([]);
    const fsImpl = { readFile: jest.fn().mockResolvedValue(JSON.stringify(coverage())) };
    await expect(verifyCoverageFile('/tmp/coverage.json', { fsImpl })).resolves.toMatchObject({ state: 'passed', files: 1 });
    expect(fsImpl.readFile).toHaveBeenCalledWith('/tmp/coverage.json', 'utf8');
  });

  test('reports invalid JSON, failed coverage, and read errors', async () => {
    await expect(verifyCoverageFile('/tmp/bad.json', { fsImpl: { readFile: jest.fn().mockResolvedValue('{') } })).rejects.toThrow('Coverage data is not valid JSON');
    await expect(verifyCoverageFile('/tmp/fail.json', { fsImpl: { readFile: jest.fn().mockResolvedValue(JSON.stringify(coverage({ s: { 0: 0, 1: 1 } })))} })).rejects.toThrow('Per-file coverage gate failed');
    await expect(verifyCoverageFile('/tmp/reason.json', { fsImpl: { readFile: jest.fn().mockResolvedValue(JSON.stringify({ '/tmp/missing.js': null })) } })).rejects.toThrow('/tmp/missing.js file: coverage record is missing');
    await expect(verifyCoverageFile('/tmp/missing.json', { fsImpl: { readFile: jest.fn().mockRejectedValue(new Error('missing')) } })).rejects.toThrow('missing');
  });

  test('runs and reports the CLI entrypoint without hiding failures', async () => {
    const output = [];
    const errors = [];
    expect(isCoverageEntrypoint(import.meta.url, '/tmp/other.js')).toBe(false);
    const moduleUrl = new URL('../scripts/verify-coverage.mjs', import.meta.url).href;
    expect(isCoverageEntrypoint(moduleUrl, fileURLToPath(moduleUrl))).toBe(true);
    expect(isCoverageEntrypoint(moduleUrl, undefined)).toBe(false);
    await expect(runCoverageEntrypoint({ entrypoint: false, filePath: '/tmp/coverage.json' })).resolves.toMatchObject({ state: 'skipped' });
    await expect(runCoverageEntrypoint()).resolves.toMatchObject({ state: 'skipped' });
    await expect(runCoverageEntrypoint({ entrypoint: true, filePath: '/tmp/coverage.json', verifier: async () => ({ files: 2 }), write: (value) => output.push(value) })).resolves.toMatchObject({ files: 2 });
    await expect(runCoverageEntrypoint({ entrypoint: true, filePath: '/tmp/coverage.json', verifier: async () => { throw new Error('gate'); }, writeError: (value) => errors.push(value) })).resolves.toMatchObject({ state: 'error', reason: 'gate' });
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runCoverageEntrypoint({ entrypoint: true, filePath: '/tmp/coverage.json', verifier: async () => ({ files: 0 }) })).resolves.toMatchObject({ files: 0 });
    await expect(runCoverageEntrypoint({ entrypoint: true, filePath: '/tmp/coverage.json', verifier: async () => { throw new Error('default-gate'); } })).resolves.toMatchObject({ state: 'error', reason: 'default-gate' });
    await expect(runCoverageEntrypoint({ entrypoint: true, filePath: '/tmp/no-such-coverage.json' })).resolves.toMatchObject({ state: 'error' });
    stderr.mockRestore();
    stdout.mockRestore();
    expect(output).toEqual(['Per-file coverage: 2 files at 100/100/100/100\n']);
    expect(errors).toEqual(['gate\n']);
    const target = { exitCode: 0 };
    expect(setCoverageExitCode({ state: 'passed' }, target)).toMatchObject({ state: 'passed' });
    expect(setCoverageExitCode({ state: 'error' }, target)).toMatchObject({ state: 'error' });
    expect(target.exitCode).toBe(1);
  });
});
