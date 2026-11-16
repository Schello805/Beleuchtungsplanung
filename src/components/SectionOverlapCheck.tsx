import { useMemo } from 'react';
import type { Section } from '../utils/api';
import { findSectionOverlaps } from '../utils/sectionOverlaps';

export function SectionOverlapCheck({ sections, onSelect }: { sections: Section[]; onSelect: (id: string) => void }) {
  const overlaps = useMemo(() => findSectionOverlaps(sections), [sections]);
  return <section style={{ marginBottom: 16, padding: 12, border: `1px solid ${overlaps.length ? '#F59E0B' : 'var(--border-subtle)'}`, borderRadius: 8, background: 'var(--bg-secondary)' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Doppelbelegungsprüfung</h3>
    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>Prüft überlappende Strecken derselben Straßenseite ab 3 m (Geometrietoleranz 1,5 m). Gegenüberliegende Seiten und reine Kreuzungen zählen nicht. Hinweise bitte auf der Karte kontrollieren.</p>
    {overlaps.length === 0 ? <p style={{ margin: 0, fontSize: 12 }}>✓ Keine verdächtigen Überschneidungen gefunden.</p> : <>
      <strong style={{ fontSize: 12 }}>{overlaps.length} mögliche Überschneidung{overlaps.length === 1 ? '' : 'en'}</strong>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {overlaps.map(({ first, second, meters, differentHelpers }) => <div key={`${first.id}:${second.id}`} style={{ padding: 9, background: 'var(--bg-input)', borderRadius: 6, minWidth: 0 }}>
          <div style={{ color: differentHelpers ? '#F87171' : 'var(--accent-gold)', fontSize: 12, fontWeight: 700 }}>{differentHelpers ? 'Zwei verschiedene Helfer' : 'Doppelt angelegte Strecke'} · ca. {meters} m</div>
          {[first, second].map(section => <button key={section.id} type="button" onClick={() => onSelect(section.id)} title="Abschnitt auf der Karte öffnen"
            style={{ width: '100%', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere', padding: '8px 0', minHeight: 44, background: 'transparent', border: 0, color: 'var(--text-main)', cursor: 'pointer', fontSize: 12 }}>
            📍 {section.label || section.street_name}<br /><span style={{ color: 'var(--text-muted)' }}>{section.assigned_helper_name || 'Nicht zugewiesen'} → Karte</span>
          </button>)}
        </div>)}
      </div>
    </>}
  </section>;
}
