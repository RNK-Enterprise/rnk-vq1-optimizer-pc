/**
 * Release provenance policy tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { defaultGitExec, validateReleaseProvenance, verifyReleaseProvenance } from '../scripts/release-provenance.js';

const commit = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);
const signedContents = 'object\n-----BEGIN PGP SIGNATURE-----\nsignature';

describe('release provenance', () => {
  test('rejects a missing provenance record before reading host state', () => {
    expect(() => validateReleaseProvenance(undefined)).toThrow('vX.Y.Z');
  });

  test('accepts an annotated signed tag pointing to the tested commit', () => {
    expect(validateReleaseProvenance({
      tag: 'v3.1.1',
      currentCommit: commit,
      taggedCommit: commit,
      tagType: 'tag',
      tagContents: signedContents
    })).toEqual({ tag: 'v3.1.1', commit, annotated: true, signed: true });
  });

  test('rejects invalid tag, commit, mismatch, lightweight, and unsigned inputs', () => {
    const base = { tag: 'v3.1.1', currentCommit: commit, taggedCommit: commit, tagType: 'tag', tagContents: signedContents };
    expect(() => validateReleaseProvenance({ ...base, tag: 'main' })).toThrow('vX.Y.Z');
    expect(() => validateReleaseProvenance({ ...base, currentCommit: 'short' })).toThrow('full SHA');
    expect(() => validateReleaseProvenance({ ...base, taggedCommit: otherCommit })).toThrow('tested commit');
    expect(() => validateReleaseProvenance({ ...base, tagType: 'commit' })).toThrow('annotated');
    expect(() => validateReleaseProvenance({ ...base, tagContents: 'unsigned' })).toThrow('PGP');
  });

  test('verifies repository values through fixed git commands', () => {
    const calls = [];
    const values = new Map([
      ['describe --tags --exact-match HEAD', 'v3.1.1\n'],
      ['rev-parse HEAD', `${commit}\n`],
      ['rev-list -1 v3.1.1^{commit}', `${commit}\n`],
      ['cat-file -t v3.1.1', 'tag\n'],
      ['cat-file -p v3.1.1', signedContents]
    ]);
    const exec = jest.fn((file, args) => {
      calls.push([file, args]);
      return values.get(args.join(' '));
    });
    expect(verifyReleaseProvenance({ env: {}, execFileSyncImpl: exec }).signed).toBe(true);
    expect(calls).toHaveLength(6);
    expect(exec).toHaveBeenCalledWith('git', ['cat-file', '-p', 'v3.1.1']);
    expect(exec).toHaveBeenCalledWith('git', ['verify-tag', 'v3.1.1']);
  });

  test('uses a supplied tag and rejects a tag that is not a release tag', () => {
    const exec = jest.fn();
    expect(() => verifyReleaseProvenance({ env: { GITHUB_REF_NAME: 'main' }, execFileSyncImpl: exec })).toThrow('vX.Y.Z');
    expect(exec).not.toHaveBeenCalled();
  });

  test('keeps the default git executor available for the release command', () => {
    expect(defaultGitExec(process.execPath, ['--version'])).toMatch(/^v\d+/);
    expect(() => validateReleaseProvenance({ tag: 'v3.1.1', currentCommit: commit, taggedCommit: commit, tagType: 'tag' })).toThrow('PGP');
    expect(() => validateReleaseProvenance()).toThrow('vX.Y.Z');
    expect(() => verifyReleaseProvenance({ env: {}, execFileSyncImpl: () => { throw new Error('no tag'); } })).toThrow('no tag');
  });
});
