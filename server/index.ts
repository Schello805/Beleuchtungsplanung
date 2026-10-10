import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { dbService } from './db.ts';
import { getBechhofenStreets, getStreetGeometry } from './overpass.ts';
import { getFootRoute } from './routing.ts';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${req.method} ${req.url}`);
  next();
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Helpers API
app.get('/api/helpers', (req, res) => {
  try {
    const helpers = dbService.getHelpers();
    res.json(helpers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/helpers', (req, res) => {
  try {
    const { name, color, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const created = dbService.addHelper(name, color, phone);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/helpers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    dbService.updateHelper(id, name, color, phone);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/helpers/:id', (req, res) => {
  try {
    const { id } = req.params;
    dbService.deleteHelper(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/helpers/import', (req, res) => {
  try {
    const { helpers, mode } = req.body;
    if (!helpers || !Array.isArray(helpers)) {
      return res.status(400).json({ error: 'Ungültige Helferliste' });
    }
    const count = dbService.importHelpers(helpers, mode || 'replace');
    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

import os from 'node:os';

function getNetworkAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Status & Health Check
app.get('/api/status', (req, res) => {
  try {
    const helpers = dbService.getHelpers();
    const streets = dbService.getStreets();
    const sections = dbService.getSections();
    res.json({
      status: 'ok',
      database: 'SQLite (streckenplaner.sqlite)',
      networkIps: getNetworkAddresses(),
      helpersCount: helpers.length,
      streetsCount: streets.length,
      sectionsCount: sections.length,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Streets API
app.get('/api/streets', (req, res) => {
  try {
    const streets = dbService.getStreets();
    res.json(streets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/streets/:id', (req, res) => {
  try {
    const { id } = req.params;
    dbService.deleteStreet(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sections API
app.get('/api/sections', (req, res) => {
  try {
    const sections = dbService.getSections();
    const parsed = sections.map(s => ({
      ...s,
      length_meters: s.length_meters,
      lengthMeters: s.length_meters,
      geojson: typeof s.geojson === 'string' ? JSON.parse(s.geojson) : s.geojson
    }));
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sections/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_helper_id, assigned_helper_name, notes } = req.body;

    if (assigned_helper_id !== undefined || assigned_helper_name !== undefined) {
      dbService.updateSectionHelper(id, assigned_helper_id, assigned_helper_name);
    }
    if (notes !== undefined) {
      dbService.updateSectionNotes(id, notes);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Batch Assign Helpers
app.post('/api/sections/batch-assign', (req, res) => {
  try {
    const { assignments } = req.body;
    if (!assignments || !Array.isArray(assignments)) {
      return res.status(400).json({ error: 'Ungültige Zuweisungsliste' });
    }
    dbService.batchUpdateSectionHelpers(assignments);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sections/:id', (req, res) => {
  try {
    const { id } = req.params;
    dbService.deleteSection(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save complete Street along with its generated sections (Transactional)
app.post('/api/streets/save-with-sections', (req, res) => {
  try {
    const { street, sections } = req.body;
    if (!street || !sections || !Array.isArray(sections)) {
      return res.status(400).json({ error: 'Ungültige Daten' });
    }

    dbService.saveStreetWithSections(street, sections);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error saving street:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save batch of streets and sections (Transactional)
app.post('/api/streets/save-batch', (req, res) => {
  try {
    const { batch } = req.body;
    if (!batch || !Array.isArray(batch)) {
      return res.status(400).json({ error: 'Ungültiges Batch-Format' });
    }

    dbService.saveBatchStreetsWithSections(batch);
    res.json({ success: true, count: batch.length });
  } catch (err: any) {
    console.error('Error saving batch streets:', err);
    res.status(500).json({ error: err.message });
  }
});

// Replace all sections (e.g. after redistribution / fair bisect)
app.post('/api/sections/replace-all', (req, res) => {
  try {
    const { sections } = req.body;
    if (!sections || !Array.isArray(sections)) {
      return res.status(400).json({ error: 'Sections-Array erforderlich' });
    }

    dbService.replaceAllSections(sections);
    res.json({ success: true, count: sections.length });
  } catch (err: any) {
    console.error('Error replacing sections:', err);
    res.status(500).json({ error: err.message });
  }
});

// Overpass: List of streets in Bechhofen
app.get('/api/overpass/streets', async (req, res) => {
  try {
    const streets = await getBechhofenStreets();
    res.json(streets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Overpass: Geometry for single street with ss/ß tolerance
app.get('/api/overpass/street-geometry', async (req, res) => {
  try {
    const name = req.query.name as string;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Straßenname erforderlich' });
    }

    const result = await getStreetGeometry(name.trim());
    res.json(result);
  } catch (err: any) {
    const msg = err.message || 'Fehler beim Laden der Straße';
    if (msg.includes('Keine Straße') || msg.includes('nicht gefunden')) {
      res.status(404).json({ error: msg });
    } else {
      res.status(502).json({ error: msg });
    }
  }
});

// OSRM: Pedestrian Routing
app.get('/api/routing/foot', async (req, res) => {
  try {
    const startLon = parseFloat(req.query.startLon as string);
    const startLat = parseFloat(req.query.startLat as string);
    const endLon = parseFloat(req.query.endLon as string);
    const endLat = parseFloat(req.query.endLat as string);

    if (isNaN(startLon) || isNaN(startLat) || isNaN(endLon) || isNaN(endLat)) {
      return res.status(400).json({ error: 'Start- und Zielkoordinaten ungültig' });
    }

    const route = await getFootRoute(startLon, startLat, endLon, endLat);
    res.json(route);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Database Export & Import
app.get('/api/database/export', (req, res) => {
  try {
    const data = dbService.exportDatabase();
    res.setHeader('Content-Disposition', `attachment; filename=lichternacht_backup_${Date.now()}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/database/import', (req, res) => {
  try {
    const data = req.body;
    dbService.importDatabase(data);
    res.json({ success: true, message: 'Datenbank erfolgreich wiederhergestellt' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/database/migrate-local', (req, res) => {
  try {
    const data = req.body;
    const result = dbService.mergeLocalData(data);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/database/reset', (req, res) => {
  try {
    dbService.resetDatabase();
    res.json({ success: true, message: 'Datenbank zurückgesetzt' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Settings API (Map token, preferences, etc. - fully centralized in DB)
app.get('/api/settings', (req, res) => {
  try {
    const settings = dbService.getAllSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    dbService.setSetting(key, String(value ?? ''));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend in production
const distPath = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lichternacht Backend Server läuft auf http://0.0.0.0:${PORT} (auf allen PCs im Netzwerk erreichbar)`);
});
