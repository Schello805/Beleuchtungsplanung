import React, { useState } from 'react';
import { Printer, ArrowLeft, FileText, Grid, Phone } from 'lucide-react';
import type { Section, Helper } from '../utils/api';

interface PrintViewProps {
  sections: Section[];
  helpers: Helper[];
  candleSpacing?: number;
  candleBuffer?: number;
  onClose: () => void;
}

export const PrintView: React.FC<PrintViewProps> = ({
  sections,
  helpers,
  candleSpacing = 2.0,
  candleBuffer = 10,
  onClose
}) => {
  const [printLayout, setPrintLayout] = useState<'table' | 'cards'>('table');

  const totalMeters = sections.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
  const unassignedSections = sections.filter(s => !s.assigned_helper_id);

  // Group sections by assigned helper
  const helperGroups = helpers
    .map(helper => {
      const assigned = sections.filter(s => s.assigned_helper_id === helper.id);
      const meters = assigned.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
      const candles = assigned.reduce((sum, s) => {
        const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
        if (s.type === 'point') return sum + 20;
        return sum + (len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0);
      }, 0);
      return {
        helper,
        sections: assigned,
        meters,
        candles
      };
    })
    .filter(g => g.sections.length > 0)
    .sort((a, b) => a.helper.name.localeCompare(b.helper.name, 'de'));

  const totalCandlesBase = sections.reduce((sum, s) => {
    const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
    if (s.type === 'point') return sum + 20;
    return sum + (len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0);
  }, 0);
  const totalCandlesWithBuffer = Math.round(totalCandlesBase * (1 + candleBuffer / 100));

  const currentDate = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#FFFFFF',
        color: '#0F172A',
        overflowY: 'auto',
        fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif"
      }}
    >
      {/* Top Action Bar (Hidden when printed) */}
      <div
        className="no-print"
        style={{
          position: 'sticky',
          top: 0,
          background: '#0F172A',
          color: '#FFFFFF',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          zIndex: 100
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#FFFFFF',
              padding: '6px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600
            }}
          >
            <ArrowLeft size={16} />
            Zurück zur Karte
          </button>

          {/* Layout Mode Switcher */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', padding: 3, borderRadius: 6, gap: 4 }}>
            <button
              onClick={() => setPrintLayout('table')}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: 'none',
                background: printLayout === 'table' ? '#F59E0B' : 'transparent',
                color: printLayout === 'table' ? '#0F172A' : '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <FileText size={14} />
              Gesamtübersicht (Tabelle)
            </button>

            <button
              onClick={() => setPrintLayout('cards')}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: 'none',
                background: printLayout === 'cards' ? '#F59E0B' : 'transparent',
                color: printLayout === 'cards' ? '#0F172A' : '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <Grid size={14} />
              Helfer-Laufzettel (Karten)
            </button>
          </div>
        </div>

        <button
          onClick={() => window.print()}
          style={{
            background: '#F59E0B',
            color: '#0F172A',
            border: 'none',
            padding: '8px 18px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 2px 8px rgba(245,158,11,0.4)'
          }}
        >
          <Printer size={16} />
          Jetzt drucken / Als PDF speichern
        </button>
      </div>

      {/* PRINT CONTENT CONTAINER */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '30px 20px' }}>
        {/* DOCUMENT HEADER */}
        <div style={{ borderBottom: '3px solid #0F172A', paddingBottom: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                Lichternacht Bechhofen (91572)
              </h1>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#D97706', marginTop: 4 }}>
                {printLayout === 'table' ? 'Offizieller Strecken- & Helfer-Einsatzplan' : 'Helfer-Laufzettel zur Materialausgabe'}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
              <div>Stand: <b>{currentDate}</b></div>
              <div>Gemeinde Bechhofen a.d. Heide</div>
            </div>
          </div>

          {/* Quick Summary Box */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 12,
              marginTop: 18,
              background: '#F8FAFC',
              padding: 12,
              borderRadius: 8,
              border: '1px solid #E2E8F0'
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Gesamtstrecke</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>{totalMeters.toLocaleString('de-DE')} m</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Eingeteilte Helfer</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>{helperGroups.length} Personen</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Gesamtabschnitte</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>{sections.length} Abschnitte</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#D97706', textTransform: 'uppercase', fontWeight: 700 }}>Lichter-Bedarf</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#D97706' }}>{totalCandlesWithBuffer.toLocaleString('de-DE')} Stk.</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>inkl. {candleBuffer}% Reserve ({candleSpacing}m)</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Offen / Unbesetzt</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: unassignedSections.length > 0 ? '#DC2626' : '#16A34A' }}>
                {unassignedSections.length}
              </div>
            </div>
          </div>
        </div>

        {/* LAYOUT 1: TABLE OVERVIEW */}
        {printLayout === 'table' && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', marginBottom: 12, letterSpacing: '0.04em' }}>
              Einteilung nach Helfern:
            </h2>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 30 }}>
              <thead>
                <tr style={{ background: '#0F172A', color: '#FFFFFF', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', width: '20%' }}>Helfer-Name</th>
                  <th style={{ padding: '8px 10px', width: '10%', textAlign: 'right' }}>Strecke</th>
                  <th style={{ padding: '8px 10px', width: '12%', textAlign: 'right' }}>Lichter (ca.)</th>
                  <th style={{ padding: '8px 10px', width: '40%' }}>Zugeteilte Straßen & Abschnitte</th>
                  <th style={{ padding: '8px 10px', width: '18%', textAlign: 'center' }}>Ausgabe / Quittung</th>
                </tr>
              </thead>
              <tbody>
                {helperGroups.map((group, idx) => (
                  <tr
                    key={group.helper.id}
                    style={{
                      borderBottom: '1px solid #CBD5E1',
                      background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <td style={{ padding: '10px 10px', fontWeight: 700, verticalAlign: 'top', color: '#0F172A' }}>
                      <div style={{ fontSize: 13 }}>{group.helper.name}</div>
                      {group.helper.phone && (
                        <div style={{ fontSize: 10, color: '#64748B', fontWeight: 400 }}>Tel: {group.helper.phone}</div>
                      )}
                    </td>

                    <td style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'right', verticalAlign: 'top', fontSize: 13, color: '#D97706' }}>
                      {group.meters} m
                    </td>

                    <td style={{ padding: '10px 10px', fontWeight: 700, textAlign: 'right', verticalAlign: 'top', fontSize: 12, color: '#059669' }}>
                      ~{group.candles} Stk.
                    </td>

                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {group.sections.map(sec => (
                          <div key={sec.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>
                              <b>{sec.label}</b>
                              {sec.notes ? <span style={{ color: '#64748B', fontSize: 11 }}> ({sec.notes})</span> : ''}
                            </span>
                            <span style={{ color: '#475569', fontWeight: 600, fontSize: 11 }}>
                              {Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0)} m
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>

                    <td style={{ padding: '10px 10px', textAlign: 'center', verticalAlign: 'middle', fontSize: 11, color: '#64748B' }}>
                      <div style={{ borderBottom: '1px dashed #94A3B8', height: 20, width: '90%', margin: '0 auto 4px' }} />
                      <div style={{ fontSize: 9 }}>[ ] Ausgegeben: ____ Stk.</div>
                    </td>
                  </tr>
                ))}

                {helperGroups.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#64748B' }}>
                      Noch keine Helfer zugewiesen.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* LAYOUT 2: LAUFZETTEL / HELFER-KARTEN */}
        {printLayout === 'cards' && (
          <div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }} className="no-print">
              💡 Diese Kärtchen können ausgedruckt, entlang der gestrichelten Linien ausgeschnitten und den Helfern am Abend mitgegeben werden.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 20
              }}
            >
              {helperGroups.map(group => (
                <div
                  key={group.helper.id}
                  style={{
                    border: '2px dashed #CBD5E1',
                    borderRadius: 8,
                    padding: 16,
                    background: '#FFFFFF',
                    pageBreakInside: 'avoid',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 220
                  }}
                >
                  <div>
                    {/* Card Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#D97706', textTransform: 'uppercase' }}>
                          Lichternacht Bechhofen &bull; Laufzettel
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                          {group.helper.name}
                        </div>
                        {group.helper.phone && (
                          <div style={{ fontSize: 10, color: '#64748B' }}>Tel: {group.helper.phone}</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#D97706' }}>
                          {group.meters} m
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4, marginTop: 2 }}>
                          🕯️ ~{group.candles} Lichter
                        </div>
                      </div>
                    </div>

                    {/* Assigned streets */}
                    <div style={{ fontSize: 11, marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>Deine Streckenabschnitte:</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {group.sections.map(sec => {
                          const sLen = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
                          const sCandles = sec.type === 'point' ? 20 : (sLen > 0 ? Math.max(1, Math.round(sLen / candleSpacing)) : 0);
                          return (
                            <div key={sec.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: '#F8FAFC', borderRadius: 4 }}>
                              <span>● <b>{sec.label}</b></span>
                              <span style={{ fontWeight: 700, color: '#475569' }}>
                                {sLen} m <span style={{ color: '#059669', fontSize: 10 }}>({sCandles} L.)</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer / Checklist */}
                  <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 8, marginTop: 8, fontSize: 10, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span><b>[ ] Lichter erhalten:</b> _____ Stk.</span>
                      <span><b>[ ] Aufgestellt</b></span>
                      <span><b>[ ] Entzündet</b></span>
                      <span><b>[ ] Reste retour</b></span>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 9, color: '#94A3B8' }}>
                      Stand: {currentDate} &bull; Gemeinde Bechhofen
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* UNASSIGNED SECTIONS TABLE (IF ANY) */}
        {unassignedSections.length > 0 && (
          <div style={{ pageBreakInside: 'avoid', marginTop: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 800, color: '#DC2626', marginBottom: 6, textTransform: 'uppercase' }}>
              ⚠️ Offene / Noch unbesetzte Abschnitte ({unassignedSections.length}):
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#FEE2E2', color: '#991B1B', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Abschnitt</th>
                  <th style={{ padding: '6px 8px' }}>Straße</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Länge</th>
                  <th style={{ padding: '6px 8px' }}>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {unassignedSections.map(sec => (
                  <tr key={sec.id} style={{ borderBottom: '1px solid #FECACA' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{sec.label}</td>
                    <td style={{ padding: '6px 8px' }}>{sec.street_name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0)} m</td>
                    <td style={{ padding: '6px 8px', color: '#64748B' }}>{sec.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FOOTER */}
        <div
          style={{
            marginTop: 36,
            paddingTop: 12,
            borderTop: '1px solid #E2E8F0',
            fontSize: 10,
            color: '#94A3B8',
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          <div>Lichternacht Streckenplaner &bull; Gemeinde Bechhofen</div>
          <div>Strecken- & Helferplan</div>
        </div>
      </div>
    </div>
  );
};
