/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 *
 * Stack parity checker - verifies that VQ 1 and VQ 2 keep their shared
 * module files byte-identical on disk.
 *
 * The two stacks are deployed as differentiated units of one logical
 * cluster, but the core modules (engine runtime, cluster auth, docs,
 * launchers) must stay in lockstep: a fix applied to one stack must be
 * synced to the other. The unit servers are INTENTIONALLY divergent
 * (identity, role, ports, specialty) and are checked for presence only.
 *
 * Pure module (no I/O at import time, roots injectable) so Jest can unit
 * test it with fixture directories; scripts/check-stack-parity.js is the
 * CLI wrapper for shell/CI use.
 */

import fs from 'fs';
import path from 'path';

/**
 * Files that MUST stay byte-identical between the two stacks.
 * Shared modules, cluster docs and launch scripts.
 */
export const PARITY_FILES = [
  'vq-engine-runtime.js',
  'vq-cluster-auth.js',
  'TANDEM_CLUSTER.md',
  'start-vq-unit.sh',
  'start-vq-unit.ps1',
  // Stack-side contract-test wiring (consumes @rnk/vq-contract-tests)
  'jest.contract.config.js',
  'tests/contract/vq-contract.test.js',
  '.browserslistrc'
];

/**
 * Files that must exist in BOTH stacks but are expected (and allowed) to
 * differ: the differentiated unit identities.
 */
export const PRESENCE_FILES = [
  'vq-unit-server.js',
  'package.json'
];

/**
 * Compare one relative path across two stack roots.
 * @param {string} stackA absolute or project-relative root of VQ 1
 * @param {string} stackB absolute or project-relative root of VQ 2
 * @param {string} rel relative file path
 * @returns {{ status: 'identical'|'divergent'|'missing-a'|'missing-b'|'missing-both', detail?: string }}
 */
function compareFile(stackA, stackB, rel) {
  const pathA = path.join(stackA, rel);
  const pathB = path.join(stackB, rel);
  const existsA = fs.existsSync(pathA);
  const existsB = fs.existsSync(pathB);
  if (!existsA && !existsB) return { status: 'missing-both' };
  if (!existsA) return { status: 'missing-a', detail: pathA };
  if (!existsB) return { status: 'missing-b', detail: pathB };

  const bufA = fs.readFileSync(pathA);
  const bufB = fs.readFileSync(pathB);
  if (bufA.equals(bufB)) return { status: 'identical' };
  return {
    status: 'divergent',
    detail: `${rel} differs between stacks (${bufA.length} vs ${bufB.length} bytes) - sync the fix across both stacks`
  };
}

/**
 * Run the full parity check.
 * @param {{ stackRoot1?: string, stackRoot2?: string,
 *           parityFiles?: string[], presenceFiles?: string[] }} [options]
 *   stackRoot1/2: stack roots (default: real VQ 1/VQ 2 found from cwd).
 *   parityFiles/presenceFiles: manifest overrides (fixture tests pass tiny
 *   custom lists instead of the full real manifest).
 * @returns {{ ok: boolean, failures: string[], results: object[] }}
 */
/**
 * Locate a stack directory from the cwd: the CLI and Jest both run with
 * cwd = Optimizer/, but the script may also be invoked from the project
 * root. Avoids import.meta (breaks under Jest's CJS transform) and URL
 * pathname encoding (spaces in paths).
 */
export function defaultStackRoot(rel) {
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function checkParity(options = {}) {
  const stackA = options.stackRoot1 || defaultStackRoot('VQ 1');
  const stackB = options.stackRoot2 || defaultStackRoot('VQ 2');
  const parityFiles = options.parityFiles || PARITY_FILES;
  const presenceFiles = options.presenceFiles || PRESENCE_FILES;

  const failures = [];
  const results = [];

  const record = (rel, required, cmp) => {
    const { status, detail } = cmp;
    results.push({ rel, kind: required ? 'parity' : 'presence', status });
    if (status === 'missing-both') {
      failures.push(`${rel} is missing from BOTH stacks`);
    } else if (status === 'missing-a' || status === 'missing-b') {
      failures.push(`${rel} is missing from one stack (${detail})`);
    } else if (required && status === 'divergent') {
      failures.push(detail);
    }
  };

  for (const rel of parityFiles) {
    record(rel, true, compareFile(stackA, stackB, rel));
  }
  for (const rel of presenceFiles) {
    record(rel, false, compareFile(stackA, stackB, rel));
  }

  return { ok: failures.length === 0, failures, results };
}

/** Human-readable summary for the CLI. */
export function formatReport({ ok, failures, results }) {
  const lines = results.map((r) => {
    const icon = r.status === 'identical' ? 'IDENTICAL'
      : r.status === 'divergent' ? 'DIVERGENT'
        : r.status.startsWith('missing') ? 'MISSING'
          : r.status.toUpperCase();
    return `  ${icon.padEnd(10)} ${r.rel}${r.kind === 'presence' ? '  (presence-only)' : ''}`;
  });
  lines.push('');
  if (ok) {
    lines.push('Stack parity OK: shared modules are byte-identical, differentiated files present.');
  } else {
    lines.push(`Stack parity FAILED (${failures.length}):`);
    for (const f of failures) lines.push(`  - ${f}`);
  }
  return lines.join('\n');
}
