import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { PasswordInput } from './PasswordInput';
import { Lock, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

interface SetPasswordScreenProps {
  token: string;
}

export const SetPasswordScreen: React.FC<SetPasswordScreenProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [verifyingError, setVerifyingError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<{ email: string; displayName: string; role: string } | null>(null);

  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;
    api.verifyResetToken(token)
      .then(info => {
        if (!isMounted) return;
        setUserInfo(info);
        setLoading(false);
      })
      .catch(err => {
        if (!isMounted) return;
        setVerifyingError(err?.message || 'Dieser Einladungslink ist ungültig oder abgelaufen.');
        setLoading(false);
      });
    return () => { isMounted = false; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (password !== passwordRepeat) {
      setSubmitError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setSubmitting(true);
    try {
      await api.setPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      setSubmitError(err?.message || 'Passwort konnte nicht gespeichert werden.');
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card" style={{ maxWidth: 460 }}>
        <div className="auth-mark">✦</div>
        <p className="auth-kicker">LICHTERNACHT BECHHOFEN</p>
        <h1>Passwort erstellen</h1>

        {loading && (
          <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>
            Einladung wird geprüft …
          </p>
        )}

        {verifyingError && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#fb7185', marginBottom: 16 }}>
              <AlertCircle size={20} />
              <span>{verifyingError}</span>
            </div>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{
                width: '100%',
                padding: '11px',
                borderRadius: 7,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                cursor: 'pointer',
                fontWeight: 700
              }}
            >
              Zur Anmeldung
            </button>
          </div>
        )}

        {!loading && !verifyingError && userInfo && (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5, margin: '8px 0 18px' }}>
              Hallo <strong>{userInfo.displayName}</strong>, bitte legen Sie Ihr persönliches Passwort für Ihren Zugang (<span style={{ color: 'var(--text-main)' }}>{userInfo.email}</span>) fest.
            </p>

            {success ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 0', color: '#34d399' }}>
                <CheckCircle2 size={36} />
                <strong style={{ fontSize: 16 }}>Passwort erfolgreich eingerichtet!</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Bitte melden Sie sich jetzt mit Ihrem neuen Passwort an.</span>
                <button type="button" onClick={() => { window.location.href = '/'; }} style={{ width: '100%', marginTop: 6 }}>
                  Zur Anmeldung
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                <label>
                  Neues Passwort (mind. 8 Zeichen)
                  <PasswordInput
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Mindestens 8 Zeichen"
                    required
                  />
                </label>

                <label>
                  Passwort wiederholen
                  <PasswordInput
                    type="password"
                    value={passwordRepeat}
                    onChange={e => setPasswordRepeat(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Passwort wiederholen"
                    required
                  />
                </label>

                {submitError && (
                  <p className="auth-error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={15} />
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || password.length < 8}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 6
                  }}
                >
                  <Lock size={15} />
                  {submitting ? 'Speichern …' : 'Passwort festlegen & aktivieren'}
                  <ArrowRight size={15} />
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
};
