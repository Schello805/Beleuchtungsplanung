import * as turf from '@turf/turf';

export interface Helper {
  id: string;
  name: string;
  color?: string;
  phone?: string;
  created_at: string;
}

export interface Street {
  id: string;
  name: string;
  method: string;
  chunk_length: number;
  min_length: number;
  total_length: number;
  created_at: string;
}

export interface Section {
  id: string;
  street_id?: string;
  street_name: string;
  section_index: number;
  label: string;
  length_meters: number;
  lengthMeters?: number;
  color: string;
  type: 'line' | 'point';
  geojson: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Point>;
  assigned_helper_id?: string | null;
  assigned_helper_name?: string | null;
  notes?: string | null;
  created_at: string;
}

const API_BASE = '/api';
const BECHHOFEN_BBOX = '49.1241,10.4857,49.2170,10.6304';

// Default 30 Helper placeholders for instant standalone operation
function getDefaultHelpers(): Helper[] {
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
    '#06B6D4', '#D946EF', '#EAB308', '#22C55E', '#A855F7',
    '#0EA5E9', '#F43F5E', '#10B981', '#FBBF24', '#38BDF8',
    '#4ADE80', '#FB7185', '#C084FC', '#2DD4BF', '#F472B6',
    '#818CF8', '#34D399', '#F87171', '#60A5FA', '#A78BFA'
  ];
  return Array.from({ length: 30 }, (_, i) => ({
    id: `h-${i + 1}`,
    name: `Helfer ${String(i + 1).padStart(2, '0')}`,
    color: colors[i % colors.length],
    created_at: new Date().toISOString()
  }));
}

// LocalStorage helpers for standalone/offline fallback
const localDB = {
  getHelpers(): Helper[] {
    const raw = localStorage.getItem('ln_helpers');
    if (!raw) {
      const def = getDefaultHelpers();
      localStorage.setItem('ln_helpers', JSON.stringify(def));
      return def;
    }
    try { return JSON.parse(raw); } catch { return getDefaultHelpers(); }
  },
  saveHelpers(list: Helper[]) {
    localStorage.setItem('ln_helpers', JSON.stringify(list));
  },
  getStreets(): Street[] {
    const raw = localStorage.getItem('ln_streets');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  },
  saveStreets(list: Street[]) {
    localStorage.setItem('ln_streets', JSON.stringify(list));
  },
  getSections(): Section[] {
    const raw = localStorage.getItem('ln_sections');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  },
  saveSections(list: Section[]) {
    localStorage.setItem('ln_sections', JSON.stringify(list));
  }
};

/**
 * Topologic Way Stitcher (runs client-side if backend is offline)
 */
function clientStitchWays(ways: Array<{ geometry: Array<{ lat: number; lon: number }> }>): GeoJSON.Feature<GeoJSON.LineString>[] {
  if (!ways || ways.length === 0) return [];
  let segments = ways
    .map(w => (w.geometry || []).map(pt => [pt.lon, pt.lat] as [number, number]))
    .filter(coords => coords.length >= 2);

  if (segments.length === 0) return [];
  const branches: Array<Array<[number, number]>> = [];

  while (segments.length > 0) {
    let currentLine = segments.shift()!;
    let changed = true;

    while (changed) {
      changed = false;
      const startPt = currentLine[0];
      const endPt = currentLine[currentLine.length - 1];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];
        const eps = 0.0001;

        if (Math.abs(endPt[0] - segStart[0]) < eps && Math.abs(endPt[1] - segStart[1]) < eps) {
          currentLine = [...currentLine, ...seg.slice(1)];
          segments.splice(i, 1);
          changed = true;
          break;
        } else if (Math.abs(endPt[0] - segEnd[0]) < eps && Math.abs(endPt[1] - segEnd[1]) < eps) {
          currentLine = [...currentLine, ...[...seg].reverse().slice(1)];
          segments.splice(i, 1);
          changed = true;
          break;
        } else if (Math.abs(startPt[0] - segEnd[0]) < eps && Math.abs(startPt[1] - segEnd[1]) < eps) {
          currentLine = [...seg.slice(0, -1), ...currentLine];
          segments.splice(i, 1);
          changed = true;
          break;
        } else if (Math.abs(startPt[0] - segStart[0]) < eps && Math.abs(startPt[1] - segStart[1]) < eps) {
          currentLine = [...[...seg].reverse().slice(0, -1), ...currentLine];
          segments.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    branches.push(currentLine);
  }

  const features = branches.map(b => turf.cleanCoords(turf.lineString(b)) as GeoJSON.Feature<GeoJSON.LineString>);
  features.sort((a, b) => turf.length(b, { units: 'kilometers' }) - turf.length(a, { units: 'kilometers' }));
  return features;
}

export const api = {
  // Auto-migration: Check if current browser has legacy data stored in localStorage and push to SQLite
  async checkAndMigrateLocalStorage(): Promise<{ migrated: boolean; importedStreets: number; importedSections: number }> {
    try {
      const localStreets = localDB.getStreets();
      const localSecs = localDB.getSections();
      if (localStreets.length > 0 || localSecs.length > 0) {
        console.log(`[Migration] Lokale Daten gefunden: ${localStreets.length} Straßen, ${localSecs.length} Abschnitte. Übertrage in zentrale SQLite-DB...`);
        const res = await fetch(`${API_BASE}/database/migrate-local`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streets: localStreets, sections: localSecs })
        });
        if (res.ok) {
          const data = await res.json();
          // Successfully migrated to SQLite, clear localStorage
          localStorage.removeItem('ln_streets');
          localStorage.removeItem('ln_sections');
          console.log(`[Migration] Erfolgreich in SQLite übertragen:`, data);
          return { migrated: true, importedStreets: data.importedStreets || 0, importedSections: data.importedSections || 0 };
        }
      }
    } catch (e) {
      console.warn('[Migration] Fehler beim Migrieren lokaler Daten:', e);
    }
    return { migrated: false, importedStreets: 0, importedSections: 0 };
  },

  // Database Status
  async getStatus(): Promise<{ status: string; database: string; helpersCount: number; streetsCount: number; sectionsCount: number }> {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error('Backend nicht erreichbar');
    return await res.json();
  },

  // HELPERS (Zentral in SQLite)
  async getHelpers(): Promise<Helper[]> {
    const res = await fetch(`${API_BASE}/helpers`);
    if (!res.ok) throw new Error('Fehler beim Laden der Helfer aus SQLite');
    const data = await res.json();
    return data;
  },

  async addHelper(name: string, color?: string, phone?: string): Promise<Helper> {
    const res = await fetch(`${API_BASE}/helpers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone })
    });
    if (!res.ok) throw new Error('Fehler beim Speichern des Helfers in SQLite');
    return await res.json();
  },

  async updateHelper(id: string, name: string, color?: string, phone?: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone })
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Helfers in SQLite');
  },

  async deleteHelper(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen des Helfers in SQLite');
  },

  async importHelpers(helpers: Array<{ name: string; phone?: string; color?: string }>, mode: 'replace' | 'append' = 'replace'): Promise<number> {
    const res = await fetch(`${API_BASE}/helpers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpers, mode })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Importieren der Helfer in SQLite');
    }
    const data = await res.json();
    return data.count;
  },

  // STREETS (Zentral in SQLite)
  async getStreets(): Promise<Street[]> {
    const res = await fetch(`${API_BASE}/streets`);
    if (!res.ok) throw new Error('Fehler beim Laden der Straßen aus SQLite');
    return await res.json();
  },

  async deleteStreet(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/streets/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen der Straße in SQLite');
  },

  async getSections(): Promise<Section[]> {
    const res = await fetch(`${API_BASE}/sections`);
    if (!res.ok) throw new Error('Fehler beim Laden der Abschnitte aus SQLite');
    const data: Section[] = await res.json();
    return data.map(s => ({
      ...s,
      lengthMeters: s.lengthMeters ?? s.length_meters ?? 0,
      length_meters: s.length_meters ?? s.lengthMeters ?? 0
    }));
  },

  async updateSection(id: string, updates: { assigned_helper_id?: string | null; assigned_helper_name?: string | null; notes?: string }): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Abschnitts in SQLite');
  },

  async batchAssignHelpers(assignments: Array<{ sectionId: string; helperId: string; helperName: string }>): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/batch-assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
    if (!res.ok) throw new Error('Fehler beim Speichern der Zuweisungen in SQLite');
  },

  async deleteSection(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen des Abschnitts in SQLite');
  },

  async saveStreetWithSections(street: any, sections: any[]): Promise<void> {
    const res = await fetch(`${API_BASE}/streets/save-with-sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ street, sections })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Fehler beim Speichern in der zentralen SQLite-Datenbank');
    }
  },

  async saveBatchStreetsWithSections(batch: Array<{ street: any; sections: any[] }>): Promise<void> {
    const res = await fetch(`${API_BASE}/streets/save-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Fehler beim Speichern des Straßen-Batches in SQLite');
    }
  },

  // OVERPASS STREETS
  async getBechhofenStreets(): Promise<string[]> {
    try {
      const res = await fetch(`${API_BASE}/overpass/streets`);
      if (res.ok) return await res.json();
    } catch {}

    // Direct client fallback to Overpass
    try {
      const q = `[out:json][timeout:20];way["highway"]["name"](${BECHHOFEN_BBOX});out tags;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        const set = new Set<string>();
        data.elements?.forEach((el: any) => { if (el.tags?.name) set.add(el.tags.name.trim()); });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
      }
    } catch {}

    return [
      'Ansbacher Straße', 'Dinkelsbühler Straße', 'Feuchtwanger Straße',
      'Gunzenhausener Straße', 'Marktplatz', 'Kirchenallee', 'Am Plärrer',
      'Goethestraße', 'Schillerstraße', 'Krummweiherweg'
    ];
  },

  // OVERPASS GEOMETRY (with ss/ß tolerance)
  async getStreetGeometry(streetName: string): Promise<{ streetName: string; features: GeoJSON.Feature<GeoJSON.LineString>[]; totalLengthMeters: number }> {
    try {
      const res = await fetch(`${API_BASE}/overpass/street-geometry?name=${encodeURIComponent(streetName)}`);
      if (res.ok) return await res.json();
    } catch {}

    // Direct browser Overpass query with ss/ß tolerance regex
    const regex = streetName.trim().replace(/ß|ss/gi, '(ß|ss)');
    const q = `[out:json][timeout:25];way["highway"]["name"~"${regex}",i](${BECHHOFEN_BBOX});out body geom;`;
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Straße "${streetName}" konnte nicht geladen werden.`);

    const data = await res.json();
    const ways = data.elements?.filter((el: any) => el.type === 'way' && el.geometry?.length > 0) || [];
    if (ways.length === 0) throw new Error(`Keine Geometrie für "${streetName}" gefunden.`);

    const features = clientStitchWays(ways);
    const totalLengthMeters = features.reduce((sum, f) => sum + Math.round(turf.length(f, { units: 'kilometers' }) * 1000), 0);

    return {
      streetName: ways[0]?.tags?.name || streetName,
      features,
      totalLengthMeters
    };
  },

  // ROUTING (Foot / Pedestrian)
  async getFootRoute(startLon: number, startLat: number, endLon: number, endLat: number): Promise<{ distanceMeters: number; geometry: GeoJSON.LineString }> {
    try {
      const res = await fetch(`${API_BASE}/routing/foot?startLon=${startLon}&startLat=${startLat}&endLon=${endLon}&endLat=${endLat}`);
      if (res.ok) return await res.json();
    } catch {}

    // Direct browser OSRM query
    try {
      const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.code === 'Ok' && data.routes?.length > 0) {
          return {
            distanceMeters: Math.round(data.routes[0].distance),
            geometry: data.routes[0].geometry
          };
        }
      }
    } catch {}

    // Geodesic fallback
    const directLine = turf.lineString([[startLon, startLat], [endLon, endLat]]);
    const len = Math.round(turf.length(directLine, { units: 'kilometers' }) * 1000);
    return { distanceMeters: len, geometry: directLine.geometry };
  },

  // EXPORT & IMPORT
  async exportDatabase(): Promise<Blob> {
    try {
      const res = await fetch(`${API_BASE}/database/export`);
      if (res.ok) return await res.blob();
    } catch {}

    const backup = {
      exportedAt: new Date().toISOString(),
      helpers: localDB.getHelpers(),
      streets: localDB.getStreets(),
      sections: localDB.getSections()
    };
    return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  },

  async importDatabase(jsonData: any): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/database/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonData)
      });
      if (res.ok) return;
    } catch {}

    if (jsonData.helpers) localDB.saveHelpers(jsonData.helpers);
    if (jsonData.streets) localDB.saveStreets(jsonData.streets);
    if (jsonData.sections) localDB.saveSections(jsonData.sections);
  },

  async resetDatabase(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/database/reset`, { method: 'POST' });
      if (res.ok) return;
    } catch {}

    localDB.saveSections([]);
    localDB.saveStreets([]);
    localDB.saveHelpers(getDefaultHelpers());
  },

  async getSettings(): Promise<Record<string, string>> {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) return await res.json();
    } catch {}
    return {};
  },

  async setSetting(key: string, value: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
    } catch {}
  }
};
