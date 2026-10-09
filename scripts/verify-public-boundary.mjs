#!/usr/bin/env node
/**
 * Public-checkout boundary command wrapper.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { scanPublicBoundary } from '../native/public-boundary.js';

try {
  const result = await scanPublicBoundary();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.state !== 'clean') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
