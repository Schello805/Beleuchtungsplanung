import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Express } from 'express';

let server: Server;
let baseUrl = '';
let dataDir = '';

const request = async (pathname: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  return { response, body: await response.json().catch(() => ({})) };
};

describe('user invitation and first login', () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichternacht-auth-test-'));
    process.env.NODE_ENV = 'test';
    process.env.LICHTERNACHT_DATA_DIR = dataDir;
    process.env.AUTH_REQUIRED = 'true';
    process.env.ADMIN_EMAIL = 'admin@example.test';
    process.env.ADMIN_NAME = 'Test-Administration';
    process.env.ADMIN_PASSWORD = 'AdminPasswort8';

    const { app } = await import('./index.ts') as { app: Express };
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Testserver konnte nicht gestartet werden.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates an invitation, accepts an 8-character password, and requires an explicit login', async () => {
    const adminLogin = await request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'AdminPasswort8' })
    });
    expect(adminLogin.response.status).toBe(200);
    const adminCookie = adminLogin.response.headers.get('set-cookie')?.split(';')[0];
    expect(adminCookie).toBeTruthy();

    const created = await request('/api/users', {
      method: 'POST',
      headers: { Cookie: adminCookie! },
      body: JSON.stringify({ email: 'neu@example.test', displayName: 'Neue Planung', role: 'planner', sendInviteMail: true })
    });
    expect(created.response.status).toBe(201);
    expect(created.body.inviteUrl).toMatch(/\/passwort-setzen\/[A-Za-z0-9_-]{20,}$/);

    const token = new URL(created.body.inviteUrl).pathname.split('/').at(-1)!;
    const verified = await request(`/api/auth/verify-token?token=${encodeURIComponent(token)}`);
    expect(verified.response.status).toBe(200);
    expect(verified.body).toMatchObject({ email: 'neu@example.test', displayName: 'Neue Planung', role: 'planner' });

    const tooShort = await request('/api/auth/set-password', {
      method: 'POST', body: JSON.stringify({ token, password: 'Kurz123' })
    });
    expect(tooShort.response.status).toBe(400);
    expect(tooShort.body.error).toContain('mindestens 8 Zeichen');

    const setPassword = await request('/api/auth/set-password', {
      method: 'POST', body: JSON.stringify({ token, password: 'Passwort8' })
    });
    expect(setPassword.response.status).toBe(200);
    expect(setPassword.response.headers.get('set-cookie')).toBeNull();

    const expiredToken = await request(`/api/auth/verify-token?token=${encodeURIComponent(token)}`);
    expect(expiredToken.response.status).toBe(404);

    const firstLogin = await request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'neu@example.test', password: 'Passwort8' })
    });
    expect(firstLogin.response.status).toBe(200);
    expect(firstLogin.response.headers.get('set-cookie')).toContain('lichternacht_session=');
    const cookie = firstLogin.response.headers.get('set-cookie')!.split(';')[0];
    const profile = { displayName: 'Aktualisierte Planung', email: 'neu@example.test', newPassword: 'NeuesPasswort8', currentPassword: 'falsch' };
    const rejected = await request('/api/auth/profile', { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify(profile) });
    expect(rejected.response.status).toBe(400);
    const changed = await request('/api/auth/profile', { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ ...profile, currentPassword: 'Passwort8' }) });
    expect(changed.response.status).toBe(200);
    expect(changed.body.role).toBe('planner');
    expect(changed.body.display_name).toBe('Aktualisierte Planung');
    const previousSession = await request('/api/auth/session', { headers: { Cookie: cookie } });
    expect(previousSession.body.authenticated).toBe(false);
    const newCookie = changed.response.headers.get('set-cookie')!.split(';')[0];
    const renewedSession = await request('/api/auth/session', { headers: { Cookie: newCookie } });
    expect(renewedSession.body.authenticated).toBe(true);
    const oldLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: profile.email, password: 'Passwort8' }) });
    expect(oldLogin.response.status).toBe(401);
    const newLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: profile.email, password: profile.newPassword }) });
    expect(newLogin.response.status).toBe(200);
  });

  it('matches station names across changed numbers and preserves archived assignments for returning clubs', async () => {
    const { dbService, db } = await import('./db.ts');
    const station = (stationId: string, name: string) => ({ stationId, name, latitude: 49.1, longitude: 10.5 });
    dbService.importStations([station('1', 'Verein Alpha'), station('2', 'Verein Beta')]);
    const alpha = dbService.getHelpers().find(helper => helper.name === 'Verein Alpha')!;
    dbService.importStations([station('2', 'Verein Alpha'), station('1', 'Verein Beta')]);
    expect(dbService.getHelpers().find(helper => helper.name === 'Verein Alpha')!.id).toBe(alpha.id);
    dbService.importStations([station('1', 'Verein Beta')], true);
    expect(dbService.getHelpers().some(helper => helper.id === alpha.id)).toBe(false);
    expect(dbService.getPublicHelper(alpha.public_token!)).toBeUndefined();
    expect(dbService.getStationReconciliation([station('99', 'verein alpha')]).returning[0].id).toBe(alpha.id);
    expect((db.prepare('SELECT COUNT(*) AS count FROM station_history WHERE helper_id = ?').get(alpha.id) as { count: number }).count).toBe(1);
    dbService.importStations([station('99', 'Verein Alpha'), station('1', 'Verein Beta')]);
    expect(dbService.getHelpers().find(helper => helper.name === 'Verein Alpha')!.id).toBe(alpha.id);
    expect(dbService.getPublicHelper(alpha.public_token!)).toBeDefined();
  });

  it('persists recipient progress and never resends accepted addresses when continuing a campaign', async () => {
    const { enqueueCampaign, processMailQueue, legacyDeliveryStatus, queueStatus } = await import('./mailQueue.ts');
    expect(legacyDeliveryStatus({ status: 'failed', error_message: 'Connection timeout' }, 'a@example.test').status).toBe('unknown');
    expect(legacyDeliveryStatus({ status: 'failed', error_message: 'Mailserver hat abgelehnt: admin@example.test. Bereits angenommen: a@example.test. Bitte nicht erneut senden' }, 'a@example.test').status).toBe('sent');
    const items = [{ helperId: 'test', helperName: 'Test', to: 'a@example.test, b@example.test', cc: 'admin@example.test', subject: 'Test', text: 'Test', html: '<p>Test</p>' }];
    enqueueCampaign('test-campaign', items, false);
    const sent: string[] = [];
    const send = async (item: any) => { sent.push(item.recipient); return { accepted: [item.recipient], rejected: [] }; };
    const now = Date.now() + 1000;
    await processMailQueue(send, now);
    await processMailQueue(send, now + 1000);
    expect(sent).toHaveLength(1);
    enqueueCampaign('test-campaign', items, false);
    await processMailQueue(send, now + 31_000);
    await processMailQueue(send, now + 62_000);
    expect(new Set(sent).size).toBe(3);
    expect(queueStatus().deliveries.filter((item: any) => item.status === 'sent')).toHaveLength(3);
    enqueueCampaign('test-campaign', items, false);
    await processMailQueue(send, now + 93_000);
    expect(sent).toHaveLength(3);
    const { isSafeConnectionFailure } = await import('./mailQueue.ts');
    expect(isSafeConnectionFailure({ message: 'Connection timeout' })).toBe(true);
    expect(isSafeConnectionFailure({ message: 'TLS handshake timed out' })).toBe(true);
    expect(isSafeConnectionFailure({ message: 'Timeout', command: 'DATA' })).toBe(false);
    enqueueCampaign('connection-retry', [{ ...items[0], to: 'retry@example.test', cc: '' }], false);
    await processMailQueue(async () => { throw new Error('Connection timeout'); }, now + 120_000);
    expect(queueStatus().deliveries[0]).toMatchObject({ status: 'pending', error: 'Connection timeout' });
    const retryClock = queueStatus().nextAt;
    await processMailQueue(send, retryClock - 1);
    expect(sent).toHaveLength(3);
    await processMailQueue(send, retryClock + 1);
    expect(sent).toHaveLength(4);
    expect(queueStatus().deliveries[0]).toMatchObject({ status: 'sent' });
  });

  it('previews and queues only the selected helper, with idempotent retries and explicit resending', async () => {
    const { db, dbService } = await import('./db.ts');
    db.exec('DELETE FROM mail_deliveries; DELETE FROM mail_campaigns;');
    process.env.SMTP_PASSWORD = 'test-only';
    for (const [key, value] of Object.entries({ smtp_host: 'smtp.example.test', smtp_user: 'admin@example.test', smtp_from: 'admin@example.test', smtp_cc: 'copy@example.test', public_base_url: 'https://example.test' })) dbService.setSetting(key, value);
    const selected = dbService.addHelper('Einzelversand Test', undefined, undefined, 'selected@example.test');
    dbService.addHelper('Nicht anschreiben', undefined, undefined, 'other@example.test');
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'AdminPasswort8' }) });
    const headers = { Cookie: login.response.headers.get('set-cookie')!.split(';')[0] };
    const preview = await request('/api/mail/helpers', { method: 'POST', headers, body: JSON.stringify({ helperIds: [selected.id], preview: true }) });
    expect(preview.response.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.to).toBe('selected@example.test');
    expect(preview.body.html).toContain('Einzelversand Test');
    expect(db.prepare('SELECT * FROM mail_deliveries').all()).toHaveLength(0);
    const payload = { single: true, helperIds: [selected.id], requestId: '11111111-1111-4111-8111-111111111111' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const sent = await request('/api/mail/helpers', { method: 'POST', headers, body: JSON.stringify(payload) });
      expect(sent.response.status).toBe(200);
    }
    expect(db.prepare('SELECT recipient FROM mail_deliveries ORDER BY recipient').all()).toEqual([{ recipient: 'copy@example.test' }, { recipient: 'selected@example.test' }]);
    db.exec("UPDATE mail_deliveries SET status = 'sent'");
    const resend = await request('/api/mail/helpers', { method: 'POST', headers, body: JSON.stringify({ ...payload, requestId: '22222222-2222-4222-8222-222222222222' }) });
    expect(resend.response.status).toBe(200);
    expect(db.prepare('SELECT * FROM mail_deliveries').all()).toHaveLength(4);
    const invalid = await request('/api/mail/helpers', { method: 'POST', headers, body: JSON.stringify({ single: true, requestId: payload.requestId }) });
    expect(invalid.response.status).toBe(400);
  });

  it('limits repeated failed login attempts', async () => {
    let status = 0;
    for (let attempt = 0; attempt < 21; attempt++) {
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'unknown@example.test', password: 'incorrect' }) });
      status = result.response.status;
    }
    expect(status).toBe(429);
  });
});
