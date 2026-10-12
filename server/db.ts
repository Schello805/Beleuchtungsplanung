import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'streckenplaner.sqlite');
export const db = new DatabaseSync(DB_PATH);

export function createBackup(reason: string) {
  try {
    const BACKUP_DIR = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `streckenplaner_${timestamp}_${reason}.sqlite`;
    const backupPath = path.join(BACKUP_DIR, backupFilename);
    
    if (fs.existsSync(DB_PATH)) {
      // Create backup
      fs.copyFileSync(DB_PATH, backupPath);
      console.log(`[Backup] Automatic backup created: ${backupFilename}`);
      
      // Keep only last 20 backups
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite')).sort();
      if (files.length > 20) {
        const toDelete = files.slice(0, files.length - 20);
        for (const f of toDelete) {
          fs.unlinkSync(path.join(BACKUP_DIR, f));
        }
      }
    }
  } catch (err) {
    console.error('[Backup] Failed to create backup:', err);
  }
}


// Initialize Tables
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS helpers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    phone TEXT,
    email TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS streets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    method TEXT NOT NULL,
    chunk_length REAL DEFAULT 100,
    min_length REAL DEFAULT 50,
    total_length REAL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    street_id TEXT REFERENCES streets(id) ON DELETE CASCADE,
    street_name TEXT NOT NULL,
    section_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    length_meters REAL NOT NULL,
    color TEXT NOT NULL,
    type TEXT NOT NULL,
    geojson TEXT NOT NULL,
    assigned_helper_id TEXT REFERENCES helpers(id) ON DELETE SET NULL,
    assigned_helper_name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'planner', 'viewer')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS mail_log (
    id TEXT PRIMARY KEY,
    helper_id TEXT REFERENCES helpers(id) ON DELETE SET NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sent', 'failed', 'test')),
    error_message TEXT,
    created_at TEXT NOT NULL
  );
`);

// Kept separate from CREATE TABLE so existing event databases are upgraded in place.
const helperColumns = db.prepare('PRAGMA table_info(helpers)').all() as Array<{ name: string }>;
const addHelperColumn = (name: string, definition: string) => {
  if (!helperColumns.some(column => column.name === name)) {
    db.exec(`ALTER TABLE helpers ADD COLUMN ${name} ${definition}`);
  }
};
addHelperColumn('source_station_id', 'TEXT');
addHelperColumn('address', 'TEXT');
addHelperColumn('latitude', 'REAL');
addHelperColumn('longitude', 'REAL');
addHelperColumn('public_token', 'TEXT');
addHelperColumn('email', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS helpers_source_station_id_unique ON helpers(source_station_id) WHERE source_station_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS helpers_public_token_unique ON helpers(public_token) WHERE public_token IS NOT NULL');
const missingPublicTokens = db.prepare('SELECT id FROM helpers WHERE public_token IS NULL OR public_token = \'\'').all() as Array<{ id: string }>;
const setPublicToken = db.prepare('UPDATE helpers SET public_token = ? WHERE id = ?');
missingPublicTokens.forEach(helper => setPublicToken.run(crypto.randomBytes(24).toString('base64url'), helper.id));

// Pre-seed 30 initial helper slots if empty so the user immediately has the 30 dropdown choices ready
const countStmt = db.prepare('SELECT COUNT(*) as count FROM helpers');
const result = countStmt.get() as { count: number };
if (result && result.count === 0) {
  const insertHelper = db.prepare('INSERT INTO helpers (id, name, color, created_at) VALUES (?, ?, ?, ?)');
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
    '#06B6D4', '#D946EF', '#EAB308', '#22C55E', '#A855F7',
    '#0EA5E9', '#F43F5E', '#10B981', '#FBBF24', '#38BDF8',
    '#4ADE80', '#FB7185', '#C084FC', '#2DD4BF', '#F472B6',
    '#818CF8', '#34D399', '#F87171', '#60A5FA', '#A78BFA'
  ];

  for (let i = 1; i <= 35; i++) {
    const num = String(i).padStart(2, '0');
    insertHelper.run(`h-${i}`, `Helfer ${num}`, colors[(i - 1) % colors.length], new Date().toISOString());
  }
}

export interface HelperRecord {
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

export interface StreetRecord {
  id: string;
  name: string;
  method: string;
  chunk_length: number;
  min_length: number;
  total_length: number;
  created_at: string;
}

export interface SectionRecord {
  id: string;
  street_id?: string;
  street_name: string;
  section_index: number;
  label: string;
  length_meters: number;
  color: string;
  type: 'line' | 'point';
  geojson: string; // JSON String
  assigned_helper_id?: string | null;
  assigned_helper_name?: string | null;
  notes?: string | null;
  created_at: string;
}

export type UserRole = 'admin' | 'planner' | 'viewer';
export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  created_at: string;
  last_login_at?: string | null;
}

export const dbService = {
  getUserCount(): number {
    return (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  },

  getUserByEmail(email: string): UserRecord | undefined {
    return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim()) as UserRecord | undefined;
  },

  getUsers(): Array<Omit<UserRecord, 'password_hash'>> {
    return db.prepare('SELECT id, email, display_name, role, created_at, last_login_at FROM users ORDER BY email ASC').all() as Array<Omit<UserRecord, 'password_hash'>>;
  },

  getUserBySession(sessionId: string): UserRecord | undefined {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    return db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ? AND sessions.expires_at > ?`).get(sessionId, new Date().toISOString()) as UserRecord | undefined;
  },

  createUser(user: Omit<UserRecord, 'created_at' | 'last_login_at'>): UserRecord {
    const created_at = new Date().toISOString();
    db.prepare('INSERT INTO users (id, email, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email.trim().toLowerCase(), user.display_name.trim(), user.role, user.password_hash, created_at);
    return { ...user, email: user.email.trim().toLowerCase(), created_at };
  },

  createSession(id: string, userId: string, expiresAt: string): void {
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, expiresAt, new Date().toISOString());
  },

  deleteSession(id: string): void {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },

  touchUserLogin(id: string): void {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  },

  getHelpers(): HelperRecord[] {
    return db.prepare('SELECT * FROM helpers ORDER BY name ASC').all() as unknown as HelperRecord[];
  },

  getPublicHelper(token: string): { name: string; sections: Array<Pick<SectionRecord, 'id' | 'street_name' | 'label' | 'length_meters' | 'type' | 'geojson'>> } | undefined {
    const helper = db.prepare('SELECT id, name FROM helpers WHERE public_token = ?').get(token) as { id: string; name: string } | undefined;
    if (!helper) return undefined;
    const sections = db.prepare(`SELECT id, street_name, label, length_meters, type, geojson FROM sections
      WHERE assigned_helper_id = ? ORDER BY street_name ASC, section_index ASC`).all(helper.id) as Array<Pick<SectionRecord, 'id' | 'street_name' | 'label' | 'length_meters' | 'type' | 'geojson'>>;
    return { name: helper.name, sections };
  },

  addHelper(name: string, color?: string, phone?: string, email?: string): HelperRecord {
    const id = 'h-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const created_at = new Date().toISOString();
    db.prepare('INSERT INTO helpers (id, name, color, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name.trim(), color || '#3B82F6', phone || '', email?.trim().toLowerCase() || '', created_at);
    return { id, name: name.trim(), color, phone, email, created_at };
  },

  updateHelper(id: string, name: string, color?: string, phone?: string, email?: string): boolean {
    db.prepare('UPDATE helpers SET name = ?, color = ?, phone = ?, email = ? WHERE id = ?')
      .run(name.trim(), color || '#3B82F6', phone || '', email?.trim().toLowerCase() || '', id);
    // Also update assigned_helper_name in sections table
    db.prepare('UPDATE sections SET assigned_helper_name = ? WHERE assigned_helper_id = ?')
      .run(name.trim(), id);
    return true;
  },

  deleteHelper(id: string): boolean {
    db.prepare('DELETE FROM helpers WHERE id = ?').run(id);
    return true;
  },

  deleteAllHelpers(): void {
    createBackup('before_delete_all_helpers');
    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare('UPDATE sections SET assigned_helper_id = NULL, assigned_helper_name = NULL').run();
      db.prepare('DELETE FROM helpers').run();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  importHelpers(helpersList: Array<{ name: string; phone?: string; email?: string; color?: string }>, mode: 'replace' | 'append' | 'sync' = 'replace'): number {
    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
      '#06B6D4', '#D946EF', '#EAB308', '#22C55E', '#A855F7',
      '#0EA5E9', '#F43F5E', '#10B981', '#FBBF24', '#38BDF8',
      '#4ADE80', '#FB7185', '#C084FC', '#2DD4BF', '#F472B6',
      '#818CF8', '#34D399', '#F87171', '#60A5FA', '#A78BFA'
    ];

    db.exec('BEGIN TRANSACTION');
    try {
      if (mode === 'replace') {
        createBackup('before_import_helpers_replace');
        db.prepare('UPDATE sections SET assigned_helper_id = NULL, assigned_helper_name = NULL').run();
        db.prepare('DELETE FROM helpers').run();
      } else if (mode === 'sync') {
        createBackup('before_import_helpers_sync');
        const validNames = helpersList.map(h => (h.name || '').trim()).filter(Boolean);
        if (validNames.length > 0) {
          const placeholders = validNames.map(() => '?').join(',');
          const toDelete = db.prepare(`SELECT id FROM helpers WHERE name NOT IN (${placeholders})`).all(...validNames) as {id: string}[];
          
          if (toDelete.length > 0) {
             const delIds = toDelete.map(r => r.id);
             const idPlaceholders = delIds.map(() => '?').join(',');
             db.prepare(`UPDATE sections SET assigned_helper_id = NULL, assigned_helper_name = NULL WHERE assigned_helper_id IN (${idPlaceholders})`).run(...delIds);
             db.prepare(`DELETE FROM helpers WHERE id IN (${idPlaceholders})`).run(...delIds);
          }
        }
      }

      const insertStmt = db.prepare(`
        INSERT INTO helpers (id, name, color, phone, email, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE helpers.phone END,
          email = CASE WHEN excluded.email != '' THEN excluded.email ELSE helpers.email END,
          color = COALESCE(excluded.color, helpers.color)
      `);

      let count = 0;
      for (const h of helpersList) {
        const trimmedName = (h.name || '').trim();
        if (!trimmedName) continue;
        const id = 'h-' + Date.now() + '-' + count + '-' + Math.random().toString(36).substring(2, 6);
        const color = h.color || colors[count % colors.length];
        insertStmt.run(id, trimmedName, color, h.phone || '', h.email?.trim().toLowerCase() || '', new Date().toISOString());
        count++;
      }

      db.exec('COMMIT');
      return count;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  importStations(stations: Array<{ stationId: string; name: string; address?: string; email?: string; latitude: number; longitude: number }>) {
    createBackup('before_import_stations');
    const valid = stations.filter(station =>
      station.stationId && station.name?.trim() && Number.isFinite(station.latitude) && Number.isFinite(station.longitude) &&
      station.latitude >= -90 && station.latitude <= 90 && station.longitude >= -180 && station.longitude <= 180 &&
      !(station.latitude === 0 && station.longitude === 0)
    );
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
    let created = 0;
    let updated = 0;
    db.exec('BEGIN TRANSACTION');
    try {
      // The initial empty installation creates numbered placeholders. They are
      // not real people and would otherwise be counted in addition to every
      // imported Lichternacht station. Assigned placeholders stay untouched.
      db.prepare(`DELETE FROM helpers
        WHERE source_station_id IS NULL
          AND name GLOB 'Helfer [0-9][0-9]'
          AND NOT EXISTS (SELECT 1 FROM sections WHERE assigned_helper_id = helpers.id)`).run();

      const byStationId = db.prepare('SELECT id FROM helpers WHERE source_station_id = ?');
      const byNameWithoutStation = db.prepare('SELECT id FROM helpers WHERE name = ? AND source_station_id IS NULL');
      const update = db.prepare(`UPDATE helpers
        SET name = ?, source_station_id = ?, address = ?, latitude = ?, longitude = ?,
            email = CASE WHEN ? != '' THEN ? ELSE email END WHERE id = ?`);
      const insert = db.prepare(`INSERT INTO helpers
        (id, name, color, phone, email, source_station_id, address, latitude, longitude, created_at)
        VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`);

      valid.forEach((station, index) => {
        const stationId = String(station.stationId);
        const existing = (byStationId.get(stationId) || byNameWithoutStation.get(station.name.trim())) as { id: string } | undefined;
        if (existing) {
          const email = station.email?.trim().toLowerCase() || '';
          update.run(station.name.trim(), stationId, station.address?.trim() || '', station.latitude, station.longitude, email, email, existing.id);
          db.prepare('UPDATE sections SET assigned_helper_name = ? WHERE assigned_helper_id = ?').run(station.name.trim(), existing.id);
          updated++;
        } else {
          const id = `station-${stationId}`;
          insert.run(id, station.name.trim(), colors[index % colors.length], station.email?.trim().toLowerCase() || '', stationId, station.address?.trim() || '', station.latitude, station.longitude, new Date().toISOString());
          created++;
        }
      });
      db.exec('COMMIT');
      return { imported: valid.length, created, updated };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  getStreets(): StreetRecord[] {
    return db.prepare('SELECT * FROM streets ORDER BY created_at DESC').all() as unknown as StreetRecord[];
  },

  getSections(): SectionRecord[] {
    return db.prepare('SELECT * FROM sections ORDER BY street_name ASC, section_index ASC').all() as unknown as SectionRecord[];
  },

  saveStreetWithSections(street: Omit<StreetRecord, 'created_at'>, sections: Omit<SectionRecord, 'created_at'>[]) {
    const createdAt = new Date().toISOString();
    
    // Save street
    db.prepare(`
      INSERT INTO streets (id, name, method, chunk_length, min_length, total_length, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(street.id, street.name, street.method, street.chunk_length, street.min_length, street.total_length, createdAt);

    // Save sections
    const insertSec = db.prepare(`
      INSERT INTO sections (id, street_id, street_name, section_index, label, length_meters, color, type, geojson, assigned_helper_id, assigned_helper_name, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sec of sections) {
      insertSec.run(
        sec.id,
        street.id,
        sec.street_name,
        sec.section_index,
        sec.label,
        sec.length_meters,
        sec.color,
        sec.type,
        typeof sec.geojson === 'string' ? sec.geojson : JSON.stringify(sec.geojson),
        sec.assigned_helper_id || null,
        sec.assigned_helper_name || null,
        sec.notes || null,
        createdAt
      );
    }

    return true;
  },

  saveBatchStreetsWithSections(batch: Array<{ street: Omit<StreetRecord, 'created_at'>; sections: Omit<SectionRecord, 'created_at'>[] }>) {
    const createdAt = new Date().toISOString();
    db.exec('BEGIN TRANSACTION');
    try {
      const insertStreet = db.prepare(`
        INSERT INTO streets (id, name, method, chunk_length, min_length, total_length, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertSec = db.prepare(`
        INSERT INTO sections (id, street_id, street_name, section_index, label, length_meters, color, type, geojson, assigned_helper_id, assigned_helper_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of batch) {
        insertStreet.run(
          item.street.id,
          item.street.name,
          item.street.method,
          item.street.chunk_length,
          item.street.min_length,
          item.street.total_length,
          createdAt
        );

        for (const sec of item.sections) {
          insertSec.run(
            sec.id,
            item.street.id,
            sec.street_name,
            sec.section_index,
            sec.label,
            sec.length_meters,
            sec.color,
            sec.type,
            typeof sec.geojson === 'string' ? sec.geojson : JSON.stringify(sec.geojson),
            sec.assigned_helper_id || null,
            sec.assigned_helper_name || null,
            sec.notes || null,
            createdAt
          );
        }
      }

      db.exec('COMMIT');
      return true;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  replaceAllSections(sections: Omit<SectionRecord, 'created_at'>[]) {
    createBackup('before_replace_all_sections');
    const createdAt = new Date().toISOString();
    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare('DELETE FROM sections').run();
      const insertSec = db.prepare(`
        INSERT INTO sections (id, street_id, street_name, section_index, label, length_meters, color, type, geojson, assigned_helper_id, assigned_helper_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const sec of sections) {
        insertSec.run(
          sec.id,
          sec.street_id || null,
          sec.street_name,
          sec.section_index,
          sec.label,
          sec.length_meters,
          sec.color,
          sec.type,
          typeof sec.geojson === 'string' ? sec.geojson : JSON.stringify(sec.geojson),
          sec.assigned_helper_id || null,
          sec.assigned_helper_name || null,
          sec.notes || null,
          createdAt
        );
      }

      db.exec('COMMIT');
      return true;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  updateSectionHelper(sectionId: string, helperId: string | null, helperName: string | null) {
    db.prepare('UPDATE sections SET assigned_helper_id = ?, assigned_helper_name = ? WHERE id = ?')
      .run(helperId || null, helperName || null, sectionId);
    return true;
  },

  batchUpdateSectionHelpers(assignments: Array<{ sectionId: string; helperId: string | null; helperName: string | null }>) {
    const stmt = db.prepare('UPDATE sections SET assigned_helper_id = ?, assigned_helper_name = ? WHERE id = ?');
    for (const a of assignments) {
      stmt.run(a.helperId || null, a.helperName || null, a.sectionId);
    }
    return true;
  },

  updateSectionNotes(sectionId: string, notes: string) {
    db.prepare('UPDATE sections SET notes = ? WHERE id = ?').run(notes, sectionId);
    return true;
  },

  updateSectionGeometry(sectionId: string, geojson: unknown, lengthMeters: number) {
    db.prepare('UPDATE sections SET geojson = ?, length_meters = ? WHERE id = ?')
      .run(JSON.stringify(geojson), lengthMeters, sectionId);
    return true;
  },

  deleteSection(sectionId: string) {
    db.prepare('DELETE FROM sections WHERE id = ?').run(sectionId);
    return true;
  },

  deleteStreet(streetId: string) {
    db.prepare('DELETE FROM sections WHERE street_id = ?').run(streetId);
    db.prepare('DELETE FROM streets WHERE id = ?').run(streetId);
    return true;
  },

  getAllSettings(): Record<string, string> {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  },

  getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },

  setSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now);
  },

  addMailLog(entry: { helperId?: string | null; recipient: string; subject: string; status: 'sent' | 'failed' | 'test'; errorMessage?: string | null }): void {
    db.prepare('INSERT INTO mail_log (id, helper_id, recipient, subject, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), entry.helperId || null, entry.recipient, entry.subject, entry.status, entry.errorMessage || null, new Date().toISOString());
  },

  getMailLog(limit = 50) {
    return db.prepare(`SELECT mail_log.*, helpers.name AS helper_name FROM mail_log
      LEFT JOIN helpers ON helpers.id = mail_log.helper_id ORDER BY created_at DESC LIMIT ?`).all(limit);
  },

  exportDatabase() {
    return {
      exportedAt: new Date().toISOString(),
      helpers: this.getHelpers(),
      streets: this.getStreets(),
      sections: this.getSections(),
      settings: this.getAllSettings()
    };
  },

  importDatabase(data: { helpers?: HelperRecord[]; streets?: StreetRecord[]; sections?: SectionRecord[]; settings?: Record<string, string> }) {
    createBackup('before_import_database');
    if (data.settings && typeof data.settings === 'object') {
      for (const [k, v] of Object.entries(data.settings)) {
        this.setSetting(k, v);
      }
    }
    if (data.helpers && Array.isArray(data.helpers)) {
      db.prepare('DELETE FROM helpers').run();
      const insertH = db.prepare('INSERT INTO helpers (id, name, color, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const h of data.helpers) {
        insertH.run(h.id, h.name, h.color || '#3B82F6', h.phone || '', h.email || '', h.created_at || new Date().toISOString());
      }
    }

    if (data.streets && Array.isArray(data.streets)) {
      db.prepare('DELETE FROM streets').run();
      const insertS = db.prepare('INSERT INTO streets (id, name, method, chunk_length, min_length, total_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const s of data.streets) {
        insertS.run(s.id, s.name, s.method, s.chunk_length, s.min_length, s.total_length, s.created_at || new Date().toISOString());
      }
    }

    if (data.sections && Array.isArray(data.sections)) {
      db.prepare('DELETE FROM sections').run();
      const insertSec = db.prepare('INSERT INTO sections (id, street_id, street_name, section_index, label, length_meters, color, type, geojson, assigned_helper_id, assigned_helper_name, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const sec of data.sections) {
        insertSec.run(
          sec.id,
          sec.street_id || null,
          sec.street_name,
          sec.section_index,
          sec.label,
          sec.length_meters,
          sec.color,
          sec.type,
          typeof sec.geojson === 'string' ? sec.geojson : JSON.stringify(sec.geojson),
          sec.assigned_helper_id || null,
          sec.assigned_helper_name || null,
          sec.notes || null,
          sec.created_at || new Date().toISOString()
        );
      }
    }

    return true;
  },

  mergeLocalData(data: { helpers?: HelperRecord[]; streets?: StreetRecord[]; sections?: SectionRecord[] }) {
    let importedStreets = 0;
    let importedSections = 0;

    if (data.streets && Array.isArray(data.streets)) {
      const insertS = db.prepare(`
        INSERT OR IGNORE INTO streets (id, name, method, chunk_length, min_length, total_length, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of data.streets) {
        insertS.run(s.id, s.name, s.method, s.chunk_length, s.min_length, s.total_length, s.created_at || new Date().toISOString());
        importedStreets++;
      }
    }

    if (data.sections && Array.isArray(data.sections)) {
      const insertSec = db.prepare(`
        INSERT OR IGNORE INTO sections (id, street_id, street_name, section_index, label, length_meters, color, type, geojson, assigned_helper_id, assigned_helper_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sec of data.sections) {
        insertSec.run(
          sec.id,
          sec.street_id || null,
          sec.street_name,
          sec.section_index,
          sec.label,
          sec.length_meters,
          sec.color,
          sec.type,
          typeof sec.geojson === 'string' ? sec.geojson : JSON.stringify(sec.geojson),
          sec.assigned_helper_id || null,
          sec.assigned_helper_name || null,
          sec.notes || null,
          sec.created_at || new Date().toISOString()
        );
        importedSections++;
      }
    }

    return { importedStreets, importedSections };
  },

  resetDatabase() {
    createBackup('before_reset_database');
    db.prepare('DELETE FROM sections').run();
    db.prepare('DELETE FROM streets').run();
    db.prepare('DELETE FROM helpers').run();
    
    // Re-seed 30 default helpers
    const insertHelper = db.prepare('INSERT INTO helpers (id, name, color, created_at) VALUES (?, ?, ?, ?)');
    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
      '#06B6D4', '#D946EF', '#EAB308', '#22C55E', '#A855F7',
      '#0EA5E9', '#F43F5E', '#10B981', '#FBBF24', '#38BDF8',
      '#4ADE80', '#FB7185', '#C084FC', '#2DD4BF', '#F472B6',
      '#818CF8', '#34D399', '#F87171', '#60A5FA', '#A78BFA'
    ];

    for (let i = 1; i <= 35; i++) {
      const num = String(i).padStart(2, '0');
      insertHelper.run(`h-${i}`, `Helfer ${num}`, colors[(i - 1) % colors.length], new Date().toISOString());
    }

    return true;
  }
};
