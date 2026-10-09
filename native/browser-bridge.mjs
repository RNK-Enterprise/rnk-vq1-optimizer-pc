#!/usr/bin/env node
/**
 * Native messaging host entrypoint.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { pathToFileURL } from 'url';
import { runBrowserBridge } from './browser-bridge.js';

export function isBrowserBridgeEntrypoint(moduleUrl, executablePath) {
  return moduleUrl === pathToFileURL(executablePath || '').href;
}

export function runIfBrowserBridgeEntrypoint(options) {
  const { entrypoint, run = runBrowserBridge, runOptions } = options || {};
  return entrypoint ? run(runOptions) : Promise.resolve({ state: 'skipped' });
}

export async function runBrowserBridgeEntrypoint(options) {
  const { entrypoint, run, runOptions, write } = options || {};
  try {
    return await runIfBrowserBridgeEntrypoint({ entrypoint, run, runOptions });
  } catch (error) {
    write?.(`${error.message}\n`);
    return { state: 'error', reason: error.message };
  }
}

export function setBrowserBridgeExitCode(result, target = process) {
  if (result?.state === 'error') target.exitCode = 1;
  return result;
}

export function runBrowserBridgeProcess(options) {
  const { input, output } = options || {};
  return runBrowserBridge({ input, output });
}

export function writeBrowserBridgeError(value, output) {
  return output.write(value);
}

const entrypoint = isBrowserBridgeEntrypoint(import.meta.url, process.argv[1]);
runBrowserBridgeEntrypoint({
  entrypoint,
  run: runBrowserBridgeProcess,
  runOptions: { input: process.stdin, output: process.stdout },
  write: writeBrowserBridgeError
}).then((result) => setBrowserBridgeExitCode(result));

