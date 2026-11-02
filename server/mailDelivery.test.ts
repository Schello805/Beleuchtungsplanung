import { describe, expect, it, vi } from 'vitest';
import { sendCheckedMail } from './mailDelivery';

describe('SMTP recipient acceptance', () => {
  const options = { from: 'sender@example.test', to: 'one@example.test, two@example.test', cc: 'admin@example.test', html: '<p>Bereich</p>' };
  it('accepts a station mail only when all recipients were accepted', async () => {
    const result = { accepted: ['one@example.test', 'two@example.test', 'admin@example.test'], rejected: [] };
    const sendMail = vi.fn().mockResolvedValue(result);
    await expect(sendCheckedMail({ sendMail }, options)).resolves.toEqual(result);
    expect(sendMail).toHaveBeenCalledWith(options);
  });
  it('does not report success when only the admin copy was accepted', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['admin@example.test'], rejected: ['one@example.test', 'two@example.test'] });
    await expect(sendCheckedMail({ sendMail }, options)).rejects.toThrow('Mailserver hat abgelehnt: one@example.test, two@example.test. Bereits angenommen: admin@example.test');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('reports a rejected CC even if the station mail was accepted', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['one@example.test'], rejected: [{ address: 'admin@example.test' }] });
    await expect(sendCheckedMail({ sendMail }, options)).rejects.toThrow('Bitte nicht die gesamte Stationsmail erneut senden');
  });
  it('propagates a complete SMTP failure without retrying', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('550 rejected'));
    await expect(sendCheckedMail({ sendMail }, options)).rejects.toThrow('550 rejected');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('does not assume success for a missing acceptance confirmation', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: [], rejected: [] });
    await expect(sendCheckedMail({ sendMail }, options)).rejects.toThrow('Versandstatus unklar');
  });
});
