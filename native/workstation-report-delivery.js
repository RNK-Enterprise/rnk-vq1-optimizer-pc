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
const FORMATS = Object.freeze(['json', 'markdown', 'html']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function formatName(value) { const normalized = text(value)?.toLowerCase() || 'json'; if (!FORMATS.includes(normalized)) throw new Error(`Unsupported workstation report format: ${normalized}`); return normalized; }
function html(value) { return String(value ?? 'unknown').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function metric(value, suffix = '') { return value === null || value === undefined ? 'unknown' : `${html(value)}${html(suffix)}`; }
function tableRows(items, columns, emptyText) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return `<tr><td colspan="${columns.length}">${html(emptyText)}</td></tr>`;
  return rows.map((item) => `<tr>${columns.map((column) => `<td>${metric(item?.[column.key], column.suffix)}</td>`).join('')}</tr>`).join('');
}
function htmlReport(report) {
  const storage = record(report.storage) ? report.storage : {};
  const memory = record(report.memory) ? report.memory : {};
  const thermals = record(report.thermals) ? report.thermals : {};
  const battery = record(report.battery) ? report.battery : {};
  const drives = record(report.drives) ? report.drives : {};
  const volumes = record(report.volumes) ? report.volumes : {};
  const network = record(report.network) ? report.network : {};
  const development = record(report.development) ? report.development : {};
  const gaming = record(report.gaming) ? report.gaming : {};
  const cleanup = record(report.cleanup) ? report.cleanup : {};
  const policy = record(report.policy) ? report.policy : {};
  const volumeRows = tableRows(volumes.latest, [
    { key: 'mount' },
    { key: 'freeBytes', suffix: ' bytes' },
    { key: 'usedBytes', suffix: ' bytes' }
  ], 'No volume evidence');
  const driveRows = tableRows(drives.latest, [
    { key: 'device' },
    { key: 'model' },
    { key: 'mediaType' },
    { key: 'health' }
  ], 'No drive evidence');
  const priorities = Array.isArray(report.priorities) ? report.priorities.filter((item) => typeof item === 'string').slice(0, 3) : [];
  const items = priorities.length ? priorities.map((item) => `<li>${html(item)}</li>`).join('') : '<li>no-change</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily Workstation Report</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;background:#f5f7fb;color:#172033}main{display:grid;gap:1rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}.card{background:#fff;border:1px solid #dbe2ee;border-radius:.7rem;padding:1rem}.label{color:#56637a;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em}ul{margin:.5rem 0 0;padding-left:1.2rem}table{border-collapse:collapse;width:100%;margin-top:.5rem}th,td{text-align:left;border-bottom:1px solid #dbe2ee;padding:.45rem}th{color:#56637a;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em}pre{background:#101827;color:#d7e2f2;padding:1rem;overflow:auto;border-radius:.7rem}</style></head><body><main><header><h1>Daily Workstation Report</h1><p>Generated: ${html(report.generatedAt)}</p></header><section class="cards"><article class="card"><div class="label">Storage free</div><div>${metric(storage.latestFreeBytes, ' bytes')}</div></article><article class="card"><div class="label">Memory peak</div><div>${metric(memory.peakUsedPercent, '%')}</div></article><article class="card"><div class="label">Peak thermal</div><div>${metric(thermals.peakTemperatureC, ' C')}</div></article><article class="card"><div class="label">Battery health</div><div>${metric(battery.minimumHealthPercent, '%')}</div></article></section><section class="card"><div class="label">Top priorities</div><ul>${items}</ul></section><section class="card"><div class="label">Storage volumes</div><table><thead><tr><th>Mount</th><th>Free</th><th>Used</th></tr></thead><tbody>${volumeRows}</tbody></table></section><section class="card"><div class="label">Drives</div><table><thead><tr><th>Device</th><th>Model</th><th>Media</th><th>Health</th></tr></thead><tbody>${driveRows}</tbody></table></section><section class="card"><div class="label">System evidence</div><table><tbody><tr><th>Drives observed</th><td>${metric(drives.latestCount)}</td></tr><tr><th>Degraded drives</th><td>${metric(drives.latestDegradedCount)}</td></tr><tr><th>Failed drives</th><td>${metric(drives.latestFailedCount)}</td></tr><tr><th>Network connections</th><td>${metric(network.latestConnectionCount)}</td></tr><tr><th>Peak receive rate</th><td>${metric(network.peakReceivedBytesPerSecond, ' bytes/s')}</td></tr><tr><th>Peak send rate</th><td>${metric(network.peakSentBytesPerSecond, ' bytes/s')}</td></tr><tr><th>Development contention</th><td>${metric(development.contentionEvents)}</td></tr><tr><th>Gaming contention</th><td>${metric(gaming.contentionEvents)}</td></tr><tr><th>Cleanup recovered</th><td>${metric(cleanup.recoveredBytes, ' bytes')}</td></tr><tr><th>Policy state</th><td>${metric(policy.state)}</td></tr></tbody></table></section><details><summary>Full report data</summary><pre>${html(JSON.stringify(report, null, 2))}</pre></details></main></body></html>\n`;
}

export function formatWorkstationReport(report, format = 'json') {
  if (!record(report)) throw new TypeError('Workstation report is required');
  const normalized = formatName(format);
  if (normalized === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (normalized === 'html') return htmlReport(report);
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
