import React, { lazy, Suspense, useRef, useState } from 'react';
const HelperAreaMap = lazy(() => import('./PrintView').then(module => ({ default: module.HelperAreaMap })));
import { LocalQrCode } from './LocalQrCode';
import { exportStationPdfs } from '../utils/stationPdfExport';
import type { PublicHelperInfo, Section } from '../utils/api';

export function PublicPdfDownload({ info }: { info: PublicHelperInfo }) {
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renderCard, setRenderCard] = useState(false);
  const download = async () => {
    setBusy(true); setError(''); setRenderCard(true);
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!card.current) throw new Error('PDF-Vorlage konnte nicht geladen werden.');
      // Wait for the locally generated QR image before taking the snapshot.
      for (let attempt = 0; attempt < 100 && !card.current.querySelector('img'); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!card.current.querySelector('img')) throw new Error('QR-Code konnte nicht erstellt werden. Bitte erneut versuchen.');
      for (let attempt = 0; attempt < 200 && card.current.querySelectorAll('svg[role="img"]').length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      if (card.current.querySelectorAll('svg[role="img"]').length < 2) throw new Error('Karten konnten nicht geladen werden. Bitte erneut versuchen.');
      await exportStationPdfs([{ element: card.current, stationNumber: info.stationNumber || '', name: info.name }], () => {}, true);
    } catch (err) { setError(err instanceof Error ? err.message : 'PDF konnte nicht erstellt werden.'); }
    finally { setBusy(false); setRenderCard(false); }
  };
  return <>
    <button type="button" disabled={busy} onClick={download} style={{ padding: '12px 16px', border: 0, borderRadius: 7, background: 'var(--accent-gold)', color: '#172033', fontWeight: 800, cursor: 'pointer' }}>{busy ? 'PDF wird erstellt …' : 'Bereich als PDF herunterladen'}</button>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {renderCard && <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
      <div ref={card} style={{ width: 960, padding: 24, background: '#FFFFFF', color: '#172033', fontFamily: 'Arial, sans-serif', fontSize: 13 }}>
        <p>LICHTERNACHT BECHHOFEN · IHR BELEUCHTUNGSBEREICH</p>
        <h1 style={{ margin: '8px 0' }}>{info.name}</h1>
        <p>{Math.round(info.sections.reduce((sum, section) => sum + section.length_meters, 0))} Meter · A: Start · B: Ende</p>
        <Suspense fallback={<p>Karten laden …</p>}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div><b>Karte</b><HelperAreaMap sections={info.sections as Section[]} height={150} /></div>
          <div><b>Satellit</b><HelperAreaMap sections={info.sections as Section[]} height={150} mapStyle="satellite" /></div>
        </div></Suspense>
        {info.sections.map(section => <div key={section.id} style={{ marginTop: 10, padding: 8, border: '1px solid #CBD5E1' }}>
          <b>{section.label}</b> · {Math.round(section.length_meters)} m
          <div>{section.street_name} · {section.lighting_side === 'left' ? 'Straßenseite A (links in Richtung A → B)' : section.lighting_side === 'right' ? 'Straßenseite B (rechts in Richtung A → B)' : 'Beide Straßenseiten'}</div>
          {section.notes && <div style={{ whiteSpace: 'pre-wrap', marginTop: 5 }}><b>Hinweis:</b> {section.notes}</div>}
        </div>)}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}><LocalQrCode value={window.location.href} size={90} /><div><b>Persönliche Karte online</b><p style={{ overflowWrap: 'anywhere' }}>{window.location.href}</p></div></div>
        <p style={{ marginTop: 12 }}>Die Beleuchtung Ihres ausgewiesenen Bereichs ist verpflichtend. Bitte bringen Sie Lichter und Material selbst mit und stimmen Sie sich mit angrenzenden Mitwirkenden ab.</p>
      </div>
    </div>}
  </>;
}
