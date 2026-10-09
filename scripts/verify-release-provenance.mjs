#!/usr/bin/env node
/**
 * Release provenance verification command.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { verifyReleaseProvenance } from './release-provenance.js';
import { pathToFileURL } from 'url';

export function runReleaseProvenance({ verify = verifyReleaseProvenance, write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value) } = {}) {
  try {
    const result = verify();
    write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    errorWrite(`${error.message}\n`);
    return 1;
  }
}

export function runIfEntrypoint({ entrypoint, run = runReleaseProvenance } = {}) {
  if (!entrypoint) return 0;
  return run();
}

export function setExitCode(code, target = process) {
  if (code !== 0) target.exitCode = code;
  return code;
}

export function isEntrypoint(moduleUrl, executablePath) {
  return moduleUrl === pathToFileURL(executablePath || '').href;
}

const entrypoint = isEntrypoint(import.meta.url, process.argv[1]);
setExitCode(runIfEntrypoint({ entrypoint }));
