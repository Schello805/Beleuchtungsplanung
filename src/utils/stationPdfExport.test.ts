// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { exportStationPdfs, MAX_STATION_PDF_BYTES, stationPdfPixelRatio } from './stationPdfExport';

const mocks = vi.hoisted(() => ({ sizes: [] as number[], image: vi.fn(), zipFile: vi.fn(), render: vi.fn() }));
vi.mock('html-to-image', () => ({ toCanvas: mocks.render }));
vi.mock('jspdf', () => ({ jsPDF: class {
  setFontSize() {}
  text() {}
  addImage() {}
  output() { return new ArrayBuffer(mocks.sizes.shift()!); }
} }));
vi.mock('jszip', () => ({ default: class {
  file = mocks.zipFile;
  async generateAsync() { return new Blob(); }
} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue({ width: 1680, height: 1100, toDataURL: mocks.image.mockReturnValue('data:image/jpeg;base64,test') });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

const item = () => ({ element: Object.assign(document.createElement('div'), {}), name: 'Verein', stationNumber: '42' });

it('limits raster resolution even on large displays', () => {
  expect(stationPdfPixelRatio(960, 600) * 960).toBe(1680);
  expect(stationPdfPixelRatio(3000, 2000) * 3000).toBeCloseTo(1680);
});

it('reduces JPEG quality when the actual PDF exceeds the mail size limit', async () => {
  mocks.sizes = [MAX_STATION_PDF_BYTES + 1, 500_000];
  await exportStationPdfs([item()], vi.fn());
  expect(mocks.image.mock.calls.map(call => call.slice(0, 2))).toEqual([['image/jpeg', 0.9], ['image/jpeg', 0.8]]);
  expect(mocks.zipFile.mock.calls[0][1].byteLength).toBe(500_000);
});

it('does not download oversized station PDFs', async () => {
  mocks.sizes = [4_000_000, 4_000_000, 4_000_000];
  await expect(exportStationPdfs([item()], vi.fn())).rejects.toThrow('überschreitet 3 MB');
  expect(mocks.zipFile).not.toHaveBeenCalled();
});
