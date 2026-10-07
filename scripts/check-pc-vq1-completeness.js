/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
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
 * VQ1 PC inventory gate.
 *
 * VQ1 is the PC optimizer stack. VQ2 is a separate Foundry surface and is
 * intentionally not inspected here. This check verifies the PC engine,
 * engine-library, and turbo inventory without requiring byte-identical files.
 */

import fs from 'fs';
import path from 'path';

export const EXPECTED_ENGINE_COUNT = 34;
export const EXPECTED_TURBO_COUNT = 136;
export const EXPECTED_LIBRARY_COUNT = EXPECTED_ENGINE_COUNT + EXPECTED_TURBO_COUNT;

export function defaultVq1Root() {
  const candidates = [
    path.resolve(process.cwd(), 'VQ 1'),
    path.resolve(process.cwd(), '..', 'VQ 1')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function filesUnder(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  };
  visit(root);
  return files.sort();
}

function inventory(files) {
  const engineFiles = files.filter((file) => /^engines\/[^/]+\/engine\.js$/.test(file));
  const engineLibraries = files.filter((file) => /^engines\/[^/]+\/library\.js$/.test(file));
  const turboFiles = files.filter((file) => /^engines\/[^/]+\/turbos\/[^/]+\/turbo\.js$/.test(file));
  const turboLibraries = files.filter((file) => /^engines\/[^/]+\/turbos\/[^/]+\/library\.js$/.test(file));
  const required = new Set([
    ...engineFiles.map((file) => file.replace(/engine\.js$/, 'library.js')),
    ...turboFiles.map((file) => file.replace(/turbo\.js$/, 'library.js'))
  ]);
  const missingLibraries = [...required].filter((file) => !files.includes(file)).sort();
  return {
    files,
    engineCount: engineFiles.length,
    engineLibraryCount: engineLibraries.length,
    turboCount: turboFiles.length,
    turboLibraryCount: turboLibraries.length,
    libraryCount: engineLibraries.length + turboLibraries.length,
    missingLibraries
  };
}

export function checkPcVq1(options = {}) {
  const stackRoot = options.stackRoot || defaultVq1Root();
  const pcRoot = path.join(stackRoot, 'pc');
  if (!fs.existsSync(stackRoot) || !fs.existsSync(pcRoot)) {
    return { available: false, ok: true, stackRoot, pcRoot, inventory: null, failures: [] };
  }

  const data = inventory(filesUnder(pcRoot));
  const expected = {
    engines: options.expectedEngineCount ?? EXPECTED_ENGINE_COUNT,
    turbos: options.expectedTurboCount ?? EXPECTED_TURBO_COUNT,
    libraries: options.expectedLibraryCount ?? EXPECTED_LIBRARY_COUNT
  };
  const failures = [];
  if (data.engineCount !== expected.engines) failures.push(`expected ${expected.engines} engines, found ${data.engineCount}`);
  if (data.turboCount !== expected.turbos) failures.push(`expected ${expected.turbos} turbos, found ${data.turboCount}`);
  if (data.libraryCount !== expected.libraries) failures.push(`expected ${expected.libraries} libraries, found ${data.libraryCount}`);
  if (data.engineLibraryCount !== data.engineCount) failures.push('one or more engines is missing its library.js');
  if (data.turboLibraryCount !== data.turboCount) failures.push('one or more turbos is missing its library.js');
  if (data.missingLibraries.length) failures.push(`missing libraries: ${data.missingLibraries.join(', ')}`);
  return { available: true, ok: failures.length === 0, stackRoot, pcRoot, inventory: data, failures };
}

export function formatReport(report) {
  if (!report.available) return 'VQ1 PC completeness SKIPPED: VQ1/pc is not present.';
  const { inventory: data } = report;
  const summary = `VQ1 PC inventory: ${data.engineCount} engines, ${data.libraryCount} libraries, ${data.turboCount} turbos`;
  if (report.ok) return `VQ1 PC completeness OK: ${summary}.`;
  return `${summary}.\nVQ1 PC completeness FAILED (${report.failures.length}):\n${report.failures.map((failure) => `  - ${failure}`).join('\n')}`;
}
