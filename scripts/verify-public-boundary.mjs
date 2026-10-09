#!/usr/bin/env node
/**
 * Public-checkout boundary command wrapper.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { scanPublicBoundary } from '../native/public-boundary.js';
import { pathToFileURL } from 'url';

export async function runPublicBoundary({ scan = scanPublicBoundary, write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value) } = {}) {
  try {
    const result = await scan();
    write(`${JSON.stringify(result)}\n`);
    return result.state === 'clean' ? 0 : 1;
  } catch (error) {
    errorWrite(`${error.message}\n`);
    return 1;
  }
}

export async function runIfEntrypoint({ entrypoint, run = runPublicBoundary } = {}) {
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
runIfEntrypoint({ entrypoint }).then((code) => setExitCode(code));
