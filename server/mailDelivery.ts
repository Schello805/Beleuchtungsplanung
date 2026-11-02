import type { SendMailOptions, SentMessageInfo } from 'nodemailer';

const addressText = (value: unknown): string => typeof value === 'string' ? value
  : value && typeof value === 'object' && 'address' in value ? String(value.address) : '';

export async function sendCheckedMail(transport: { sendMail: (options: SendMailOptions) => Promise<SentMessageInfo> }, options: SendMailOptions) {
  const result = await transport.sendMail(options);
  const accepted = (Array.isArray(result.accepted) ? result.accepted : []).map(addressText).filter(Boolean);
  const rejected = (Array.isArray(result.rejected) ? result.rejected : []).map(addressText).filter(Boolean);
  if (rejected.length) {
    throw new Error(`Mailserver hat abgelehnt: ${rejected.join(', ')}. ${accepted.length
      ? `Bereits angenommen: ${accepted.join(', ')}. Bitte nicht die gesamte Stationsmail erneut senden; diese Empfänger könnten sonst doppelte Nachrichten erhalten.`
      : 'Kein Empfänger wurde angenommen.'}`);
  }
  if (!accepted.length) throw new Error('Der Mailserver hat keine Empfängerannahme bestätigt. Versandstatus unklar; bitte vor erneutem Versand prüfen.');
  return result;
}
