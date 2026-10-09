/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Explicit local daily-report delivery. The caller selects the destination;
 * this module writes only the requested report artifact and never transmits it.
 */

import fs from 'fs/promises';

export const WORKSTATION_REPORT_DELIVERY_VERSION = 1;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const FORMATS = Object.freeze(['json', 'markdown']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function formatName(value) { const normalized = text(value)?.toLowerCase() || 'json'; if (!FORMATS.includes(normalized)) throw new Error(`Unsupported workstation report format: ${normalized}`); return normalized; }

export function formatWorkstationReport(report, format = 'json') {
  if (!record(report)) throw new TypeError('Workstation report is required');
  const normalized = formatName(format);
  if (normalized === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  const title = text(report.generatedAt) || 'unknown';
  return `# Daily Workstation Report\n\nGenerated: ${title}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

export function createWorkstationReportFileDelivery({ filePath, format = 'json', fsImpl = fs, maxBytes = MAX_REPORT_BYTES } = {}) {
  const path = text(filePath);
  if (!path) throw new TypeError('Workstation report output path is required');
  const normalized = formatName(format);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_REPORT_BYTES) throw new RangeError('Workstation report output limit is out of range');
  if (!fsImpl || typeof fsImpl.writeFile !== 'function') throw new TypeError('Workstation report output requires a file writer');
  async function deliver(report) {
    const content = formatWorkstationReport(report, normalized);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) throw new RangeError('Workstation report exceeds the output limit');
    await fsImpl.writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
    return Object.freeze({ version: WORKSTATION_REPORT_DELIVERY_VERSION, state: 'delivered', path, format: normalized, bytes });
  }
  return Object.freeze({ version: WORKSTATION_REPORT_DELIVERY_VERSION, path, format: normalized, deliver });
}
