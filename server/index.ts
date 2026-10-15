import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { dbService, type UserRecord, type UserRole } from './db.ts';
import { getBechhofenStreets, getStreetGeometry } from './overpass.ts';
import { getFootRoute } from './routing.ts';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const authRequired = process.env.AUTH_REQUIRED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
const AUTH_REQUIRED = authRequired.toLowerCase() !== 'false';
const SESSION_COOKIE = 'lichternacht_session';
const SESSION_DAYS = 14;
let smtpPasswordOverride = process.env.SMTP_PASSWORD?.trim() || '';

type SafeUser = Pick<UserRecord, 'id' | 'email' | 'display_name' | 'role'>;
type AuthenticatedRequest = express.Request & { authUser?: SafeUser };

const toSafeUser = (user: UserRecord): SafeUser => ({
  id: user.id, email: user.email, display_name: user.display_name, role: user.role
});

const parseCookies = (header?: string) => Object.fromEntries((header || '').split(';').map(value => {
  const index = value.indexOf('=');
  return index < 0 ? [] : [value.slice(0, index).trim(), decodeURIComponent(value.slice(index + 1))];
}).filter((entry): entry is [string, string] => entry.length === 2));

const passwordHash = (password: string, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};
const passwordMatches = (password: string, stored: string) => {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const configured = email && password && password.length >= 12
    && email.toLowerCase() !== 'admin@example.org' && !password.startsWith('BITTE_HIER_');
  if (dbService.getUserCount() === 0 && configured) {
    dbService.createUser({
      id: crypto.randomUUID(), email, display_name: process.env.ADMIN_NAME?.trim() || 'Administrator',
      role: 'admin', password_hash: passwordHash(password)
    });
    console.log(`[Sicherheit] Erstes Admin-Konto für ${email} angelegt.`);
  }
}
bootstrapAdmin();
const authReady = !AUTH_REQUIRED || dbService.getUserCount() > 0;

app.set('trust proxy', 1);
app.use(cors({ origin: false }));
app.use(express.json({ limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${req.method} ${req.url}`);
  next();
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', authRequired: AUTH_REQUIRED, authReady, time: new Date().toISOString() });
});

app.get('/api/auth/session', (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ authenticated: true, user: { id: 'local', email: 'lokal', display_name: 'Lokaler Zugriff', role: 'admin' } });
  const session = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = session ? dbService.getUserBySession(session) : undefined;
  res.json({ authenticated: Boolean(user), setupRequired: !authReady, user: user ? toSafeUser(user) : null });
});

app.post('/api/auth/login', (req, res) => {
  if (!authReady) return res.status(503).json({ error: 'Kein Admin-Konto eingerichtet. ADMIN_EMAIL und ADMIN_PASSWORD im Server-Environment setzen.' });
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich.' });
  const user = dbService.getUserByEmail(email);
  if (!user || !passwordMatches(password, user.password_hash)) return res.status(401).json({ error: 'E-Mail oder Passwort ist nicht korrekt.' });
  const sessionId = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  dbService.createSession(sessionId, user.id, expires.toISOString());
  dbService.touchUserLogin(user.id);
  res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'strict', secure: req.secure, expires, path: '/' });
  res.json({ user: toSafeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const session = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (session) dbService.deleteSession(session);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
  res.json({ success: true });
});

// Public helper links deliberately expose only the assigned work package. They
// do not grant access to helpers, stations, planning data, or administration.
app.get('/api/public/helpers/:token', (req, res) => {
  const result = dbService.getPublicHelper(req.params.token);
  if (!result) return res.status(404).json({ error: 'Dieser Helfer-Link ist nicht mehr gültig.' });
  res.json({
    name: result.name,
    sections: result.sections.map(section => ({
      ...section,
      geojson: typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson
    }))
  });
});

app.use('/api', (req, res, next) => {
  if (!AUTH_REQUIRED) {
    (req as AuthenticatedRequest).authUser = { id: 'local', email: 'lokal', display_name: 'Lokaler Zugriff', role: 'admin' };
    return next();
  }
  if (!authReady) return res.status(503).json({ error: 'Die Anmeldung wurde auf dem Server noch nicht eingerichtet.' });
  const session = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = session ? dbService.getUserBySession(session) : undefined;
  if (!user) return res.status(401).json({ error: 'Anmeldung erforderlich.' });
  (req as AuthenticatedRequest).authUser = toSafeUser(user);
  next();
});

app.get('/api/users', (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  res.json(dbService.getUsers());
});

app.post('/api/users', (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  const { email, displayName, password, role } = req.body || {};
  if (typeof email !== 'string' || typeof displayName !== 'string' || typeof password !== 'string' || !['admin', 'planner', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Bitte E-Mail, Namen, Rolle und ein Passwort mit mindestens 12 Zeichen angeben.' });
  }
  if (password.length < 12) return res.status(400).json({ error: 'Das Passwort muss mindestens 12 Zeichen lang sein.' });
  if (dbService.getUserByEmail(email)) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits angelegt.' });
  const created = dbService.createUser({ id: crypto.randomUUID(), email, display_name: displayName, role: role as UserRole, password_hash: passwordHash(password) });
  res.status(201).json(toSafeUser(created));
});

app.use('/api', (req, res, next) => {
  const user = (req as AuthenticatedRequest).authUser!;
  const adminOnly = req.path.startsWith('/settings') || req.path.startsWith('/database') || req.path.startsWith('/mail');
  const writeRequest = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if ((adminOnly && user.role !== 'admin') || (writeRequest && !['admin', 'planner'].includes(user.role))) {
    return res.status(403).json({ error: 'Für diese Aktion fehlen die erforderlichen Rechte.' });
  }
  next();
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
    const { name, color, phone, email } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const created = dbService.addHelper(name, color, phone, email);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/helpers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, phone, email } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    dbService.updateHelper(id, name, color, phone, email);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/helpers/all', (req, res) => {
  try {
    dbService.deleteAllHelpers();
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

app.post('/api/helpers/import-stations', (req, res) => {
  try {
    const { stations } = req.body;
    if (!Array.isArray(stations)) return res.status(400).json({ error: 'Ungültige Stationsliste' });
    const result = dbService.importStations(stations);
    res.json({ success: true, ...result });
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
    const { assigned_helper_id, assigned_helper_name, notes, geojson, length_meters, lighting_side } = req.body;

    if (assigned_helper_id !== undefined || assigned_helper_name !== undefined) {
      dbService.updateSectionHelper(id, assigned_helper_id, assigned_helper_name);
    }
    if (notes !== undefined) {
      dbService.updateSectionNotes(id, notes);
    }
    if (lighting_side !== undefined) {
      if (!['both', 'left', 'right'].includes(lighting_side)) {
        return res.status(400).json({ error: 'Straßenseite ungültig' });
      }
      dbService.updateSectionLightingSide(id, lighting_side);
    }
    if (geojson !== undefined || length_meters !== undefined) {
      if (!geojson || !Number.isFinite(Number(length_meters)) || Number(length_meters) <= 0) {
        return res.status(400).json({ error: 'Geometrie oder Streckenlänge ungültig' });
      }
      dbService.updateSectionGeometry(id, geojson, Number(length_meters));
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

const mailTemplate = (template: string, helper: { name: string }, link: string, meters: number) =>
  template
    .replaceAll('{{name}}', helper.name)
    .replaceAll('{{link}}', link)
    .replaceAll('{{meter}}', String(Math.round(meters)));

const getSmtpTransport = () => {
  const settings = dbService.getAllSettings();
  const host = settings.smtp_host?.trim();
  const port = Number(settings.smtp_port || 587);
  const user = settings.smtp_user?.trim();
  const password = smtpPasswordOverride || process.env.SMTP_PASSWORD?.trim();
  const from = settings.smtp_from?.trim();
  const configuredSecurity = settings.smtp_security?.trim();
  const security = configuredSecurity === 'ssl' || configuredSecurity === 'starttls' || configuredSecurity === 'none'
    ? configuredSecurity
    : port === 465 ? 'ssl' : 'starttls';
  if (!host || !Number.isFinite(port) || !user || !password || !from) {
    throw new Error('SMTP ist noch nicht vollständig eingerichtet (Host, Port, Benutzer, Absender und SMTP_PASSWORD).');
  }
  return {
    transport: nodemailer.createTransport({
      host, port,
      secure: security === 'ssl',
      requireTLS: security === 'starttls',
      ignoreTLS: security === 'none',
      auth: { user, pass: password }
    }),
    from,
    settings
  };
};

app.get('/api/mail/log', (req, res) => {
  res.json(dbService.getMailLog());
});

app.post('/api/mail/test', async (req, res) => {
  const recipient = String(req.body?.to || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) return res.status(400).json({ error: 'Bitte eine gültige Empfänger-E-Mail-Adresse angeben.' });
  try {
    const { transport, from, settings } = getSmtpTransport();
    const subject = `[Test] ${settings.event_name || 'Lichternacht'} – Versand eingerichtet`;
    await transport.sendMail({ from, to: recipient, subject, text: 'Dies ist eine Test-E-Mail des Lichternacht-Streckenplaners. Der SMTP-Versand ist erreichbar.' });
    dbService.addMailLog({ recipient, subject, status: 'test' });
    res.json({ success: true });
  } catch (err: any) {
    dbService.addMailLog({ recipient, subject: '[Test] SMTP', status: 'failed', errorMessage: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mail/helpers', async (req, res) => {
  const requestedIds = Array.isArray(req.body?.helperIds) ? new Set(req.body.helperIds.map(String)) : null;
  try {
    const { transport, from, settings } = getSmtpTransport();
    const baseUrl = (settings.public_base_url || '').trim().replace(/\/$/, '');
    if (!baseUrl.startsWith('https://')) throw new Error('Bitte zuerst die öffentliche HTTPS-Adresse in den Grundeinstellungen speichern.');
    const subjectTemplate = settings.mail_subject || '{{event}}: Dein Beleuchtungsbereich';
    const bodyTemplate = settings.mail_body || 'Hallo {{name}},\n\nhier ist dein persönlicher Bereich für die Lichternacht:\n{{link}}\n\nUmfang: ca. {{meter}} m\n\nVielen Dank für deine Unterstützung!';
    const helpers = dbService.getHelpers().filter(helper => helper.email && helper.public_token && (!requestedIds || requestedIds.has(helper.id)));
    let sent = 0; let failed = 0;
    for (const helper of helpers) {
      const sections = dbService.getPublicHelper(helper.public_token!)?.sections || [];
      const meters = sections.reduce((sum, section) => sum + section.length_meters, 0);
      const link = `${baseUrl}/helfer/${helper.public_token}`;
      const subject = mailTemplate(subjectTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters);
      const text = mailTemplate(bodyTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters);
      try {
        await transport.sendMail({ from, to: helper.email, subject, text });
        dbService.addMailLog({ helperId: helper.id, recipient: helper.email, subject, status: 'sent' }); sent++;
      } catch (err: any) {
        dbService.addMailLog({ helperId: helper.id, recipient: helper.email, subject, status: 'failed', errorMessage: err.message }); failed++;
      }
    }
    res.json({ success: true, sent, failed, eligible: helpers.length });
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

// SMTP secrets deliberately do not enter SQLite, JSON exports or the browser.
// The production service already reads this root-only EnvironmentFile at boot.
app.post('/api/settings/smtp-password', (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 1 || /[\r\n]/.test(password)) return res.status(400).json({ error: 'Bitte ein gültiges SMTP-Passwort eingeben.' });
  const envFile = process.env.LICHTERNACHT_ENV_FILE || '/etc/lichternacht/lichternacht.env';
  try {
    const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const escaped = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const line = `SMTP_PASSWORD="${escaped}"`;
    const next = /^SMTP_PASSWORD=.*$/m.test(current)
      ? current.replace(/^SMTP_PASSWORD=.*$/m, line)
      : `${current.trimEnd()}${current.trimEnd() ? '\n' : ''}${line}\n`;
    fs.writeFileSync(envFile, next, { mode: 0o600 });
    fs.chmodSync(envFile, 0o600);
    smtpPasswordOverride = password;
    process.env.SMTP_PASSWORD = password;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `SMTP-Passwort konnte nicht im Server-Environment gespeichert werden: ${err.message}` });
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

const HOST = AUTH_REQUIRED && !authReady ? '127.0.0.1' : '0.0.0.0';
if (AUTH_REQUIRED && !authReady) {
  console.error('[Sicherheit] Kein Admin-Konto gefunden. Der Server bleibt bis zur Einrichtung auf 127.0.0.1 gebunden.');
}
app.listen(PORT, HOST, () => {
  console.log(`Lichternacht Backend Server läuft auf ${HOST}:${PORT}`);
});
