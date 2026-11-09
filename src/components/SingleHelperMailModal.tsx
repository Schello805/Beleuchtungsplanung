import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Helper } from '../utils/api';

export function SingleHelperMailModal({ helper, onClose }: { helper: Helper; onClose: () => void }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewSingleHelperMail>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    api.previewSingleHelperMail(helper.id).then(value => { if (active) setPreview(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [helper.id]);
  const send = async () => {
    if (sending.current || queued) return;
    sending.current = true;
    setBusy(true); setError('');
    try {
      await api.sendHelperMails(false, { helperId: helper.id, requestId: requestId.current });
      setQueued(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Versand fehlgeschlagen.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return createPortal(<div className="single-mail-overlay" onClick={() => { if (!busy) onClose(); }}>
    <section className="single-mail-dialog" role="dialog" aria-modal="true" aria-labelledby="single-mail-title" onClick={event => event.stopPropagation()}>
      <h2 id="single-mail-title">E-Mail an {helper.name}</h2>
      {preview ? <>
        <p><strong>An:</strong> {preview.to}<br /><strong>Admin-Kopie:</strong> {preview.cc || 'Keine Adresse eingestellt'}<br /><strong>Betreff:</strong> {preview.subject}</p>
        <iframe title="E-Mail-Vorschau" sandbox="" srcDoc={preview.html} />
        <p>Nur dieser Helfer wird angeschrieben. Verwendet wird die gespeicherte Mailvorlage mit seinem persönlichen Bereich.</p>
      </> : !error && <p>Vorschau wird geladen …</p>}
      {error && <p role="alert" style={{ color: '#F87171' }}>{error}</p>}
      {queued && <p role="status">✓ Einzelversand eingeplant. Der Server versendet die Nachricht unter Berücksichtigung der Versandpause. Den Status finden Sie unter Einstellungen → Mailvorlage &amp; Versand.</p>}
      <footer>
        <button type="button" onClick={onClose} disabled={busy}>{queued ? 'Schließen' : 'Abbrechen'}</button>
        {!queued && <button type="button" className="single-mail-send" disabled={!preview || busy} onClick={send}>{busy ? 'Wird eingeplant …' : 'Jetzt nur diesen Helfer informieren'}</button>}
      </footer>
    </section>
  </div>, document.body);
}
