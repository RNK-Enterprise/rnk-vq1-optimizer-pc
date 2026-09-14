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
 * Stack sync helper - copies changed shared files from VQ 1 into VQ 2
 * (the canonical stack) so the parity manifest stays satisfied without
 * manual `cp` bookkeeping.
 *
 * Model: VQ 1 is the source of truth for every file in the parity
 * manifest (Optimizer/scripts/stack-parity.js PARITY_FILES). VQ 2
 * deliberately divergent files (PRESENCE_FILES: vq-unit-server.js,
 * package.json) are NEVER touched. A reverse direction exists for the
 * rare case VQ 2 was edited first.
 *
 * Safety properties:
 *   - only files in the parity manifest are ever copied
 *   - nothing is deleted, ever (a file missing from the target stays
 *     missing; a file missing from the SOURCE is reported, not removed
 *     from the target)
 *   - --dry-run prints the plan and writes nothing
 *   - byte-exact copies (contents + mtime), so the parity check reads
 *     truly identical files
 *
 * Pure module (I/O only inside functions, roots/manifest injectable) so
 * Jest can exercise it against fixture directories; the CLI wrapper is
 * scripts/sync-stacks-cli.js. Companion to checkParity(): parity detects
 * drift, this repairs it in one direction.
 */

import fs from 'fs';
import path from 'path';
import { PARITY_FILES } from './stack-parity.js';

/** Same cwd-based resolver as stack-parity.js (no import.meta: it breaks
 *  under Jest's CJS transform; no URL pathname: spaces in the path).
 *  Exported for direct testing of the not-found fallback. */
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

/**
 * Plan (and optionally execute) the sync of parity files VQ 1 -> VQ 2.
 * @param {{ stackRoot1?: string, stackRoot2?: string,
 *           files?: string[], dryRun?: boolean,
 *           reverse?: boolean }} [options]
 *   stackRoot1/2: stack roots (default: real VQ 1/VQ 2 found from cwd).
 *   files: manifest override for fixture tests.
 *   dryRun: compute the plan, copy nothing.
 *   reverse: copy VQ 2 -> VQ 1 instead of the default VQ 1 -> VQ 2.
 * @returns {{ ok: boolean, actions: object[], errors: string[] }}
 *   actions: one entry per changed/created file
 *   ({ rel, action: 'copied'|'created', from, to }).
 *   ok is false only on real problems (e.g. missing source file).
 */
export function syncStacks(options = {}) {
  const sourceRoot = options.stackRoot1 || defaultStackRoot('VQ 1');
  const targetRoot = options.stackRoot2 || defaultStackRoot('VQ 2');
  const files = options.files || PARITY_FILES;
  const dryRun = options.dryRun === true;
  const [fromRoot, toRoot] = options.reverse
    ? [targetRoot, sourceRoot]
    : [sourceRoot, targetRoot];

  const actions = [];
  const errors = [];

  for (const rel of files) {
    const from = path.join(fromRoot, rel);
    const to = path.join(toRoot, rel);

    if (!fs.existsSync(from)) {
      // Never delete: a target file whose source went missing is
      // reported and left alone.
      if (fs.existsSync(to)) {
        errors.push(`${rel} missing from source (${from}); left untouched in target`);
      }
      continue;
    }

    const fromBuf = fs.readFileSync(from);
    let needsCopy = false;
    let action = 'copied';

    if (fs.existsSync(to)) {
      const toBuf = fs.readFileSync(to);
      needsCopy = !toBuf.equals(fromBuf);
    } else {
      needsCopy = true;
      action = 'created';
    }

    if (!needsCopy) continue;

    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      // Byte-exact parity: align mtime so timestamp-sensitive tooling
      // also agrees (contents are what the parity gate checks).
      const stat = fs.statSync(from);
      fs.utimesSync(to, stat.atime, stat.mtime);
    }

    actions.push({ rel, action, from, to });
  }

  return { ok: errors.length === 0, actions, errors };
}

/** Human-readable summary for the CLI. */
export function formatSyncReport(
  { ok, actions, errors },
  { reverse = false, dryRun = false } = {}
) {
  const dir = reverse ? 'VQ 2 -> VQ 1' : 'VQ 1 -> VQ 2';
  const lines = [dryRun ? `Stack sync plan (${dir}, dry-run):` : `Stack sync (${dir}):`];

  if (actions.length === 0 && errors.length === 0) {
    lines.push('  up-to-date - no shared file differs from the source stack.');
  } else {
    for (const a of actions) {
      lines.push(`  ${a.action.padEnd(7)} ${a.rel}`);
    }
    for (const e of errors) lines.push(`  SKIPPED  ${e}`);
  }

  lines.push('');
  if (dryRun) {
    lines.push(`Dry run: nothing written. ${actions.length} file(s) would be updated.`);
  } else if (ok) {
    lines.push(`Done: ${actions.length} file(s) synced. Presence-only files (vq-unit-server.js, package.json) are never touched.`);
  } else {
    lines.push(`Finished with ${errors.length} problem(s) - see SKIPPED entries above.`);
  }
  return lines.join('\n');
}
