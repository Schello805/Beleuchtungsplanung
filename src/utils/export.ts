import type { Section, Helper } from './api';

/**
 * Exports sections as CSV with UTF-8 BOM for perfect Excel compatibility.
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

  // UTF-8 BOM (\uFEFF) ensures Excel opens German umlauts (ä, ö, ü, ß) cleanly
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
