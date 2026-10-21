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
  });
});
