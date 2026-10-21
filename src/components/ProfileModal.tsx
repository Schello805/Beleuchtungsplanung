import React, { useState } from 'react';
import { api, type AuthUser } from '../utils/api';
import { PasswordInput } from './PasswordInput';

export function ProfileModal({ user, onSaved, onClose }: { user: AuthUser; onSaved: (user: AuthUser) => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setStatus('');
    if (newPassword !== repeat) { setError('Die neuen Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    try {
      onSaved(await api.updateProfile({ displayName, email, currentPassword, newPassword }));
      setCurrentPassword(''); setNewPassword(''); setRepeat('');
      setStatus('Profil gespeichert.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  };
  return <div className="user-modal-backdrop"><section className="user-modal" aria-label="Mein Profil">
    <button type="button" className="user-modal-close" onClick={onClose} aria-label="Profil schließen">×</button>
    <h2>Mein Profil</h2>
    <form className="auth-form" onSubmit={submit}>
      <label>Name<input required value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" /></label>
      <label>E-Mail-Adresse<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Für eine neue E-Mail-Adresse oder ein neues Passwort geben Sie bitte Ihr aktuelles Passwort ein. Passwortfelder leer lassen, um das Passwort beizubehalten.</p>
      <label>Aktuelles Passwort<PasswordInput value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
      <label>Neues Passwort (mindestens 8 Zeichen)<PasswordInput minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
      <label>Neues Passwort wiederholen<PasswordInput minLength={8} value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" /></label>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {status && <p role="status">{status}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Speichert …' : 'Profil speichern'}</button>
    </form>
  </section></div>;
}
