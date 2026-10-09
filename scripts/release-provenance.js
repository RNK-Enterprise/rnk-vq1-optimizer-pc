/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Release provenance policy. The CLI wrapper is intentionally separate so
 * these policy decisions can be covered without trusting a floating branch.
 */

import { execFileSync } from 'child_process';

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/i;
const SIGNATURE_MARKER = '-----BEGIN PGP SIGNATURE-----';

export function defaultGitExec(file, args) {
  return execFileSync(file, args, { encoding: 'utf8' });
}

export function validateReleaseProvenance(input) {
  const { tag, currentCommit, taggedCommit, tagType, tagContents } = input && typeof input === 'object' ? input : {};
  if (typeof tag !== 'string' || !RELEASE_TAG.test(tag)) throw new Error('release tag must match vX.Y.Z');
  if (!COMMIT.test(currentCommit) || !COMMIT.test(taggedCommit)) throw new Error('release commits must be full SHA-1 values');
  if (currentCommit.toLowerCase() !== taggedCommit.toLowerCase()) throw new Error('release tag does not point to the tested commit');
  if (tagType !== 'tag') throw new Error('release tag must be annotated');
  if (typeof tagContents !== 'string' || !tagContents.includes(SIGNATURE_MARKER)) {
    throw new Error('release tag must contain a PGP signature');
  }
  return { tag, commit: currentCommit.toLowerCase(), annotated: true, signed: true };
}

export function verifyReleaseProvenance({
  env = process.env,
  execFileSyncImpl
} = {}) {
  const exec = execFileSyncImpl || defaultGitExec;
  const tag = env.GITHUB_REF_NAME || exec('git', ['describe', '--tags', '--exact-match', 'HEAD']).trim();
  if (!RELEASE_TAG.test(tag)) throw new Error('release tag must match vX.Y.Z');
  const currentCommit = exec('git', ['rev-parse', 'HEAD']).trim();
  const taggedCommit = exec('git', ['rev-list', '-1', `${tag}^{commit}`]).trim();
  const tagType = exec('git', ['cat-file', '-t', tag]).trim();
  const tagContents = exec('git', ['cat-file', '-p', tag]);
  exec('git', ['verify-tag', tag]);
  return validateReleaseProvenance({ tag, currentCommit, taggedCommit, tagType, tagContents });
}
