import React, { useEffect, useState } from 'react';
import { Check, Copy, Mail, Send, Settings, X } from 'lucide-react';
import { api } from '../utils/api';

interface AdminSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type SettingValues = Record<string, string>;

const defaults: SettingValues = {
  event_name: 'Lichternacht Bechhofen',
  event_location: 'Bechhofen a.d. Heide (PLZ 91572)',
  street_search_city: 'Bechhofen',
  street_search_postal_code: '91572',
  public_base_url: '',
  organizer_name: '',
  organizer_email: '',
  organizer_phone: '',
  currency: 'EUR',
  candle_spacing: '2',
  candle_buffer: '10',
  distribution_default_chunk_length: '40',
  distribution_min_work_meters: '35',
  distribution_max_work_meters: '50',
  distribution_max_difference_meters: '15',
  distribution_assignment_mode: 'station_first',
  mapbox_token: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_security: '',
  smtp_user: '',
  smtp_from: '',
  smtp_cc: '',
  mail_subject: '{{event}}: Dein Beleuchtungsbereich',
  mail_body: 'Hallo {{name}},\n\nhier ist dein persönlicher Bereich für die Lichternacht:\n{{link}}\n\nUmfang: ca. {{meter}} m\n\nVielen Dank für deine Unterstützung!'
};

const fieldLabels: Record<string, string> = {
  event_name: 'Veranstaltungsname',
  event_location: 'Ort / Zusatz',
  street_search_city: 'Karten-Ort für Straßensuche',
  street_search_postal_code: 'Postleitzahl für Straßensuche',
  public_base_url: 'Öffentliche HTTPS-Adresse',
  organizer_name: 'Ansprechperson',
  organizer_email: 'Orga-E-Mail',
  organizer_phone: 'Orga-Telefon',
  currency: 'Währung',
  candle_spacing: 'Kerzenabstand in Metern',
  candle_buffer: 'Materialreserve in Prozent',
  distribution_default_chunk_length: 'Standard-Abschnittslänge in Metern',
  distribution_min_work_meters: 'Minimale Meter pro Helfer',
  distribution_max_work_meters: 'Maximale Meter pro Helfer',
  distribution_max_difference_meters: 'Maximale Differenz in Metern',
  mapbox_token: 'Mapbox Public Token',
  smtp_host: 'SMTP-Host',
  smtp_port: 'SMTP-Port',
  smtp_security: 'Verschlüsselung',
  smtp_user: 'SMTP-Benutzer',
  smtp_from: 'Absender-Adresse',
  smtp_cc: 'Admin-Kopie (CC)'
};

const Field: React.FC<{ name: string; values: SettingValues; onChange: (name: string, value: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }> = ({ name, values, onChange, placeholder, type = 'text', inputMode }) => (
  <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
    {fieldLabels[name]}
    <input
      type={type}
      inputMode={inputMode}
      value={values[name] || ''}
      onChange={event => onChange(name, event.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', minHeight: 40, border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)' }}
    />
  </label>
);

export const AdminSettingsModal: React.FC<AdminSettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [values, setValues] = useState<SettingValues>(defaults);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [mailStatusKind, setMailStatusKind] = useState<'success' | 'error' | null>(null);
  const [mailLog, setMailLog] = useState<Array<{ id: string; helper_name?: string; recipient: string; subject: string; status: string; created_at: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    api.getSettings().then(settings => setValues({ ...defaults, ...settings }));
    setSmtpPassword('');
    api.getMailLog().then(setMailLog).catch(() => setMailLog([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const change = (name: string, value: string) => setValues(current => ({ ...current, [name]: value }));
  const persistValues = async () => {
    await Promise.all(Object.entries(values).map(([key, value]) => api.setSetting(key, value.trim())));
    if (smtpPassword) await api.setSmtpPassword(smtpPassword);
    await onSaved();
  };
  const save = async () => {
    setIsSaving(true);
    try {
      await persistValues();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } finally {
      setIsSaving(false);
    }
  };
  const sendTest = async () => {
    if (isSendingTest) return;
    setIsSendingTest(true);
    setMailStatus(null);
    setMailStatusKind(null);
    try { await persistValues(); await api.sendTestMail(testRecipient); setMailStatus('✓ Test-E-Mail wurde versendet.'); setMailStatusKind('success'); setMailLog(await api.getMailLog()); }
    catch (err: any) { setMailStatus(`✕ Test-E-Mail konnte nicht gesendet werden: ${err.message}`); setMailStatusKind('error'); }
    finally { setIsSendingTest(false); }
  };
  const sendAll = async () => {
    if (isSendingAll) return;
    if (!window.confirm('Jetzt an alle Helfer mit E-Mail-Adresse und persönlichem Link senden?')) return;
    setIsSendingAll(true);
    setMailStatus(null);
    setMailStatusKind(null);
    try { await persistValues(); const result = await api.sendHelperMails(); setMailStatus(`${result.sent} E-Mails versendet${result.failed ? `, ${result.failed} fehlgeschlagen` : ''}.`); setMailStatusKind(result.failed ? 'error' : 'success'); setMailLog(await api.getMailLog()); }
    catch (err: any) { setMailStatus(err.message); setMailStatusKind('error'); }
    finally { setIsSendingAll(false); }
  };

  return (
    <div className="user-modal-backdrop">
      <section className="user-modal admin-settings-modal">
        <button className="user-modal-close" onClick={onClose} aria-label="Einstellungen schließen"><X size={20} /></button>
        <p className="auth-kicker">ADMINISTRATION</p>
        <h2><Settings size={20} /> Grundeinstellungen & Startanleitung</h2>

        <details className="admin-setup-guide">
          <summary>Kurzer Ablauf für die erste Nutzung</summary>
          <ol>
            <li><b>Grundeinstellungen:</b> öffentliche HTTPS-Adresse, Orga-Kontakt und Materialwerte speichern.</li>
            <li><b>Zugänge:</b> unter „Benutzer verwalten“ Planung und Leserechte vergeben.</li>
            <li><b>Stationen:</b> Stationsliste aus der Lichternacht-App importieren.</li>
            <li><b>Straßen:</b> erfassen und die gewünschte Abschnittslänge festlegen.</li>
            <li><b>Verteilen:</b> Stationsbereiche zuerst prüfen, übrige offene Abschnitte in der Besprechung vergeben.</li>
            <li><b>Ausgeben:</b> Helfer-Informationen prüfen, PDF drucken oder später per E-Mail versenden.</li>
          </ol>
        </details>

        <section className="admin-settings-section">
          <h3>Veranstaltung & öffentliche Helfer-Links</h3>
          <p>Die HTTPS-Adresse wird in QR-Codes und persönlichen Helfer-Links verwendet.</p>
          <div className="admin-settings-grid">
            <Field name="event_name" values={values} onChange={change} />
            <Field name="event_location" values={values} onChange={change} />
            <Field name="street_search_city" values={values} onChange={change} placeholder="z. B. Bechhofen" />
            <Field name="street_search_postal_code" values={values} onChange={change} placeholder="z. B. 91572" inputMode="numeric" />
            <Field name="public_base_url" values={values} onChange={change} placeholder="https://beleuchtung.lichternacht-bechhofen.de" type="url" />
            <Field name="currency" values={values} onChange={change} placeholder="EUR" />
          </div>
          <p style={{ marginTop: 10 }}>Die Straßenliste und Geometrie werden ausschließlich innerhalb dieser Orts-/PLZ-Kombination gesucht. So wird beispielsweise keine Industriestraße aus einem anderen Ort übernommen.</p>
        </section>

        <section className="admin-settings-section">
          <h3>Organisation & Material</h3>
          <div className="admin-settings-grid">
            <Field name="organizer_name" values={values} onChange={change} placeholder="z. B. Lichternacht-Orga" />
            <Field name="organizer_email" values={values} onChange={change} placeholder="orga@example.de" type="email" />
            <Field name="organizer_phone" values={values} onChange={change} placeholder="09855 / 12345" type="tel" />
            <Field name="candle_spacing" values={values} onChange={change} type="number" />
            <Field name="candle_buffer" values={values} onChange={change} type="number" />
          </div>
        </section>

        <section className="admin-settings-section">
          <h3>Standardwerte für die Verteilung</h3>
          <p>Diese Werte werden beim Öffnen von „Abschnittslänge einstellen“ und „Verteilung planen“ vorausgefüllt. Sie können dort je Besprechung noch angepasst werden.</p>
          <div className="admin-settings-grid">
            <Field name="distribution_default_chunk_length" values={values} onChange={change} type="number" />
            <Field name="distribution_min_work_meters" values={values} onChange={change} type="number" />
            <Field name="distribution_max_work_meters" values={values} onChange={change} type="number" />
            <Field name="distribution_max_difference_meters" values={values} onChange={change} type="number" />
            <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>Standard-Verteilungsmodus
              <select value={values.distribution_assignment_mode || 'station_first'} onChange={event => change('distribution_assignment_mode', event.target.value)} style={{ width: '100%', minHeight: 40, border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)' }}>
                <option value="station_first">Stationen zuerst, dann zusammenhängend</option>
                <option value="meters_only">Nur nach Metern ausgleichen</option>
              </select>
            </label>
          </div>
        </section>

        <section className="admin-settings-section">
          <h3>Karte</h3>
          <p>Optional für Mapbox-Kartenstile und Satellitenbilder. Die App funktioniert auch ohne Token mit OpenStreetMap. Verwende ausschließlich einen öffentlichen Token, der mit <code>pk.</code> beginnt.</p>
          <div className="admin-settings-grid">
            <Field name="mapbox_token" values={values} onChange={change} placeholder="pk.eyJ1Ijo..." />
          </div>
          <div className="admin-security-note"><Copy size={15} /> Der Token wird zentral für diese Planung gespeichert und an den Browser ausgeliefert. Er ist daher kein Geheimnis: niemals einen <code>sk.</code>-Token eintragen.</div>
        </section>

        <section className="admin-settings-section admin-smtp-settings">
          <h3><Mail size={16} /> E-Mail-Versand (SMTP)</h3>
          <p>Hier liegen die nicht vertraulichen Versanddaten zentral. Der Versand wird erst aktiviert, wenn die Stationsliste E-Mail-Adressen enthält.</p>
          <div className="admin-settings-grid">
            <Field name="smtp_host" values={values} onChange={change} placeholder="mail.example.de" />
            <Field name="smtp_port" values={values} onChange={change} type="number" />
            <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>Verschlüsselung
              <select value={values.smtp_security || (values.smtp_port === '465' ? 'ssl' : 'starttls')} onChange={event => change('smtp_security', event.target.value)} style={{ width: '100%', minHeight: 40, border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)' }}>
                <option value="ssl">SSL/TLS direkt · meist Port 465</option>
                <option value="starttls">TLS/STARTTLS · meist Port 587</option>
                <option value="none">Keine Verschlüsselung · nur bei vertrauenswürdigem lokalen Server</option>
              </select>
            </label>
            <Field name="smtp_user" values={values} onChange={change} placeholder="benutzer" />
            <Field name="smtp_from" values={values} onChange={change} placeholder="lichternacht@example.de" type="email" />
            <Field name="smtp_cc" values={values} onChange={change} placeholder="admin@example.de" type="email" />
            <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>SMTP-Passwort
              <input type="password" autoComplete="new-password" value={smtpPassword} onChange={event => setSmtpPassword(event.target.value)} placeholder="Nur bei Änderung eingeben" style={{ width: '100%', minHeight: 40, border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)' }} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>Test-E-Mail-Adresse
              <input type="email" value={testRecipient} onChange={event => setTestRecipient(event.target.value)} placeholder="test@example.de" style={{ width: '100%', minHeight: 40, border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)' }} />
            </label>
          </div>
          <div className="admin-security-note"><Copy size={15} /> Das Passwort wird nicht in der Datenbank, im Export oder im Browser gespeichert. Es landet nur als <code>SMTP_PASSWORD</code> in <code>/etc/lichternacht/lichternacht.env</code> auf dem Server.</div>
          <div className="admin-mail-actions" style={{ gridTemplateColumns: 'auto 1fr', marginTop: 12 }}>
            <button type="button" onClick={sendTest} disabled={!testRecipient || isSendingTest}><Mail size={15} /> {isSendingTest ? 'Testmail wird gesendet …' : 'Testmail senden'}</button>
          </div>
          {mailStatus && <p style={{ margin: '10px 0 0', padding: '8px 10px', borderRadius: 6, background: mailStatusKind === 'error' ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)', border: `1px solid ${mailStatusKind === 'error' ? 'rgba(239,68,68,.35)' : 'rgba(16,185,129,.35)'}`, color: mailStatusKind === 'error' ? '#FCA5A5' : '#6EE7B7', fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' }}>{mailStatus}</p>}
        </section>

        <section className="admin-settings-section">
          <h3>Mailvorlage & Versand</h3>
          <p>Platzhalter: <code>{'{{event}}'}</code>, <code>{'{{name}}'}</code>, <code>{'{{meter}}'}</code> und <code>{'{{link}}'}</code>.</p>
          <label className="admin-template-field">Betreff<input value={values.mail_subject || ''} onChange={event => change('mail_subject', event.target.value)} /></label>
          <label className="admin-template-field">Nachricht<textarea rows={7} value={values.mail_body || ''} onChange={event => change('mail_body', event.target.value)} /></label>
          <div className="admin-mail-actions">
            <button type="button" className="admin-send-all" onClick={sendAll} disabled={isSendingAll}><Send size={15} /> {isSendingAll ? 'E-Mails werden versendet …' : 'Alle Helfer informieren'}</button>
          </div>
          {mailLog.length > 0 && <div className="admin-mail-log"><strong>Letzte Versandvorgänge</strong>{mailLog.slice(0, 5).map(entry => <span key={entry.id}>{entry.status === 'failed' ? '✕' : '✓'} {entry.recipient} · {entry.status === 'test' ? 'Test' : entry.helper_name || entry.subject}</span>)}</div>}
        </section>

        <div className="admin-settings-footer">
          <button type="button" onClick={onClose}>Schließen</button>
          <button type="button" className="admin-settings-save" disabled={isSaving} onClick={save}><Check size={16} />{isSaving ? 'Speichert …' : saved ? 'Gespeichert' : 'Einstellungen speichern'}</button>
        </div>
      </section>
    </div>
  );
};
