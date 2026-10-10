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

export const api = {
  async getHelpers(): Promise<Helper[]> {
    const res = await fetch(`${API_BASE}/helpers`);
    if (!res.ok) throw new Error('Fehler beim Laden der Helfer');
    return res.json();
  },

  async addHelper(name: string, color?: string, phone?: string): Promise<Helper> {
    const res = await fetch(`${API_BASE}/helpers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone })
    });
    if (!res.ok) throw new Error('Fehler beim Anlegen des Helfers');
    return res.json();
  },

  async updateHelper(id: string, name: string, color?: string, phone?: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, phone })
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Helfers');
  },

  async deleteHelper(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/helpers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen des Helfers');
  },

  async getStreets(): Promise<Street[]> {
    const res = await fetch(`${API_BASE}/streets`);
    if (!res.ok) throw new Error('Fehler beim Laden der Straßen');
    return res.json();
  },

  async deleteStreet(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/streets/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen der Straße');
  },

  async getSections(): Promise<Section[]> {
    const res = await fetch(`${API_BASE}/sections`);
    if (!res.ok) throw new Error('Fehler beim Laden der Abschnitte');
    return res.json();
  },

  async updateSection(id: string, updates: { assigned_helper_id?: string | null; assigned_helper_name?: string | null; notes?: string }): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Abschnitts');
  },

  async batchAssignHelpers(assignments: Array<{ sectionId: string; helperId: string; helperName: string }>): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/batch-assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
    if (!res.ok) throw new Error('Fehler bei der Sammelzuweisung');
  },

  async deleteSection(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sections/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen des Abschnitts');
  },

  async saveStreetWithSections(street: any, sections: any[]): Promise<void> {
    const res = await fetch(`${API_BASE}/streets/save-with-sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ street, sections })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Speichern der Abschnitte');
    }
  },

  async getBechhofenStreets(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/overpass/streets`);
    if (!res.ok) throw new Error('Fehler beim Laden der Straßenliste');
    return res.json();
  },

  async getStreetGeometry(streetName: string): Promise<{ streetName: string; features: GeoJSON.Feature<GeoJSON.LineString>[]; totalLengthMeters: number }> {
    const res = await fetch(`${API_BASE}/overpass/street-geometry?name=${encodeURIComponent(streetName)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Straße "${streetName}" konnte nicht geladen werden.`);
    }
    return res.json();
  },

  async getFootRoute(startLon: number, startLat: number, endLon: number, endLat: number): Promise<{ distanceMeters: number; geometry: GeoJSON.LineString }> {
    const res = await fetch(`${API_BASE}/routing/foot?startLon=${startLon}&startLat=${startLat}&endLon=${endLon}&endLat=${endLat}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Routing fehlgeschlagen');
    }
    return res.json();
  },

  async exportDatabase(): Promise<Blob> {
    const res = await fetch(`${API_BASE}/database/export`);
    if (!res.ok) throw new Error('Export fehlgeschlagen');
    return res.blob();
  },

  async importDatabase(jsonData: any): Promise<void> {
    const res = await fetch(`${API_BASE}/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonData)
    });
    if (!res.ok) throw new Error('Import fehlgeschlagen');
  },

  async resetDatabase(): Promise<void> {
    const res = await fetch(`${API_BASE}/database/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Reset fehlgeschlagen');
  }
};
