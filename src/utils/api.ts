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
  // HELPERS
  async getHelpers(): Promise<Helper[]> {
    try {
      const res = await fetch(`${API_BASE}/helpers`);
      if (res.ok) return await res.json();
    } catch {
      // Backend unavailable, fallback to local storage
    }
    return localDB.getHelpers();
  },

  async addHelper(name: string, color?: string, phone?: string): Promise<Helper> {
    try {
      const res = await fetch(`${API_BASE}/helpers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, phone })
      });
      if (res.ok) return await res.json();
    } catch {}

    const list = localDB.getHelpers();
    const created: Helper = {
      id: `h-${Date.now()}`,
      name: name.trim(),
      color: color || '#3B82F6',
      phone: phone || '',
      created_at: new Date().toISOString()
    };
    list.push(created);
    localDB.saveHelpers(list);
    return created;
  },

  async updateHelper(id: string, name: string, color?: string, phone?: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/helpers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, phone })
      });
      if (res.ok) return;
    } catch {}

    const list = localDB.getHelpers();
    const idx = list.findIndex(h => h.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], name: name.trim(), color: color || list[idx].color, phone: phone || list[idx].phone };
      localDB.saveHelpers(list);
    }
    // Update assigned name in sections
    const secs = localDB.getSections();
    secs.forEach(s => {
      if (s.assigned_helper_id === id) s.assigned_helper_name = name.trim();
    });
    localDB.saveSections(secs);
  },

  async deleteHelper(id: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/helpers/${id}`, { method: 'DELETE' });
      if (res.ok) return;
    } catch {}

    const list = localDB.getHelpers().filter(h => h.id !== id);
    localDB.saveHelpers(list);
  },

  // STREETS
  async getStreets(): Promise<Street[]> {
    try {
      const res = await fetch(`${API_BASE}/streets`);
      if (res.ok) return await res.json();
    } catch {}
    return localDB.getStreets();
  },

  async deleteStreet(id: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/streets/${id}`, { method: 'DELETE' });
      if (res.ok) return;
    } catch {}
    localDB.saveStreets(localDB.getStreets().filter(s => s.id !== id));
    localDB.saveSections(localDB.getSections().filter(s => s.street_id !== id));
  },

  // SECTIONS
  async getSections(): Promise<Section[]> {
    try {
      const res = await fetch(`${API_BASE}/sections`);
      if (res.ok) return await res.json();
    } catch {}
    return localDB.getSections();
  },

  async updateSection(id: string, updates: { assigned_helper_id?: string | null; assigned_helper_name?: string | null; notes?: string }): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/sections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) return;
    } catch {}

    const list = localDB.getSections();
    const idx = list.findIndex(s => s.id === id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        assigned_helper_id: updates.assigned_helper_id !== undefined ? updates.assigned_helper_id : list[idx].assigned_helper_id,
        assigned_helper_name: updates.assigned_helper_name !== undefined ? updates.assigned_helper_name : list[idx].assigned_helper_name,
        notes: updates.notes !== undefined ? updates.notes : list[idx].notes
      };
      localDB.saveSections(list);
    }
  },

  async batchAssignHelpers(assignments: Array<{ sectionId: string; helperId: string; helperName: string }>): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/sections/batch-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments })
      });
      if (res.ok) return;
    } catch {}

    const list = localDB.getSections();
    const map = new Map(assignments.map(a => [a.sectionId, a]));
    list.forEach(s => {
      const item = map.get(s.id);
      if (item) {
        s.assigned_helper_id = item.helperId || null;
        s.assigned_helper_name = item.helperName || null;
      }
    });
    localDB.saveSections(list);
  },

  async deleteSection(id: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/sections/${id}`, { method: 'DELETE' });
      if (res.ok) return;
    } catch {}
    localDB.saveSections(localDB.getSections().filter(s => s.id !== id));
  },

  async saveStreetWithSections(street: any, sections: any[]): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/streets/save-with-sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ street, sections })
      });
      if (res.ok) return;
    } catch {}

    const streets = localDB.getStreets();
    streets.unshift({ ...street, created_at: new Date().toISOString() });
    localDB.saveStreets(streets);

    const existingSecs = localDB.getSections();
    const newSecs = sections.map(s => ({ ...s, created_at: new Date().toISOString() }));
    localDB.saveSections([...existingSecs, ...newSecs]);
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
  }
};
