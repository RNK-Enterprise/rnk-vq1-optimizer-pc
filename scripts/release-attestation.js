/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Release artifact checksums bound to a verified signed Git tag.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { verifyReleaseProvenance } from './release-provenance.js';

export const RELEASE_ATTESTATION_VERSION = 1;
const COMMIT = /^[0-9a-f]{40}$/i;
const TAG = /^v\d+\.\d+\.\d+$/;
const HASH = /^[a-f0-9]{64}$/;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function artifactList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) throw new TypeError('Release attestation requires 1 to 256 artifacts');
  const paths = value.map((item) => text(item)).filter(Boolean);
  if (paths.length !== value.length || new Set(paths).size !== paths.length) throw new Error('Release attestation artifact paths must be unique non-empty strings');
  return paths;
}
function requireIdentity(tag, commit) {
  if (!TAG.test(tag || '')) throw new Error('Release attestation tag must match vX.Y.Z');
  if (!COMMIT.test(commit || '')) throw new Error('Release attestation commit must be a full SHA-1 value');
}

export async function hashReleaseArtifact(filePath, { fsImpl = fs } = {}) {
  const target = text(filePath);
  if (!target) throw new TypeError('Release artifact path is required');
  const contents = await fsImpl.readFile(target);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

export async function buildReleaseAttestation({ tag, commit, artifacts, hashFileImpl = hashReleaseArtifact, createdAt = new Date().toISOString(), signed = false } = {}) {
  requireIdentity(tag, commit);
  if (signed !== true) throw new Error('Release attestation requires verified signed-tag evidence');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Release attestation createdAt is invalid');
  const paths = artifactList(artifacts);
  const checksums = await Promise.all(paths.map(async (path) => {
    const sha256 = String(await hashFileImpl(path)).toLowerCase();
    if (!HASH.test(sha256)) throw new Error(`Invalid SHA-256 for release artifact: ${path}`);
    return Object.freeze({ path, sha256 });
  }));
  return Object.freeze({ version: RELEASE_ATTESTATION_VERSION, tag, commit: commit.toLowerCase(), createdAt, signing: Object.freeze({ type: 'git-tag', verified: true }), artifacts: Object.freeze(checksums) });
}

export async function verifyReleaseAttestation(attestation, { hashFileImpl = hashReleaseArtifact, provenanceVerifier = verifyReleaseProvenance } = {}) {
  if (!attestation || attestation.version !== RELEASE_ATTESTATION_VERSION || !attestation.signing?.verified) throw new Error('Release attestation is unsigned or invalid');
  requireIdentity(attestation.tag, attestation.commit);
  const provenance = provenanceVerifier();
  if (!provenance?.signed || provenance.tag !== attestation.tag || provenance.commit !== attestation.commit.toLowerCase()) throw new Error('Release attestation does not match signed Git provenance');
  const artifacts = artifactList(attestation.artifacts?.map((item) => item?.path));
  const verified = [];
  for (const path of artifacts) {
    const entry = attestation.artifacts.find((item) => item.path === path);
    const actual = String(await hashFileImpl(path)).toLowerCase();
    if (!HASH.test(entry.sha256) || actual !== entry.sha256) throw new Error(`Release artifact checksum mismatch: ${path}`);
    verified.push(Object.freeze({ path, sha256: actual }));
  }
  return Object.freeze({ state: 'verified', tag: attestation.tag, commit: attestation.commit.toLowerCase(), artifacts: Object.freeze(verified) });
}
