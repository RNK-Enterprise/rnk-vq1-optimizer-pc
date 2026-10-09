#!/usr/bin/env node
/**
 * Create a checksum attestation for a verified signed release tag.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import { buildReleaseAttestation } from './release-attestation.js';
import { verifyReleaseProvenance } from './release-provenance.js';

function parseArgs(argv) {
  const values = { artifacts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--artifact') values.artifacts.push(argv[++index]);
    else if (item === '--output') values.output = argv[++index];
    else throw new Error(`Unsupported option: ${item}`);
  }
  return values;
}

export async function createAttestation(argv = process.argv.slice(2), { verify = verifyReleaseProvenance, writeFile = fs.writeFile, hashFileImpl } = {}) {
  const args = parseArgs(argv);
  if (typeof args.output !== 'string' || args.artifacts.length === 0) throw new Error('--output and at least one --artifact are required');
  const provenance = verify();
  const attestation = await buildReleaseAttestation({ tag: provenance.tag, commit: provenance.commit, signed: provenance.signed, artifacts: args.artifacts, ...(hashFileImpl ? { hashFileImpl } : {}) });
  await writeFile(args.output, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
  return attestation;
}

export async function runAttestationEntrypoint({ entrypoint, run = createAttestation, argv = process.argv.slice(2), write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value), target = process } = {}) {
  if (!entrypoint) return 0;
  try { const result = await run(argv); write(`${JSON.stringify(result)}\n`); return 0; } catch (error) { errorWrite(`${error.message}\n`); target.exitCode = 1; return 1; }
}

runAttestationEntrypoint({ entrypoint: process.argv[1]?.endsWith('create-release-attestation.mjs') });
