import * as XLSX from 'xlsx';
import type { Section, Helper } from './api';

/**
 * Exports all sections, helper assignments, and material calculations
 * into a rich, multi-sheet Microsoft Excel (.xlsx) workbook.
 */
export function exportSectionsToExcel(
  sections: Section[],
  helpers: Helper[],
  candleSpacing: number = 2.0,
  candleBuffer: number = 10
): void {
  const wb = XLSX.utils.book_new();
  const dateStr = new Date().toISOString().slice(0, 10);

  // ----------------------------------------------------
  // SHEET 1: Strecken- & Helferplan (Detail-Einteilung)
  // ----------------------------------------------------
  const sectionsHeaders = [
    'Nr.',
    'Bezeichnung',
    'Straße',
    'Länge (m)',
    'Lichter (ca. Stk.)',
    'Typ',
    'Zugewiesener Helfer',
    'Telefon Helfer',
    'Status',
    'Notizen / Besonderheiten'
  ];

  const sectionsRows = sections.map((sec, idx) => {
    const helper = helpers.find(h => h.id === sec.assigned_helper_id);
    const length = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
    const candles = sec.type === 'point' ? 20 : (length > 0 ? Math.max(1, Math.round(length / candleSpacing)) : 0);
    const isAssigned = !!sec.assigned_helper_id;

    return [
      idx + 1,
      sec.label || `Abschnitt ${idx + 1}`,
      sec.street_name || '',
      length,
      candles,
      sec.type === 'point' ? 'Einzelpunkt' : 'Straßenlinie',
      sec.assigned_helper_name || (isAssigned ? 'Zugewiesen' : 'Nicht zugewiesen'),
      helper?.phone || '',
      isAssigned ? 'Besetzt' : 'Offen',
      sec.notes || ''
    ];
  });

  const wsSections = XLSX.utils.aoa_to_sheet([sectionsHeaders, ...sectionsRows]);
  wsSections['!cols'] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 24 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 26 },
    { wch: 18 },
    { wch: 12 },
    { wch: 32 }
  ];
  XLSX.utils.book_append_sheet(wb, wsSections, 'Strecken- & Helferplan');

  // ----------------------------------------------------
  // SHEET 2: Helfer-Einteilung & Materialausgabe
  // ----------------------------------------------------
  const helperHeaders = [
    'Nr.',
    'Helfer-Name',
    'Telefon',
    'Abschnitte (Anz.)',
    'Gesamtstrecke (m)',
    'Lichter-Bedarf (ca. Stk.)',
    'Zugeteilte Straßen & Abschnitte',
    'Lichter ausgegeben (Stk.)',
    'Unterschrift / Quittung'
  ];

  const helperRows = helpers
    .map((helper, idx) => {
      const assigned = sections.filter(s => s.assigned_helper_id === helper.id);
      const meters = assigned.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
      const candles = assigned.reduce((sum, s) => {
        const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
        if (s.type === 'point') return sum + 20;
        return len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0;
      }, 0);
      const streetSummary = assigned
        .map(s => `${s.label} (${Math.round(s.length_meters ?? (s as any).lengthMeters ?? 0)} m)`)
        .join(', ');

      return [
        idx + 1,
        helper.name,
        helper.phone || '',
        assigned.length,
        meters,
        candles,
        streetSummary || 'Noch kein Abschnitt zugeteilt',
        '', // Leeres Feld für handschriftliche Materialausgabe
        ''  // Leeres Feld für Unterschrift
      ];
    })
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'de'));

  const wsHelpers = XLSX.utils.aoa_to_sheet([helperHeaders, ...helperRows]);
  wsHelpers['!cols'] = [
    { wch: 6 },
    { wch: 26 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 45 },
    { wch: 24 },
    { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, wsHelpers, 'Helfer-Materialausgabe');

  // ----------------------------------------------------
  // SHEET 3: Gesamt-Zusammenfassung & Materialbedarfsplan
  // ----------------------------------------------------
  const totalMeters = sections.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
  const totalCandlesBase = sections.reduce((sum, s) => {
    const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
    if (s.type === 'point') return sum + 20;
    return len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0;
  }, 0);
  const totalCandlesWithBuffer = Math.round(totalCandlesBase * (1 + candleBuffer / 100));
  const assignedCount = sections.filter(s => !!s.assigned_helper_id).length;
  const unassignedCount = sections.length - assignedCount;

  const summaryData = [
    ['Lichternacht Bechhofen (91572) - Offizielle Einsatzplanung'],
    ['Erstellt am:', dateStr],
    ['Gemeinde:', 'Gemeinde Bechhofen a.d. Heide'],
    [],
    ['Kennzahl', 'Wert', 'Einheit / Erläuterung'],
    ['Gesamtstrecke aller Abschnitte', totalMeters, 'Meter'],
    ['Gesamtzahl Abschnitte', sections.length, 'Abschnitte'],
    ['Besetzte Abschnitte', assignedCount, `Zugewiesen (${Math.round((assignedCount / (sections.length || 1)) * 100)} %)`],
    ['Offene Abschnitte', unassignedCount, 'Noch frei'],
    ['Eingetragene Helfer', helpers.length, 'Personen'],
    ['Lichter-Bedarf (Netto)', totalCandlesBase, `Stück (bei ca. ${candleSpacing} m Abstand)`],
    ['Lichter-Bedarf (mit Reserve)', totalCandlesWithBuffer, `Stück (inkl. ${candleBuffer} % Puffer)`]
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 38 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Gesamt-Übersicht');

  // Write and download .xlsx
  XLSX.writeFile(wb, `lichternacht_bechhofen_einsatzplan_${dateStr}.xlsx`);
}

/**
 * Exports just the helpers list with phone and statistics into an Excel (.xlsx) file.
 */
export function exportHelpersToExcel(
  helpers: Helper[],
  sections: Section[],
  candleSpacing: number = 2.0
): void {
  const wb = XLSX.utils.book_new();
  const dateStr = new Date().toISOString().slice(0, 10);

  const headers = ['Nr.', 'Name', 'Telefon', 'Abschnitte (Anz.)', 'Meter (m)', 'Lichter (ca.)'];
  const rows = helpers.map((h, idx) => {
    const assigned = sections.filter(s => s.assigned_helper_id === h.id);
    const meters = assigned.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
    const candles = assigned.reduce((sum, s) => {
      const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
      if (s.type === 'point') return sum + 20;
      return len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0;
    }, 0);

    return [idx + 1, h.name, h.phone || '', assigned.length, meters, candles];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Helferliste');

  XLSX.writeFile(wb, `lichternacht_helfer_${dateStr}.xlsx`);
}

/**
 * Fallback: Exports sections as CSV with UTF-8 BOM.
 */
export function exportSectionsToCSV(sections: Section[], helpers: Helper[], candleSpacing: number = 2.0): void {
  const headers = ['Abschnitt', 'Straße', 'Länge (m)', 'Lichter (ca. Stk.)', 'Typ', 'Helfer', 'Telefon Helfer', 'Notizen'];
  
  const rows = sections.map(sec => {
    const helper = helpers.find(h => h.id === sec.assigned_helper_id);
    const length = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
    const candles = sec.type === 'point' ? 20 : (length > 0 ? Math.max(1, Math.round(length / candleSpacing)) : 0);
    return [
      `"${(sec.label || '').replace(/"/g, '""')}"`,
      `"${(sec.street_name || '').replace(/"/g, '""')}"`,
      length,
      candles,
      sec.type === 'point' ? 'Punkt' : 'Linie',
      `"${(sec.assigned_helper_name || 'Nicht zugewiesen').replace(/"/g, '""')}"`,
      `"${(helper?.phone || '').replace(/"/g, '""')}"`,
      `"${(sec.notes || '').replace(/"/g, '""')}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lichternacht_einteilung_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exports all sections as GeoJSON FeatureCollection.
 */
export function exportSectionsToGeoJSON(sections: Section[]): void {
  const featureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: sections.map(sec => ({
      ...sec.geojson,
      properties: {
        id: sec.id,
        label: sec.label,
        streetName: sec.street_name,
        sectionIndex: sec.section_index,
        lengthMeters: Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0),
        color: sec.color,
        type: sec.type,
        assignedHelper: sec.assigned_helper_name || null,
        notes: sec.notes || null
      }
    }))
  };

  const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lichternacht_strecken_${new Date().toISOString().slice(0, 10)}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exports sections as GPX route file for outdoor GPS and mobile map apps.
 */
export function exportSectionsToGPX(sections: Section[]): void {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lichternacht Streckenplaner Bechhofen" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Lichternacht Bechhofen</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
`;

  sections.forEach(sec => {
    const length = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
    if (sec.type === 'line' && sec.geojson.geometry.type === 'LineString') {
      gpx += `  <trk>\n    <name>${escapeXml(sec.label)} (${length}m - ${escapeXml(sec.assigned_helper_name || 'Offen')})</name>\n    <trkseg>\n`;
      sec.geojson.geometry.coordinates.forEach(([lon, lat]) => {
        gpx += `      <trkpt lat="${lat}" lon="${lon}"></trkpt>\n`;
      });
      gpx += `    </trkseg>\n  </trk>\n`;
    } else if (sec.type === 'point' && sec.geojson.geometry.type === 'Point') {
      const [lon, lat] = sec.geojson.geometry.coordinates;
      gpx += `  <wpt lat="${lat}" lon="${lon}">\n    <name>${escapeXml(sec.label)}</name>\n  </wpt>\n`;
    }
  });

  gpx += `</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lichternacht_strecken_${new Date().toISOString().slice(0, 10)}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
