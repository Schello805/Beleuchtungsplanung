import crypto from 'node:crypto';
import { db, dbService } from './db.ts';

db.exec(`CREATE TABLE IF NOT EXISTS mail_campaigns (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_deliveries (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, helper_id TEXT NOT NULL, helper_name TEXT NOT NULL,
 recipient TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL, html TEXT NOT NULL,
 status TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(campaign_id, helper_id, recipient));
CREATE TABLE IF NOT EXISTS mail_queue_clock (id INTEGER PRIMARY KEY, next_at INTEGER NOT NULL);
INSERT OR IGNORE INTO mail_queue_clock VALUES (1, 0);`);
if (!(db.prepare('PRAGMA table_info(mail_deliveries)').all() as Array<{ name: string }>).some(column => column.name === 'cc')) {
  // Keep the legacy setting/column name; copies are sent via SMTP BCC.
  db.exec("ALTER TABLE mail_deliveries ADD COLUMN cc TEXT NOT NULL DEFAULT ''");
}
db.prepare("UPDATE mail_deliveries SET status = 'unknown', error = 'Server während Versand neu gestartet. Annahme unklar; bitte prüfen.' WHERE status = 'sending'").run();
// These errors occur before SMTP can transmit a message, so retrying is safe.
db.prepare("UPDATE mail_deliveries SET status = 'pending' WHERE status = 'unknown' AND error IN ('Connection timeout', 'TLS handshake timed out', 'Greeting never received')").run();

export function isSafeConnectionFailure(error: { message?: string; command?: string; code?: string }) {
  return /^(Connection timeout|TLS handshake timed out|Greeting never received)$/i.test(error.message || '')
    || ['EDNS', 'ECONNECTION', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code || '')
    || (error.command === 'CONN' && /timeout|timed out/i.test(error.message || ''));
}
let lastTickAt = 0;
let busySince = 0;
let lastWorkerError: string | null = null;

export type Delivery = { id: string; campaign_id: string; helper_id: string; helper_name: string; recipient: string; cc: string; subject: string; text: string; html: string; status: string; error: string | null; updated_at: string };
export const splitRecipients = (value: string) => [...new Set(value.split(/[,;\n]+/).map(address => address.trim().toLowerCase()).filter(Boolean))];

export function legacyDeliveryStatus(log: { status: string; error_message?: string | null } | undefined, address: string): { status: string; error: string | null } {
  if (!log) return { status: 'pending', error: null };
  if (log.status === 'sent') return { status: 'sent', error: 'Aus bisherigem Versandprotokoll übernommen.' };
  const error = log.error_message || '';
  const accepted = error.match(/Bereits angenommen: (.*?)\. Bitte/);
  if (accepted && splitRecipients(accepted[1]).includes(address)) return { status: 'sent', error: 'Teilannahme aus bisherigem Versandprotokoll übernommen.' };
  if (/timeout|timed out|ECONNRESET|socket|connection closed/i.test(error)) return { status: 'unknown', error };
  return { status: 'pending', error };
}

export function enqueueCampaign(id: string, items: Array<{ helperId: string; helperName: string; to: string; cc: string; subject: string; text: string; html: string }>, recover: boolean) {
  db.exec('BEGIN');
  try {
    const exists = db.prepare('SELECT id FROM mail_campaigns WHERE id = ?').get(id);
    if (!exists) {
      if (db.prepare("SELECT id FROM mail_deliveries WHERE status IN ('pending', 'sending', 'unknown') LIMIT 1").get()) throw new Error('Es besteht bereits ein Versandauftrag mit offenen oder unklaren Empfängern. Bitte zuerst diesen Auftrag prüfen und abschließen.');
      db.prepare('INSERT INTO mail_campaigns VALUES (?, ?)').run(id, new Date().toISOString());
      for (const item of items) {
        const addresses = splitRecipients(item.to);
        const copies = splitRecipients(item.cc);
        if (!addresses.length || [...addresses, ...copies].some(address => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))) throw new Error(`Ungültige E-Mail-Adresse bei ${item.helperName}`);
        const log = recover ? db.prepare("SELECT status, error_message FROM mail_log WHERE helper_id = ? AND subject = ? AND status != 'test' ORDER BY created_at DESC LIMIT 1").get(item.helperId, item.subject) as { status: string; error_message?: string | null } | undefined : undefined;
        for (const recipient of addresses) {
          const prior = legacyDeliveryStatus(log, recipient);
          db.prepare('INSERT INTO mail_deliveries (id, campaign_id, helper_id, helper_name, recipient, subject, text, html, status, error, updated_at, cc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), id, item.helperId, item.helperName, recipient, item.subject, item.text, item.html, prior.status, prior.error, new Date().toISOString(), copies.filter(address => address !== recipient).join(', '));
        }
      }
    }
    // An explicit continuation retries rejected addresses, never sent/unknown ones.
    db.prepare("UPDATE mail_deliveries SET status = 'pending' WHERE campaign_id = ? AND status = 'failed'").run(id);
    if (recover && !exists) db.prepare('UPDATE mail_queue_clock SET next_at = MAX(next_at, ?) WHERE id = 1').run(Date.now() + 11 * 60_000);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return queueStatus();
}

export function queueStatus() {
  const latest = db.prepare('SELECT id FROM mail_campaigns ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined;
  return { campaignId: latest?.id, lastTickAt, busySince, lastWorkerError, serverNow: Date.now(), nextAt: (db.prepare('SELECT next_at FROM mail_queue_clock WHERE id = 1').get() as { next_at: number }).next_at,
    deliveries: latest ? db.prepare('SELECT id, helper_name, recipient, status, error, updated_at FROM mail_deliveries WHERE campaign_id = ? ORDER BY helper_name, recipient').all(latest.id) : [] };
}

export function retryUnknown(id: string) {
  db.prepare("UPDATE mail_deliveries SET status = 'pending', error = NULL WHERE id = ? AND status = 'unknown'").run(id);
}

let busy = false;
export async function processMailQueue(send: (item: Delivery) => Promise<any>, now = Date.now()) {
  lastTickAt = Date.now();
  if (busy) return;
  busy = true;
  busySince = Date.now();
  try {
    const clock = db.prepare('SELECT next_at FROM mail_queue_clock WHERE id = 1').get() as { next_at: number };
    if (clock.next_at > now) return;
    const item = db.prepare("SELECT * FROM mail_deliveries WHERE status = 'pending' ORDER BY updated_at, id LIMIT 1").get() as Delivery | undefined;
    if (!item) return;
    console.info(`[Mailqueue] Versandstart ${item.id} (${item.helper_name})`);
    db.prepare("UPDATE mail_deliveries SET status = 'sending' WHERE id = ? AND status = 'pending'").run(item.id);
    db.prepare('UPDATE mail_queue_clock SET next_at = ? WHERE id = 1').run(now + 30_000);
    let status = 'sent', error: string | null = null;
    try {
      const info = await send(item);
      const accepted = (info.accepted || []).map((address: any) => String(typeof address === 'string' ? address : address.address).toLowerCase());
      // Never send the main message again just because a BCC address was rejected.
      const missingCopies = splitRecipients(item.cc).filter(address => !accepted.includes(address));
      if (missingCopies.length) error = `Admin-BCC nicht bestätigt: ${missingCopies.join(', ')}.`;
      if (!accepted.includes(item.recipient)) {
        status = (info.rejected || []).length ? 'failed' : 'unknown';
        error = 'Mailserver hat diese Adresse nicht als angenommen bestätigt.';
        db.prepare('UPDATE mail_deliveries SET cc = ? WHERE id = ?').run(missingCopies.join(', '), item.id);
      }
    } catch (err: any) {
      error = err.message || String(err);
      if (/limit|too many|rate.?limit|throttl/i.test(error!)) {
        status = 'pending';
        db.prepare('UPDATE mail_queue_clock SET next_at = ? WHERE id = 1').run(now + 11 * 60_000);
      } else if (isSafeConnectionFailure(err)) {
        status = 'pending';
        db.prepare('UPDATE mail_queue_clock SET next_at = ? WHERE id = 1').run(now + 2 * 60_000);
      } else status = /timeout|timed out|ECONNRESET|socket|connection closed/i.test(error!) ? 'unknown' : 'failed';
    }
    db.prepare('UPDATE mail_deliveries SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, new Date().toISOString(), item.id);
    const helperExists = db.prepare('SELECT id FROM helpers WHERE id = ?').get(item.helper_id);
    dbService.addMailLog({ helperId: helperExists ? item.helper_id : null, recipient: item.recipient, subject: item.subject, status: status === 'sent' ? 'sent' : 'failed', errorMessage: error });
    lastWorkerError = null;
    console.info(`[Mailqueue] ${item.id}: ${status}${error ? ` – ${error}` : ''}`);
  } catch (error) {
    lastWorkerError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally { busy = false; busySince = 0; }
}
