import React, { useState, useMemo } from 'react';
import { X, Zap, Users, Check, ArrowRight, Sparkles, RefreshCw, Layers } from 'lucide-react';
import type { Section, Helper } from '../utils/api';
import { calculateStationFirstAssignment, DEFAULT_FAIRNESS_RULES } from '../utils/fairness';

interface AutoAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: Section[];
  helpers: Helper[];
  onApply: (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => Promise<void>;
}

export const AutoAssignModal: React.FC<AutoAssignModalProps> = ({
  isOpen,
  onClose,
  sections,
  helpers,
  onApply
}) => {
  if (!isOpen) return null;

  const [mode, setMode] = useState<'unassigned_only' | 'all'>('unassigned_only');
  const [strategy, setStrategy] = useState<'fair' | 'station_first'>('station_first');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Compute unassigned sections and free helpers
  const unassignedSections = useMemo(() => {
    return sections.filter(s => !s.assigned_helper_id);
  }, [sections]);

  const freeHelpers = useMemo(() => {
    return helpers.filter(h => !sections.some(s => s.assigned_helper_id === h.id));
  }, [sections, helpers]);

  // Target sections to be assigned
  const targetSections = useMemo(() => {
    return mode === 'unassigned_only' ? unassignedSections : sections;
  }, [mode, unassignedSections, sections]);

  // Target helpers to distribute to
  const targetHelpers = useMemo(() => {
    return mode === 'unassigned_only' && freeHelpers.length > 0 ? freeHelpers : helpers;
  }, [mode, freeHelpers, helpers]);

  // Compute preview assignments
  const previewAssignments = useMemo(() => {
    if (targetSections.length === 0 || targetHelpers.length === 0) return [];

    if (strategy === 'station_first' || strategy === 'fair') {
      const result = calculateStationFirstAssignment(
        targetSections,
        targetHelpers,
        mode === 'unassigned_only' ? sections : [],
        DEFAULT_FAIRNESS_RULES
      );
      const bySection = new Map(result.assignments.map(item => [item.sectionId, item]));
      // A full reassignment must actively clear areas that cannot meet the
      // configured limits. Otherwise an old 80 m assignment would remain.
      return mode === 'all'
        ? targetSections.map(section => bySection.get(section.id) || { sectionId: section.id, helperId: '', helperName: 'Offen – Fairnessgrenze' })
        : result.assignments;
    }

    return [];
  }, [targetSections, targetHelpers, strategy, mode, sections]);

  // Summary stats
  const totalMeters = targetSections.reduce((sum, s) => sum + (s.length_meters || s.lengthMeters || 0), 0);
  const avgMetersPerHelper = targetHelpers.length > 0 ? Math.round(totalMeters / Math.min(targetSections.length, targetHelpers.length)) : 0;
  const largestSectionMeters = Math.max(0, ...targetSections.map(s => s.length_meters || s.lengthMeters || 0));
  const needsFairRechunking = targetHelpers.length > 0 && largestSectionMeters > (totalMeters / targetHelpers.length) * 1.6;
  const allocatedPreviewCount = previewAssignments.filter(assignment => Boolean(assignment.helperId)).length;

  const handleExecute = async () => {
    if (previewAssignments.length === 0) return;
    setIsSubmitting(true);
    try {
      await onApply(previewAssignments);
      onClose();
    } catch (err: any) {
      alert(`Fehler bei der Zuweisung: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: 580,
          maxWidth: '100%',
          maxHeight: '90vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* MODAL HEADER */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0F172A',
                boxShadow: '0 0 14px rgba(245, 158, 11, 0.4)'
              }}
            >
              <Zap size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                1-Klick Auto-Zuweisung
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Verteilt Straßenabschnitte in Sekundenschnelle an Helfer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* MODAL BODY */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {/* Quick Stats Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginBottom: 18
            }}
          >
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px'
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Zu vergebende Abschnitte</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-gold)' }}>
                {targetSections.length}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {unassignedSections.length} noch völlig frei
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px'
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Bereitstehende Helfer</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10B981' }}>
                {targetHelpers.length}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {freeHelpers.length} Helfer ohne Abschnitt
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px'
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Schnitt / Helfer</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#38BDF8' }}>
                ~{avgMetersPerHelper} m
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Gesamt: {totalMeters} m
              </div>
            </div>
          </div>

          {/* MODE SELECTOR */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 8 }}>
              Umfang der Zuweisung:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStrategy('station_first')}
                style={{
                  padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                  border: strategy === 'station_first' ? '2px solid #10B981' : '1px solid var(--border-subtle)',
                  background: strategy === 'station_first' ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-card)',
                  color: strategy === 'station_first' ? '#10B981' : 'var(--text-main)', fontWeight: 700,
                  fontSize: 12, textAlign: 'left', cursor: 'pointer'
                }}
              >
                <div>📍 Stand zuerst</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  Erst vor dem eigenen Stand, anschließend den Rest fair verteilen
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('unassigned_only')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: mode === 'unassigned_only' ? '2px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
                  background: mode === 'unassigned_only' ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-card)',
                  color: mode === 'unassigned_only' ? 'var(--accent-gold)' : 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <div>⚡ Nur freie Abschnitte</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  Bestehende Zuweisungen bleiben unverändert erhalten
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('all')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: mode === 'all' ? '2px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
                  background: mode === 'all' ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-card)',
                  color: mode === 'all' ? 'var(--accent-gold)' : 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <div>🔄 Alles neu verteilen</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  Alle Abschnitte komplett neu und lückenlos verteilen
                </div>
              </button>
            </div>
          </div>

          {/* STRATEGY SELECTOR */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 8 }}>
              Verteilungs-Logik:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStrategy('station_first')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: strategy === 'station_first' ? '2px solid #38BDF8' : '1px solid var(--border-subtle)',
                  background: strategy === 'station_first' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
                  color: strategy === 'station_first' ? '#38BDF8' : 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <div>🧭 Zusammenhängend + fair</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  Vergibt nur angrenzende Erweiterungen, niemals getrennte Bereiche
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStrategy('fair')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: strategy === 'fair' ? '2px solid #38BDF8' : '1px solid var(--border-subtle)',
                  background: strategy === 'fair' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
                  color: strategy === 'fair' ? '#38BDF8' : 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <div>⚖️ Faire Meter</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  Gleiche Verteilung innerhalb zusammenhängender Bereiche
                </div>
              </button>
            </div>
          </div>

          {/* LIVE PREVIEW LIST */}
          {needsFairRechunking && (
            <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239, 68, 68, .12)', border: '1px solid rgba(239, 68, 68, .45)', color: 'var(--text-main)', fontSize: 12, lineHeight: 1.4 }}>
              <b style={{ color: '#EF4444' }}>Noch nicht fair teilbar:</b> Der längste Abschnitt hat {largestSectionMeters} m, der Zielwert liegt bei etwa {Math.round(totalMeters / targetHelpers.length)} m. Teile die Strecken zuerst unter <b>Kontrolle → „Für faire ~40-m-Abschnitte neu zuschneiden“</b> auf.
            </div>
          )}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Vorschau der Zuweisung ({previewAssignments.length} Abschnitte):
              </span>
              <span style={{ fontSize: 11, color: '#10B981', fontWeight: 600 }}>
                ✓ {allocatedPreviewCount} Abschnitte fair vergeben{allocatedPreviewCount < targetSections.length ? ` · ${targetSections.length - allocatedPreviewCount} bleiben offen` : ''}
              </span>
            </div>

            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                padding: '6px 8px',
                fontSize: 11
              }}
            >
              {previewAssignments.slice(0, 30).map((pa, idx) => {
                const sec = sections.find(s => s.id === pa.sectionId);
                const h = helpers.find(helper => helper.id === pa.helperId);
                return (
                  <div
                    key={pa.sectionId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 6px',
                      borderBottom: idx < previewAssignments.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text-muted)', width: 22 }}>#{idx + 1}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{sec?.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({sec?.lengthMeters} m)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ArrowRight size={12} color="var(--text-muted)" />
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: h?.color || '#3B82F6'
                        }}
                      />
                      <span style={{ fontWeight: 700, color: '#10B981' }}>{pa.helperName}</span>
                    </div>
                  </div>
                );
              })}
              {previewAssignments.length > 30 && (
                <div style={{ textAlign: 'center', padding: '6px 0', color: 'var(--text-muted)', fontSize: 10 }}>
                  ... und {previewAssignments.length - 30} weitere Abschnitte
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Abbrechen
          </button>

          <button
            type="button"
            onClick={handleExecute}
            disabled={isSubmitting || previewAssignments.length === 0 || needsFairRechunking}
            style={{
              padding: '9px 20px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: previewAssignments.length === 0 ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: previewAssignments.length === 0 ? 'var(--text-muted)' : '#0F172A',
              fontSize: 13,
              fontWeight: 800,
              cursor: previewAssignments.length === 0 || isSubmitting || needsFairRechunking ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: previewAssignments.length > 0 ? '0 0 16px rgba(245, 158, 11, 0.4)' : 'none',
              opacity: isSubmitting ? 0.7 : 1
            }}
          >
            <Zap size={16} />
            {isSubmitting ? 'Wird zugewiesen...' : `⚡ ${previewAssignments.length} Abschnitte jetzt zuweisen`}
          </button>
        </div>
      </div>
    </div>
  );
};
