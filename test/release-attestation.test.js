/**
 * Release attestation tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { buildReleaseAttestation, hashReleaseArtifact, verifyReleaseAttestation } from '../scripts/release-attestation.js';
import { createAttestation, runAttestationEntrypoint } from '../scripts/create-release-attestation.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const provenance = { tag: 'v3.1.1', commit, signed: true };

describe('release artifact attestation', () => {
  test('builds a signed-tag-bound checksum record', async () => {
    const hashFileImpl = jest.fn(async (path) => `${hash}${path === 'two.zip' ? '' : ''}`);
    await expect(buildReleaseAttestation({ ...provenance, artifacts: ['one.zip', 'two.zip'], hashFileImpl, createdAt: '2026-10-09T00:00:00.000Z' })).resolves.toMatchObject({ version: 1, tag: 'v3.1.1', commit, signing: { verified: true }, artifacts: [{ path: 'one.zip', sha256: hash }, { path: 'two.zip', sha256: hash }] });
    expect(hashFileImpl).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid or unsigned records', async () => {
    await expect(buildReleaseAttestation({ ...provenance, signed: false, artifacts: ['one.zip'] })).rejects.toThrow('signed-tag');
    await expect(buildReleaseAttestation({ ...provenance, artifacts: [] })).rejects.toThrow('1 to 256');
    await expect(buildReleaseAttestation({ ...provenance, tag: 'main', artifacts: ['one.zip'] })).rejects.toThrow('vX.Y.Z');
    await expect(buildReleaseAttestation({ ...provenance, commit: 'short', artifacts: ['one.zip'] })).rejects.toThrow('full SHA');
    await expect(buildReleaseAttestation({ ...provenance, createdAt: 'invalid', artifacts: ['one.zip'] })).rejects.toThrow('createdAt');
    await expect(buildReleaseAttestation({ ...provenance, artifacts: ['one.zip', 'one.zip'] })).rejects.toThrow('unique');
    await expect(buildReleaseAttestation({ ...provenance, artifacts: [null] })).rejects.toThrow('unique');
    await expect(buildReleaseAttestation({ ...provenance, artifacts: ['one.zip'], hashFileImpl: async () => 'bad' })).rejects.toThrow('SHA-256');
  });

  test('verifies provenance and every artifact checksum', async () => {
    const attestation = await buildReleaseAttestation({ ...provenance, artifacts: ['one.zip'], hashFileImpl: async () => hash });
    const hashFileImpl = jest.fn(async () => hash);
    await expect(verifyReleaseAttestation(attestation, { hashFileImpl, provenanceVerifier: () => provenance })).resolves.toMatchObject({ state: 'verified', artifacts: [{ path: 'one.zip', sha256: hash }] });
    expect(hashFileImpl).toHaveBeenCalledTimes(1);
    await expect(verifyReleaseAttestation({ ...attestation, signing: { verified: false } }, { provenanceVerifier: () => provenance })).rejects.toThrow('unsigned');
    await expect(verifyReleaseAttestation(attestation, { hashFileImpl: async () => 'c'.repeat(64), provenanceVerifier: () => provenance })).rejects.toThrow('checksum mismatch');
    await expect(verifyReleaseAttestation(attestation, { hashFileImpl: async () => hash, provenanceVerifier: () => ({ ...provenance, tag: 'v3.1.2' }) })).rejects.toThrow('signed Git provenance');
    await expect(verifyReleaseAttestation({ ...attestation, artifacts: [{ path: 'one.zip', sha256: 'bad' }] }, { hashFileImpl: async () => hash, provenanceVerifier: () => provenance })).rejects.toThrow('checksum mismatch');
    await expect(verifyReleaseAttestation({ ...attestation, artifacts: [] }, { provenanceVerifier: () => provenance })).rejects.toThrow('1 to 256');
  });

  test('hashes explicit files and exposes the command adapter', async () => {
    await expect(hashReleaseArtifact('artifact.bin', { fsImpl: { readFile: jest.fn(async () => Buffer.from('data')) } })).resolves.toBe('3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7');
    await expect(hashReleaseArtifact('')).rejects.toThrow('path');
  });

  test('creates an attestation file and reports entrypoint errors', async () => {
    const writeFile = jest.fn(async () => {});
    const result = await createAttestation(['--output', 'attestation.json', '--artifact', 'one.zip'], { verify: () => provenance, writeFile, hashFileImpl: async () => hash });
    expect(result.signing.verified).toBe(true);
    expect(writeFile).toHaveBeenCalledWith('attestation.json', expect.stringContaining('one.zip'), 'utf8');
    await expect(createAttestation(['--output', 'out.json'], { verify: () => provenance })).rejects.toThrow('artifact');
    await expect(createAttestation(['--artifact', 'one.zip'], { verify: () => provenance })).rejects.toThrow('output');
    await expect(createAttestation(['--output', 'out.json', '--artifact', 'one.zip', '--bad'], { verify: () => provenance })).rejects.toThrow('Unsupported option');
    const write = jest.fn();
    const errorWrite = jest.fn();
    await expect(runAttestationEntrypoint({ entrypoint: false, write, errorWrite })).resolves.toBe(0);
    await expect(runAttestationEntrypoint({ entrypoint: true, argv: [], run: async () => { throw new Error('attestation failed'); }, write, errorWrite, target: {} })).resolves.toBe(1);
    expect(errorWrite).toHaveBeenCalledWith('attestation failed\n');
  });
});
