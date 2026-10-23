import { describe, expect, it } from 'vitest';
import { filterImportedSettings, redactRequestUrl } from './security';

describe('security boundaries', () => {
  it('prevents planner imports from changing SMTP and public URL settings', () => {
    const data = { helpers: [], settings: { smtp_host: 'attacker.test', public_base_url: 'https://attacker.test', candle_spacing: '3' } };
    expect(filterImportedSettings(data, 'planner')).toEqual({ helpers: [], settings: { candle_spacing: '3' } });
    expect(filterImportedSettings(data, 'admin')).toEqual(data);
  });
  it('redacts all invitation and helper tokens in request logs', () => {
    expect(redactRequestUrl('/api/auth/verify-token?token=secret&x=1')).toBe('/api/auth/verify-token?token=[redacted]&x=1');
    expect(redactRequestUrl('/api/public/helpers/secret')).toBe('/api/public/helpers/[redacted]');
    expect(redactRequestUrl('/passwort-setzen/secret')).toBe('/passwort-setzen/[redacted]');
  });
});
