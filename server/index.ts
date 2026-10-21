import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { formatMailText, plainMailText } from '../src/utils/mailFormatting.ts';
import { dbService, type UserRecord, type UserRole } from './db.ts';
import { getBechhofenStreets, getStreetGeometry } from './overpass.ts';
import { getFootRoute } from './routing.ts';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const authRequired = process.env.AUTH_REQUIRED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
const AUTH_REQUIRED = authRequired.toLowerCase() !== 'false';
const SESSION_COOKIE = 'lichternacht_session';
const SESSION_DAYS = 14;
const MIN_PASSWORD_LENGTH = 8;
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
  const configured = email && password && password.length >= MIN_PASSWORD_LENGTH
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

const mailTemplate = (template: string, helper: { name: string }, link: string, meters: number) =>
  template
    .replaceAll('{{name}}', helper.name)
    .replaceAll('{{link}}', link)
    .replaceAll('{{meter}}', String(Math.round(meters)));

const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character] || character);

const renderEmailHtml = ({
  eventName,
  heading,
  message,
  actionUrl,
  actionLabel,
}: {
  eventName: string;
  heading: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}) => {
  const safeUrl = actionUrl ? escapeEmailHtml(actionUrl) : '';
  const safeMessage = formatMailText(message)
    .replaceAll(safeUrl, safeUrl ? `<a href="${safeUrl}" style="color:#0F5CC0;text-decoration:underline;">Ihren persönlichen Bereich auf der Karte öffnen</a>` : '')
    .replace(/\r?\n/g, '<br>');
  return `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#ffffff;color:#1F2937;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:760px;background:#ffffff;">
<tr><td style="padding:24px 32px;background:#152039;color:#ffffff;"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#F6A500;">${escapeEmailHtml(eventName)}</div><div style="margin-top:6px;font-size:24px;font-weight:700;line-height:1.25;">${escapeEmailHtml(heading)}</div></td></tr>
<tr><td style="padding:30px 32px 22px;font-size:16px;line-height:1.65;color:#1F2937;">${safeMessage}</td></tr>
${safeUrl ? `<tr><td style="padding:0 32px 30px;"><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:5px;background:#F6A500;color:#172033;font-weight:700;text-decoration:none;">${escapeEmailHtml(actionLabel || 'Bereich öffnen')}</a></td></tr>` : ''}
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.5;color:#6B7280;">Diese Nachricht wurde über den Lichternacht-Streckenplaner versendet.</td></tr>
</table></td></tr></table></body></html>`;
};

const getSmtpTransport = () => {
  const settings = dbService.getAllSettings();
  const host = settings.smtp_host?.trim();
  const port = Number(settings.smtp_port || 587);
  const user = settings.smtp_user?.trim();
  const password = smtpPasswordOverride || process.env.SMTP_PASSWORD?.trim();
  const fromAddress = settings.smtp_from?.trim();
  const configuredSecurity = settings.smtp_security?.trim();
  const security = configuredSecurity === 'ssl' || configuredSecurity === 'starttls' || configuredSecurity === 'none'
    ? configuredSecurity
    : port === 465 ? 'ssl' : 'starttls';
  if (!host || !Number.isFinite(port) || !user || !password || !fromAddress) {
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
    from: `"Planung Lichternacht" <${fromAddress}>`,
    settings
  };
};

async function sendUserInviteEmail(user: UserRecord, token: string, inviteUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { transport, from, settings } = getSmtpTransport();
    const eventName = settings.event_name || 'Lichternacht';
    const roleLabels: Record<string, string> = {
      admin: 'Administrator (Volle Rechte & Benutzerverwaltung)',
      planner: 'Planung (Strecken erfassen, Abschnitte einteilen, Helfer zuweisen)',
      viewer: 'Lesen (Einsicht in Strecken & Pläne)'
    };
    const roleText = roleLabels[user.role] || user.role;
    const subject = `[Zugang] ${eventName} – Einladung zur Streckenplanung`;
    const message = `Hallo ${user.display_name},\n\nfür Sie wurde ein persönlicher Zugang zur Streckenplanung der ${eventName} eingerichtet.\n\nIhre Rolle: ${roleText}\nBenutzername / E-Mail: ${user.email}\n\nBitte klicken Sie auf den folgenden Button, um Ihr persönliches Passwort festzulegen (mindestens ${MIN_PASSWORD_LENGTH} Zeichen) und Ihren Zugang zu aktivieren:\n${inviteUrl}\n\nDieser Link ist aus Sicherheitsgründen 48 Stunden gültig.`;
    const html = renderEmailHtml({
      eventName,
      heading: 'Willkommen im Planungsteam',
      message,
      actionUrl: inviteUrl,
      actionLabel: 'Passwort jetzt erstellen & aktivieren'
    });
    await transport.sendMail({ from, to: user.email, cc: settings.smtp_cc?.trim() || undefined, subject, text: `${message}\n\n${inviteUrl}`, html });
    dbService.addMailLog({ recipient: user.email, subject, status: 'sent' });
    return { success: true };
  } catch (err: any) {
    dbService.addMailLog({ recipient: user.email, subject: '[Einladung] Streckenplanung', status: 'failed', errorMessage: err.message });
    return { success: false, error: err.message };
  }
}

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

// Public endpoints for token-based password setup / invitations
app.get('/api/auth/verify-token', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Kein Token angegeben.' });
  const result = dbService.getUserByResetToken(token);
  if (!result) return res.status(404).json({ error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' });
  res.json({
    valid: true,
    email: result.user.email,
    displayName: result.user.display_name,
    role: result.user.role
  });
});

app.post('/api/auth/set-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Kein Token angegeben.' });
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }
  const result = dbService.getUserByResetToken(token);
  if (!result) return res.status(404).json({ error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' });

  dbService.setUserPassword(result.user.id, passwordHash(password));

  res.json({ success: true, user: toSafeUser(result.user) });
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

app.put('/api/auth/profile', (req, res) => {
  const identity = (req as AuthenticatedRequest).authUser!;
  const user = dbService.getUserById(identity.id);
  if (!user) return res.status(404).json({ error: 'Benutzerkonto nicht gefunden.' });
  const { displayName, email, currentPassword, newPassword } = req.body || {};
  if (typeof displayName !== 'string' || !displayName.trim() || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Bitte einen Namen und eine gültige E-Mail-Adresse angeben.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const passwordChange = newPassword !== undefined && newPassword !== '';
  if (passwordChange && (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH)) {
    return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen lang sein.' });
  }
  if ((passwordChange || cleanEmail !== user.email) && (typeof currentPassword !== 'string' || !passwordMatches(currentPassword, user.password_hash))) {
    return res.status(400).json({ error: 'Bitte das korrekte aktuelle Passwort eingeben.' });
  }
  const duplicate = dbService.getUserByEmail(cleanEmail);
  if (duplicate && duplicate.id !== user.id) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });
  const updated = dbService.updateUser(user.id, { email: cleanEmail, display_name: displayName.trim(), role: user.role })!;
  if (passwordChange) {
    dbService.setUserPassword(user.id, passwordHash(newPassword));
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    dbService.createSession(sessionId, user.id, expires.toISOString());
    res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'strict', secure: req.secure, expires, path: '/' });
  }
  res.json(toSafeUser(updated));
});

app.get('/api/users', (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  res.json(dbService.getUsers());
});

app.post('/api/users', async (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  const { email, displayName, password, role, sendInviteMail } = req.body || {};
  if (typeof email !== 'string' || typeof displayName !== 'string' || !['admin', 'planner', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Bitte E-Mail, Namen und eine gültige Rolle angeben.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const cleanDisplayName = displayName.trim();
  if (!cleanEmail || !cleanDisplayName) {
    return res.status(400).json({ error: 'Bitte E-Mail und Namen angeben.' });
  }
  if (password && typeof password === 'string' && password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }
  if (dbService.getUserByEmail(cleanEmail)) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits angelegt.' });

  const initialPasswordHash = password ? passwordHash(password) : passwordHash(crypto.randomBytes(32).toString('hex'));
  const created = dbService.createUser({
    id: crypto.randomUUID(),
    email: cleanEmail,
    display_name: cleanDisplayName,
    role: role as UserRole,
    password_hash: initialPasswordHash
  });

  const shouldSendMail = sendInviteMail !== false || !password;
  let inviteUrl: string | undefined;
  let mailSent = false;
  let mailError: string | undefined;

  if (shouldSendMail || !password) {
    const token = dbService.createPasswordResetToken(created.id, 48);
    const settings = dbService.getAllSettings();
    const baseUrl = (settings.public_base_url || '').trim().replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    inviteUrl = `${baseUrl}/passwort-setzen/${token}`;

    const mailResult = await sendUserInviteEmail(created, token, inviteUrl);
    mailSent = mailResult.success;
    mailError = mailResult.error;
  }

  res.status(201).json({
    user: toSafeUser(created),
    mailSent,
    mailError,
    inviteUrl
  });
});

app.post('/api/users/:id/invite', async (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  const targetUser = dbService.getUserById(req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

  const token = dbService.createPasswordResetToken(targetUser.id, 48);
  const settings = dbService.getAllSettings();
  const baseUrl = (settings.public_base_url || '').trim().replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/passwort-setzen/${token}`;

  const mailResult = await sendUserInviteEmail(targetUser, token, inviteUrl);
  res.json({
    success: true,
    mailSent: mailResult.success,
    mailError: mailResult.error,
    inviteUrl
  });
});

app.put('/api/users/:id', (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  const targetUser = dbService.getUserById(req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

  const { email, displayName, role } = req.body || {};
  if (typeof email !== 'string' || typeof displayName !== 'string' || !['admin', 'planner', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Bitte E-Mail, Namen und eine gültige Rolle angeben.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const cleanDisplayName = displayName.trim();
  if (!cleanEmail || !cleanDisplayName) return res.status(400).json({ error: 'Bitte E-Mail und Namen angeben.' });
  const sameEmailUser = dbService.getUserByEmail(cleanEmail);
  if (sameEmailUser && sameEmailUser.id !== targetUser.id) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits angelegt.' });
  if (targetUser.id === user.id && role !== 'admin') return res.status(400).json({ error: 'Das eigene Administratorkonto muss Administrator bleiben.' });

  const updated = dbService.updateUser(targetUser.id, {
    email: cleanEmail,
    display_name: cleanDisplayName,
    role: role as UserRole
  });
  res.json(toSafeUser(updated!));
});

app.delete('/api/users/:id', (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Benutzer verwalten.' });
  const { id } = req.params;
  if (id === user.id) return res.status(400).json({ error: 'Das eigene Administratorkonto kann nicht gelöscht werden.' });
  dbService.deleteUser(id);
  res.json({ success: true });
});

app.use('/api', (req, res, next) => {
  const user = (req as AuthenticatedRequest).authUser!;
  const isGet = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  // Settings:
  // - Reading settings (GET /api/settings) is allowed for everyone (admin, planner, viewer)
  // - Writing settings (PUT /api/settings/:key):
  //   * Admin can write all settings
  //   * Planner can write planning & display settings
  if (req.path.startsWith('/settings')) {
    if (isGet) return next();
    if (user.role === 'admin') return next();
    if (user.role === 'planner' && req.method === 'PUT') {
      const allowedPlannerSettings = [
        'candle_spacing',
        'candle_buffer',
        'map_tile_theme',
        'theme',
        'distribution_default_chunk_length',
        'distribution_min_work_meters',
        'distribution_max_work_meters',
        'distribution_max_difference_meters',
        'distribution_assignment_mode'
      ];
      const key = req.path.replace(/^\/settings\/?/, '');
      if (allowedPlannerSettings.includes(key)) {
        return next();
      }
    }
    return res.status(403).json({ error: 'Für diese Einstellung fehlen Administrator-Rechte.' });
  }

  // Database:
  // - Reset (POST /api/database/reset): strictly admin-only
  // - Backup export, import, migrate: allowed for admin and planner
  if (req.path.startsWith('/database')) {
    if (req.path === '/database/reset') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen die gesamte Datenbank zurücksetzen.' });
      return next();
    }
    if (['admin', 'planner'].includes(user.role)) return next();
    return res.status(403).json({ error: 'Für diese Datenbank-Aktion fehlen die erforderlichen Rechte.' });
  }

  // Mail:
  // - Helper mails: admin and planner
  // - Mail log & test mail: admin only
  if (req.path.startsWith('/mail')) {
    if (req.path === '/mail/helpers' && ['admin', 'planner'].includes(user.role)) {
      return next();
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren dürfen E-Mail-Einstellungen und Logs verwalten.' });
    }
    return next();
  }

  // All other write requests (streets, sections, helpers) are allowed for admin and planner:
  if (!isGet && !['admin', 'planner'].includes(user.role)) {
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
    const streets = await getBechhofenStreets({ city: String(req.query.city || ''), postalCode: String(req.query.postalCode || '') });
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

    const result = await getStreetGeometry(name.trim(), { city: String(req.query.city || ''), postalCode: String(req.query.postalCode || '') });
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

const recentlySentTestMails = new Map<string, number>();

app.get('/api/mail/log', (req, res) => {
  res.json(dbService.getMailLog());
});

app.post('/api/mail/test', async (req, res) => {
  const recipient = String(req.body?.to || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(recipient)) return res.status(400).json({ error: 'Bitte eine gültige Empfänger-E-Mail-Adresse angeben.' });
  const lastSentAt = recentlySentTestMails.get(recipient);
  if (lastSentAt && Date.now() - lastSentAt < 15_000) return res.json({ success: true, duplicate: true });
  recentlySentTestMails.set(recipient, Date.now());
  try {
    const { transport, from, settings } = getSmtpTransport();
    const subject = `[Test] ${settings.event_name || 'Lichternacht'} – Versand eingerichtet`;
    const text = 'Dies ist eine Test-E-Mail des Lichternacht-Streckenplaners. Der SMTP-Versand ist erreichbar.';
    const html = renderEmailHtml({ eventName: settings.event_name || 'Lichternacht', heading: 'SMTP-Test erfolgreich', message: text });
    await transport.sendMail({ from, to: recipient, cc: settings.smtp_cc?.trim() || undefined, subject, text, html });
    dbService.addMailLog({ recipient, subject, status: 'test' });
    res.json({ success: true });
  } catch (err: any) {
    recentlySentTestMails.delete(recipient);
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
    const subjectTemplate = settings.mail_subject || '{{event}}: Ihr Beleuchtungsbereich';
    const bodyTemplate = settings.mail_body || 'Hallo {{name}},\n\nhier ist Ihr persönlicher Bereich für die Lichternacht:\n{{link}}\n\nUmfang: ca. {{meter}} m\n\nVielen Dank für Ihre Unterstützung!';
    const helpers = dbService.getHelpers().filter(helper => helper.email && helper.public_token && (!requestedIds || requestedIds.has(helper.id)));
    let sent = 0; let failed = 0;
    for (const helper of helpers) {
      const sections = dbService.getPublicHelper(helper.public_token!)?.sections || [];
      const meters = sections.reduce((sum, section) => sum + section.length_meters, 0);
      const link = `${baseUrl}/helfer/${helper.public_token}`;
      const subject = mailTemplate(subjectTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters);
      const text = mailTemplate(bodyTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters);
      const html = renderEmailHtml({
        eventName: settings.event_name || 'Lichternacht',
        heading: 'Ihr Beleuchtungsbereich',
        message: text,
        actionUrl: link,
        actionLabel: 'Persönlichen Bereich öffnen',
      });
      try {
        await transport.sendMail({ from, to: helper.email, cc: settings.smtp_cc?.trim() || undefined, subject, text: plainMailText(text), html });
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

app.post('/api/mail/helpers/preview', async (_req, res) => {
  try {
    const { transport, from, settings } = getSmtpTransport();
    const recipient = settings.smtp_cc?.trim().toLowerCase();
    if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
      throw new Error('Bitte zuerst unter „Admin-Kopie (CC)“ eine gültige Admin-E-Mail-Adresse speichern.');
    }
    const baseUrl = (settings.public_base_url || '').trim().replace(/\/$/, '');
    if (!baseUrl.startsWith('https://')) throw new Error('Bitte zuerst die öffentliche HTTPS-Adresse in den Grundeinstellungen speichern.');
    const helper = dbService.getHelpers().find(candidate => candidate.public_token && (dbService.getPublicHelper(candidate.public_token)?.sections.length || 0) > 0);
    if (!helper?.public_token) throw new Error('Für die Vorschau wird mindestens ein Helfer mit zugewiesenem Abschnitt benötigt.');
    const sections = dbService.getPublicHelper(helper.public_token)?.sections || [];
    const meters = sections.reduce((sum, section) => sum + section.length_meters, 0);
    const link = `${baseUrl}/helfer/${helper.public_token}`;
    const subjectTemplate = settings.mail_subject || '{{event}}: Ihr Beleuchtungsbereich';
    const bodyTemplate = settings.mail_body || 'Hallo {{name}},\n\nhier ist Ihr persönlicher Bereich für die Lichternacht:\n{{link}}\n\nUmfang: ca. {{meter}} m\n\nVielen Dank für Ihre Unterstützung!';
    const subject = `[Vorschau] ${mailTemplate(subjectTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters)}`;
    const text = mailTemplate(bodyTemplate.replaceAll('{{event}}', settings.event_name || 'Lichternacht'), helper, link, meters);
    const html = renderEmailHtml({
      eventName: settings.event_name || 'Lichternacht',
      heading: 'Ihr Beleuchtungsbereich',
      message: text,
      actionUrl: link,
      actionLabel: 'Persönlichen Bereich öffnen',
    });
    await transport.sendMail({ from, to: recipient, subject, text: plainMailText(text), html });
    dbService.addMailLog({ helperId: helper.id, recipient, subject, status: 'test' });
    res.json({ success: true, helperName: helper.name, recipient });
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
export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    console.log(`Lichternacht Backend Server läuft auf ${HOST}:${PORT}`);
  });
}
