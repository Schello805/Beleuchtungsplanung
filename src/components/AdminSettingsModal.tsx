import React, { useEffect, useState } from 'react';
import { Check, Copy, Mail, Settings, X } from 'lucide-react';
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
  public_base_url: '',
  organizer_name: '',
  organizer_email: '',
  organizer_phone: '',
  currency: 'EUR',
  candle_spacing: '2',
  candle_buffer: '10',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_from: ''
};

const fieldLabels: Record<string, string> = {
  event_name: 'Veranstaltungsname',
  event_location: 'Ort / Zusatz',
  public_base_url: 'Öffentliche HTTPS-Adresse',
  organizer_name: 'Ansprechperson',
  organizer_email: 'Orga-E-Mail',
  organizer_phone: 'Orga-Telefon',
  currency: 'Währung',
  candle_spacing: 'Kerzenabstand in Metern',
  candle_buffer: 'Materialreserve in Prozent',
  smtp_host: 'SMTP-Host',
  smtp_port: 'SMTP-Port',
  smtp_user: 'SMTP-Benutzer',
  smtp_from: 'Absender-Adresse'
};

const Field: React.FC<{ name: string; values: SettingValues; onChange: (name: string, value: string) => void; placeholder?: string; type?: string }> = ({ name, values, onChange, placeholder, type = 'text' }) => (
  <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
    {fieldLabels[name]}
    <input
      type={type}
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

  useEffect(() => {
    if (!isOpen) return;
    api.getSettings().then(settings => setValues({ ...defaults, ...settings }));
  }, [isOpen]);

  if (!isOpen) return null;

  const change = (name: string, value: string) => setValues(current => ({ ...current, [name]: value }));
  const save = async () => {
    setIsSaving(true);
    try {
      await Promise.all(Object.entries(values).map(([key, value]) => api.setSetting(key, value.trim())));
      await onSaved();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="user-modal-backdrop">
      <section className="user-modal admin-settings-modal">
        <button className="user-modal-close" onClick={onClose} aria-label="Einstellungen schließen"><X size={20} /></button>
        <p className="auth-kicker">ADMINISTRATION</p>
        <h2><Settings size={20} /> Grundeinstellungen & Startanleitung</h2>

        <section className="admin-setup-guide">
          <strong>Kurzer Ablauf für die erste Nutzung</strong>
          <ol>
            <li><b>Grundeinstellungen:</b> öffentliche HTTPS-Adresse, Orga-Kontakt und Materialwerte speichern.</li>
            <li><b>Zugänge:</b> unter „Benutzer verwalten“ Planung und Leserechte vergeben.</li>
            <li><b>Stationen:</b> Stationsliste aus der Lichternacht-App importieren.</li>
            <li><b>Straßen:</b> erfassen und die gewünschte Abschnittslänge festlegen.</li>
            <li><b>Verteilen:</b> Stationsbereiche zuerst prüfen, übrige offene Abschnitte in der Besprechung vergeben.</li>
            <li><b>Ausgeben:</b> Helfer-Informationen prüfen, PDF drucken oder später per E-Mail versenden.</li>
          </ol>
        </section>

        <section className="admin-settings-section">
          <h3>Veranstaltung & öffentliche Helfer-Links</h3>
          <p>Die HTTPS-Adresse wird in QR-Codes und persönlichen Helfer-Links verwendet.</p>
          <div className="admin-settings-grid">
            <Field name="event_name" values={values} onChange={change} />
            <Field name="event_location" values={values} onChange={change} />
            <Field name="public_base_url" values={values} onChange={change} placeholder="https://beleuchtung.lichternacht-bechhofen.de" type="url" />
            <Field name="currency" values={values} onChange={change} placeholder="EUR" />
          </div>
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

        <section className="admin-settings-section admin-smtp-settings">
          <h3><Mail size={16} /> E-Mail-Versand (SMTP)</h3>
          <p>Hier liegen die nicht vertraulichen Versanddaten zentral. Der Versand wird erst aktiviert, wenn die Stationsliste E-Mail-Adressen enthält.</p>
          <div className="admin-settings-grid">
            <Field name="smtp_host" values={values} onChange={change} placeholder="mail.example.de" />
            <Field name="smtp_port" values={values} onChange={change} type="number" />
            <Field name="smtp_user" values={values} onChange={change} placeholder="benutzer" />
            <Field name="smtp_from" values={values} onChange={change} placeholder="lichternacht@example.de" type="email" />
          </div>
          <div className="admin-security-note"><Copy size={15} /> SMTP-Passwort nicht hier eintragen: Es bleibt als <code>SMTP_PASSWORD</code> ausschließlich in <code>/etc/lichternacht/lichternacht.env</code> auf dem Server.</div>
        </section>

        <div className="admin-settings-footer">
          <button type="button" onClick={onClose}>Schließen</button>
          <button type="button" className="admin-settings-save" disabled={isSaving} onClick={save}><Check size={16} />{isSaving ? 'Speichert …' : saved ? 'Gespeichert' : 'Einstellungen speichern'}</button>
        </div>
      </section>
    </div>
  );
};
