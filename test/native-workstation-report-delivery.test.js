import { createWorkstationReportFileDelivery, formatWorkstationReport, WORKSTATION_REPORT_DELIVERY_VERSION } from '../native/workstation-report-delivery.js';

const report = { generatedAt: '2026-10-08T12:00:00.000Z', storage: { latestFreeBytes: 5 } };

describe('native workstation report delivery', () => {
  test('formats explicit JSON, Markdown, and HTML artifacts', () => {
    expect(formatWorkstationReport(report)).toContain('"latestFreeBytes": 5');
    expect(formatWorkstationReport(report, 'json')).toMatch(/^\{/);
    expect(formatWorkstationReport(report, 'markdown')).toMatch(/^# Daily Workstation Report/);
    expect(formatWorkstationReport({ generatedAt: '<now>', storage: { latestFreeBytes: 5 }, memory: {}, thermals: {}, battery: {}, priorities: ['review&protect'] }, 'html')).toContain('&lt;now&gt;');
    const dashboard = formatWorkstationReport({ generatedAt: 'now', volumes: { latest: [{ mount: '<C:>', freeBytes: 5, usedBytes: null }] }, drives: { latestCount: 2, latestDegradedCount: 1, latestFailedCount: 0 }, network: { latestConnectionCount: 3, peakReceivedBytesPerSecond: 4, peakSentBytesPerSecond: 5 }, development: { contentionEvents: 1 }, gaming: { contentionEvents: 1 }, cleanup: { recoveredBytes: 6 }, policy: { state: 'review-required' } }, 'html');
    expect(dashboard).toContain('&lt;C:&gt;');
    expect(dashboard).toContain('review-required');
    const emptyDashboard = formatWorkstationReport({}, 'html');
    expect(emptyDashboard).toContain('<li>no-change</li>');
    expect(emptyDashboard).toContain('No volume evidence');
    expect(formatWorkstationReport({}, 'markdown')).toMatch(/Generated: unknown/);
    expect(() => formatWorkstationReport(null)).toThrow('required');
    expect(() => formatWorkstationReport(report, 'pdf')).toThrow('Unsupported');
    expect(() => formatWorkstationReport(report, '')).not.toThrow();
  });

  test('writes bounded local artifacts with explicit mode and receipt', async () => {
    const fsImpl = { writeFile: jest.fn().mockResolvedValue(undefined) };
    const delivery = createWorkstationReportFileDelivery({ filePath: '/tmp/report.md', format: 'markdown', fsImpl });
    expect(delivery).toMatchObject({ version: WORKSTATION_REPORT_DELIVERY_VERSION, path: '/tmp/report.md', format: 'markdown' });
    const receipt = await delivery.deliver(report);
    expect(receipt).toMatchObject({ state: 'delivered', path: '/tmp/report.md', format: 'markdown' });
    expect(fsImpl.writeFile).toHaveBeenCalledWith('/tmp/report.md', expect.stringContaining('# Daily Workstation Report'), { encoding: 'utf8', mode: 0o600 });
    const htmlDelivery = createWorkstationReportFileDelivery({ filePath: '/tmp/report.html', format: 'html', fsImpl });
    await expect(htmlDelivery.deliver({ generatedAt: 'now', priorities: [] })).resolves.toMatchObject({ state: 'delivered', format: 'html' });
    expect(() => createWorkstationReportFileDelivery()).toThrow('output path');
    expect(() => createWorkstationReportFileDelivery({ filePath: '/tmp/report', format: 'pdf' })).toThrow('Unsupported');
    expect(() => createWorkstationReportFileDelivery({ filePath: '/tmp/report', maxBytes: 1023 })).toThrow('output limit');
    expect(() => createWorkstationReportFileDelivery({ filePath: '/tmp/report', maxBytes: 10 * 1024 * 1024 + 1 })).toThrow('output limit');
    expect(() => createWorkstationReportFileDelivery({ filePath: '/tmp/report', fsImpl: {} })).toThrow('file writer');
  });

  test('fails closed on oversized and failed writes', async () => {
    const oversized = createWorkstationReportFileDelivery({ filePath: '/tmp/report', fsImpl: { writeFile: jest.fn() }, maxBytes: 1024 });
    await expect(oversized.deliver({ data: 'x'.repeat(2000) })).rejects.toThrow('exceeds');
    const failing = createWorkstationReportFileDelivery({ filePath: '/tmp/report', fsImpl: { writeFile: jest.fn().mockRejectedValue(new Error('denied')) } });
    await expect(failing.deliver(report)).rejects.toThrow('denied');
  });
});
