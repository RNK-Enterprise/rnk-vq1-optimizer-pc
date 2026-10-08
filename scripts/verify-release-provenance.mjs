#!/usr/bin/env node
/**
 * Release provenance verification command.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { verifyReleaseProvenance } from './release-provenance.js';

try {
  const result = verifyReleaseProvenance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
