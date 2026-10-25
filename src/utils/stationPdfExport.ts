export const stationPdfFilename = (stationNumber: string, name: string, index: number) => {
  const clean = (value: string) => value.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 100);
  return `Station_${clean(stationNumber || `H${String(index + 1).padStart(2, '0')}`)}_${clean(name)}.pdf`;
};

// Roughly 220 dpi for the printable A5 area, independent of screen/device zoom.
export const stationPdfPixelRatio = (width: number, height: number) =>
  Math.min(3, 1680 / Math.max(width, height, 1));

export const MAX_STATION_PDF_BYTES = 3_000_000;

export async function exportStationPdfs(items: Array<{ element: HTMLElement; stationNumber: string; name: string }>, onProgress: (done: number) => void) {
  const [{ toCanvas }, { jsPDF }, { default: JSZip }] = await Promise.all([
    import('html-to-image'), import('jspdf'), import('jszip')
  ]);
  const zip = new JSZip();
  await document.fonts.ready;
  for (const [index, item] of items.entries()) {
    const width = item.element.offsetWidth;
    const height = Math.max(item.element.scrollHeight, item.element.offsetHeight);
    const canvas = await toCanvas(item.element, {
      backgroundColor: '#ffffff', pixelRatio: stationPdfPixelRatio(width, height), width, height,
      style: { height: `${height}px`, maxHeight: 'none', overflow: 'visible' }
    });
    const scale = Math.min(194 / width, 128 / height);
    let pdfBytes: ArrayBuffer | undefined;
    // JPEG avoids embedding the entire page as a large lossless RGB bitmap.
    // Check actual PDF bytes, including its metadata, before adding it to the ZIP.
    for (const quality of [0.9, 0.8, 0.7]) {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5', compress: true });
      pdf.setFontSize(9);
      pdf.text(`Station ${item.stationNumber || `H${String(index + 1).padStart(2, '0')}`}`, 8, 8);
      pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', 8, 13, width * scale, height * scale);
      pdfBytes = pdf.output('arraybuffer');
      if (pdfBytes.byteLength <= MAX_STATION_PDF_BYTES) break;
    }
    canvas.width = 0;
    canvas.height = 0;
    if (!pdfBytes || pdfBytes.byteLength > MAX_STATION_PDF_BYTES) {
      throw new Error(`Die PDF für „${item.name}“ überschreitet 3 MB. Bitte den Stationsumfang prüfen.`);
    }
    // Prefix with sequence to prevent equal station numbers/names overwriting files.
    zip.file(`${String(index + 1).padStart(3, '0')}_${stationPdfFilename(item.stationNumber, item.name, index)}`, pdfBytes);
    onProgress(index + 1);
  }
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Lichternacht_Stations-PDFs.zip';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
