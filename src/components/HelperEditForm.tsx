import { useState } from 'react';
import type { Helper } from '../utils/api';

export function HelperEditForm({ helper, onSave, onClose }: {
  helper: Helper;
  onSave: (id: string, name: string, color?: string, phone?: string, email?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(helper.name);
  const [email, setEmail] = useState(helper.email || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const addresses = [...new Set(email.split(/[,;\n]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (addresses.some(address => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))) {
      setError('Bitte gültige E-Mail-Adressen eingeben und mit Komma oder Semikolon trennen.'); return;
    }
    setSaving(true); setError('');
    try {
      await onSave(helper.id, name.trim(), helper.color, helper.phone, addresses.join(', '));
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'); }
    finally { setSaving(false); }
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, minHeight: 44, padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 14 };
  return <form data-planning-editor="true" onSubmit={submit} style={{ display: 'grid', gap: 9, padding: 12, border: '1px solid var(--accent-gold)', background: 'var(--bg-secondary)', borderRadius: 7, minWidth: 0 }}>
    <strong style={{ fontSize: 13 }}>Helfer bearbeiten</strong>
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Name
      <input value={name} onChange={event => setName(event.target.value)} required autoFocus disabled={saving} style={inputStyle} />
    </label>
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>E-Mail-Adressen
      <textarea value={email} onChange={event => setEmail(event.target.value)} rows={3} disabled={saving} placeholder="name@example.de, weitere@example.de" style={{ ...inputStyle, resize: 'vertical' }} />
    </label>
    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mehrere Adressen mit Komma, Semikolon oder Zeilenumbruch trennen. Ein leeres Feld entfernt alle E-Mail-Adressen.</span>
    {error && <p role="alert" style={{ color: '#F87171', fontSize: 12, margin: 0 }}>{error}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="submit" disabled={saving || !name.trim()} style={{ ...inputStyle, width: 'auto', background: 'var(--accent-gold)', color: '#0F172A', fontWeight: 700 }}>{saving ? 'Speichert …' : 'Speichern'}</button>
      <button type="button" onClick={onClose} disabled={saving} style={{ ...inputStyle, width: 'auto' }}>Abbrechen</button>
    </div>
  </form>;
}
