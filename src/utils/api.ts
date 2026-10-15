import * as turf from '@turf/turf';

export interface Helper {
  id: string;
  name: string;
  color?: string;
  phone?: string;
  email?: string;
  source_station_id?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  public_token?: string | null;
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
  lighting_side?: 'both' | 'left' | 'right';
  geojson: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Point>;
  assigned_helper_id?: string | null;
  assigned_helper_name?: string | null;
  notes?: string | null;
  created_at: string;
}

export type UserRole = 'admin' | 'planner' | 'viewer';
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export interface PublicHelperInfo {
  name: string;
  sections: Array<Pick<Section, 'id' | 'street_name' | 'label' | 'length_meters' | 'type' | 'lighting_side' | 'geojson'>>;
}

const API_BASE = '/api';
const BECHHOFEN_BBOX = '49.1241,10.4857,49.2170,10.6304';
const isDefaultStreetSearchArea = (area?: { city: string; postalCode: string }) =>
  !area || ((area.city || '').trim().toLowerCase() === 'bechhofen' && (area.postalCode || '').trim() === '91572');

// LocalStorage helpers for standalone/offline fallback
const localDB = {
  getHelpers(): Helper[] {
    const raw = localStorage.getItem('ln_helpers');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
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
  async getSession(): Promise<{ authenticated: boolean; setupRequired?: boolean; user: AuthUser | null }> {
    const res = await fetch(`${API_BASE}/auth/session`);
    if (!res.ok) throw new Error('Anmeldestatus konnte nicht geprüft werden.');
    return await res.json();
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
    return data.user;
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  },

  async getUsers(): Promise<AuthUser[]> {
    const res = await fetch(`${API_BASE}/users`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Benutzer konnten nicht geladen werden.');
    return data;
  },

  async createUser(input: { email: string; displayName: string; password: string; role: UserRole }): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Benutzer konnte nicht angelegt werden.');
    return data;
  },

  async getPublicHelper(token: string): Promise<PublicHelperInfo> {
    const res = await fetch(`${API_BASE}/public/helpers/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Helfer-Link konnte nicht geladen werden.');
    return data;
  },

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

  async addHelper(name: string, color?: string, phone?: string, email?: string): Promise<Helper> {
    const res = await fetch(`${API_BASE}/helpers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone, email })
    });
    if (!res.ok) throw new Error('Fehler beim Speichern des Helfers in SQLite');
    return await res.json();
  },

  async updateHelper(id: string, name: string, color?: string, phone?: string, email?: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone, email })
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Helfers in SQLite');
  },

  async deleteHelper(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen des Helfers in SQLite');
  },

  async deleteAllHelpers(): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/all`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen aller Helfer in SQLite');
  },

  async importHelpers(helpers: Array<{ name: string; phone?: string; email?: string; color?: string }>, mode: 'replace' | 'append' | 'sync' = 'replace'): Promise<number> {
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

  async importStations(stations: Array<{ stationId: string; name: string; address?: string; latitude: number; longitude: number }>): Promise<{ imported: number; created: number; updated: number }> {
    const res = await fetch(`${API_BASE}/helpers/import-stations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stations })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Importieren der Stationen');
    }
    return await res.json();
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

  async updateSection(id: string, updates: { assigned_helper_id?: string | null; assigned_helper_name?: string | null; notes?: string; geojson?: GeoJSON.Feature<GeoJSON.LineString>; length_meters?: number; lighting_side?: 'both' | 'left' | 'right' }): Promise<void> {
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

  async replaceAllSections(sections: any[]): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/replace-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Fehler beim Aktualisieren der Abschnitte in SQLite');
    }
  },

  // OVERPASS STREETS
  async getBechhofenStreets(searchArea?: { city: string; postalCode: string }): Promise<string[]> {
    try {
      const params = new URLSearchParams();
      if (searchArea?.city) params.set('city', searchArea.city);
      if (searchArea?.postalCode) params.set('postalCode', searchArea.postalCode);
      const res = await fetch(`${API_BASE}/overpass/streets${params.size ? `?${params}` : ''}`);
      if (res.ok) return await res.json();
    } catch {}

    if (!isDefaultStreetSearchArea(searchArea)) return [];

    // Fallback: load pre-compiled local Bechhofen streets dataset
    try {
      const res = await fetch('/data/bechhofen_streets_osm.json');
      if (res.ok) {
        const data = await res.json();
        return Object.keys(data).sort((a, b) => a.localeCompare(b, 'de'));
      }
    } catch {}

    return [
      'Ansbacher Straße', 'Dinkelsbühler Straße', 'Feuchtwanger Straße',
      'Gunzenhausener Straße', 'Kirchstraße', 'Marktplatz', 'Kirchenallee',
      'Am Plärrer', 'Schloßstraße', 'Goethestraße', 'Schillerstraße', 'Krummweiherweg'
    ];
  },

  // OVERPASS GEOMETRY (with ss/ß and str. tolerance)
  async getStreetGeometry(streetName: string, searchArea?: { city: string; postalCode: string }): Promise<{ streetName: string; features: GeoJSON.Feature<GeoJSON.LineString>[]; totalLengthMeters: number; junctionPoints?: Array<[number, number]> }> {
    // 1. Try backend API first
    try {
      const params = new URLSearchParams({ name: streetName });
      if (searchArea?.city) params.set('city', searchArea.city);
      if (searchArea?.postalCode) params.set('postalCode', searchArea.postalCode);
      const res = await fetch(`${API_BASE}/overpass/street-geometry?${params}`);
      if (res.ok) return await res.json();
    } catch {}

    // The offline dataset is deliberately restricted to the configured default
    // location. It must never return a same-named road from Bechhofen while a
    // different city/PLZ was selected.
    if (!isDefaultStreetSearchArea(searchArea)) {
      throw new Error('Die Straßensuche für den eingestellten Ort ist momentan nicht erreichbar. Bitte Serververbindung sowie Ort und PLZ prüfen.');
    }

    // 2. Direct client fallback: load pre-compiled local Bechhofen street dataset
    try {
      const localRes = await fetch('/data/bechhofen_streets_osm.json');
      if (localRes.ok) {
        const localData = await localRes.json();
        const normalize = (s: string) => s.trim().toLowerCase()
          .replace(/str\./g, 'straße')
          .replace(/straße\b/g, 'str')
          .replace(/strasse\b/g, 'str')
          .replace(/ß|ss/g, '#')
          .replace(/[^a-z0-9#]/g, '');

        const targetNorm = normalize(streetName);

        // Exact or normalized match
        for (const [key, ways] of Object.entries(localData as Record<string, any[]>)) {
          if (normalize(key) === targetNorm && ways.length > 0) {
            const features = clientStitchWays(ways);
            const totalLengthMeters = features.reduce((sum, f) => sum + Math.round(turf.length(f, { units: 'kilometers' }) * 1000), 0);
            return {
              streetName: key,
              features,
              totalLengthMeters
            };
          }
        }
      }
    } catch {}

    // 3. Fallback to Overpass API via POST with global bbox
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    const generateVariants = (input: string): string[] => {
      const trimmed = input.trim();
      const set = new Set<string>([trimmed]);
      set.add(trimmed.replace(/ß/gi, 'ss'));
      set.add(trimmed.replace(/ss/gi, 'ß'));
      set.add(trimmed.replace(/str\./gi, 'straße'));
      set.add(trimmed.replace(/str\./gi, 'strasse'));
      return Array.from(set).map(s => s.charAt(0).toUpperCase() + s.slice(1));
    };

    const variants = generateVariants(streetName);
    const q = `[out:json][timeout:25][bbox:${BECHHOFEN_BBOX}];
(
${variants.map(v => `  way["highway"]["name"="${v}"];`).join('\n')}
);
out body geom;`;

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q)
        });
        if (res.ok) {
          const data = await res.json();
          const ways = data.elements?.filter((el: any) => el.type === 'way' && el.geometry?.length > 0) || [];
          if (ways.length > 0) {
            const features = clientStitchWays(ways);
            const totalLengthMeters = features.reduce((sum, f) => sum + Math.round(turf.length(f, { units: 'kilometers' }) * 1000), 0);
            return {
              streetName: ways[0]?.tags?.name || streetName,
              features,
              totalLengthMeters
            };
          }
        }
      } catch {}
    }

    throw new Error(`Straße "${streetName}" konnte nicht geladen werden.`);
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
    localDB.saveHelpers([]);
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
  },

  async setSmtpPassword(password: string): Promise<void> {
    const res = await fetch(`${API_BASE}/settings/smtp-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'SMTP-Passwort konnte nicht gespeichert werden');
    }
  },

  async sendTestMail(to: string): Promise<void> {
    const res = await fetch(`${API_BASE}/mail/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Test-E-Mail konnte nicht gesendet werden.');
  },

  async sendHelperMails(): Promise<{ sent: number; failed: number; eligible: number }> {
    const res = await fetch(`${API_BASE}/mail/helpers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Helfer-E-Mails konnten nicht gesendet werden.');
    return await res.json();
  },

  async getMailLog(): Promise<Array<{ id: string; helper_name?: string; recipient: string; subject: string; status: string; error_message?: string; created_at: string }>> {
    const res = await fetch(`${API_BASE}/mail/log`);
    if (!res.ok) throw new Error('Versandprotokoll konnte nicht geladen werden.');
    return await res.json();
  }
};
