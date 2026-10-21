export const stationPdfFilename = (stationNumber: string, name: string, index: number) => {
  const clean = (value: string) => value.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 100);
  return `Station_${clean(stationNumber || `H${String(index + 1).padStart(2, '0')}`)}_${clean(name)}.pdf`;
};

export async function exportStationPdfs(items: Array<{ element: HTMLElement; stationNumber: string; name: string }>, onProgress: (done: number) => void) {
  const [{ toPng }, { jsPDF }, { default: JSZip }] = await Promise.all([
    import('html-to-image'), import('jspdf'), import('jszip')
  ]);
  const zip = new JSZip();
  await document.fonts.ready;
  for (const [index, item] of items.entries()) {
    const width = item.element.offsetWidth;
    const height = Math.max(item.element.scrollHeight, item.element.offsetHeight);
    const image = await toPng(item.element, {
      backgroundColor: '#ffffff', pixelRatio: 3, width, height,
      style: { height: `${height}px`, maxHeight: 'none', overflow: 'visible' }
    });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
    pdf.setFontSize(9);
    pdf.text(`Station ${item.stationNumber || `H${String(index + 1).padStart(2, '0')}`}`, 8, 8);
    const scale = Math.min(194 / width, 128 / height);
    pdf.addImage(image, 'PNG', 8, 13, width * scale, height * scale);
    // Prefix with sequence to prevent equal station numbers/names overwriting files.
    zip.file(`${String(index + 1).padStart(3, '0')}_${stationPdfFilename(item.stationNumber, item.name, index)}`, pdf.output('arraybuffer'));
    onProgress(index + 1);
  }
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Lichternacht_Stations-PDFs.zip';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
