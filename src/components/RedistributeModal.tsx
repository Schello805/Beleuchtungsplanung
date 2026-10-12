import React, { useState, useMemo } from 'react';
import { X, Users, Scissors, Sparkles, Check } from 'lucide-react';
import { type Section, type Helper } from '../utils/api';
import { createFairWorkPackages, redistributeSectionsToTargetCount, rechunkSectionsByTargetLength } from '../utils/geo';
import { calculateStationFirstAssignment } from '../utils/fairness';

interface RedistributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: Section[];
  helpers: Helper[];
  onApply: (newSections: Section[]) => Promise<void>;
}

export const RedistributeModal: React.FC<RedistributeModalProps> = ({
  isOpen,
  onClose,
  sections,
  helpers,
  onApply
}) => {
  const totalMeters = useMemo(() => {
    if (!isOpen) return 0;
    return sections.reduce((sum, s) => sum + (s.length_meters || s.lengthMeters || 0), 0);
  }, [isOpen, sections]);

  const defaultTarget = helpers.length > 0 ? helpers.length : 35;
  const [targetCount, setTargetCount] = useState<number>(defaultTarget);
  // The concrete length is the planning rule people can understand and change
  // during the meeting.  The "by count" option is kept as an alternative, but
  // must not be the default because it hides the resulting street lengths.
  const [mode, setMode] = useState<'by_count' | 'by_length'>('by_length');
  const [targetChunkLength, setTargetChunkLength] = useState<number>(40);
  const [minWorkMeters, setMinWorkMeters] = useState<number>(35);
  const [maxWorkMeters, setMaxWorkMeters] = useState<number>(50);
  const [maxDifferenceMeters, setMaxDifferenceMeters] = useState<number>(15);
  // Repartitioning must be safe: it creates open, discussable street sections
  // unless the organiser explicitly opts into an automatic assignment.
  const [autoAssign, setAutoAssign] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Live calculation preview
  const previewResult = useMemo(() => {
    // The component stays mounted while closed. Do not run geo calculations
    // against the saved plan until the organiser actually opens this dialog.
    if (!isOpen) return [] as Section[];
    const rechunked = mode === 'by_count'
      ? createFairWorkPackages(sections, targetCount, minWorkMeters, maxWorkMeters)
      : rechunkSectionsByTargetLength(sections, targetChunkLength, minWorkMeters);
    if (!autoAssign) return rechunked;

    const assignments = calculateStationFirstAssignment(rechunked, helpers, [], {
      maxMeters: maxWorkMeters,
      maxDifferenceMeters
    }).assignments;
    const assignmentBySection = new Map(assignments.map(item => [item.sectionId, item]));
    return rechunked.map(section => {
      const assignment = assignmentBySection.get(section.id);
      return assignment
        ? { ...section, assigned_helper_id: assignment.helperId, assigned_helper_name: assignment.helperName }
        : { ...section, assigned_helper_id: null, assigned_helper_name: null };
    });
  }, [isOpen, sections, mode, targetCount, targetChunkLength, minWorkMeters, maxWorkMeters, maxDifferenceMeters, autoAssign, helpers]);

  const previewCount = previewResult.length;
  const previewAvgLength = previewCount > 0 ? Math.round(totalMeters / previewCount) : 0;
  const previewMin = previewCount > 0 ? Math.min(...previewResult.map(s => s.length_meters || s.lengthMeters || 0)) : 0;
  const previewMax = previewCount > 0 ? Math.max(...previewResult.map(s => s.length_meters || s.lengthMeters || 0)) : 0;
  const previewHelperMeters = helpers.map(helper => previewResult
    .filter(section => section.assigned_helper_id === helper.id)
    .reduce((sum, section) => sum + (section.length_meters || section.lengthMeters || 0), 0)
  ).filter(meters => meters > 0);
  const previewHelperMin = previewHelperMeters.length ? Math.min(...previewHelperMeters) : 0;
  const previewHelperMax = previewHelperMeters.length ? Math.max(...previewHelperMeters) : 0;
  const previewOpenCount = previewResult.filter(section => !section.assigned_helper_id).length;
  const previewAssignedCount = previewCount - previewOpenCount;

  const handleExecute = async () => {
    setIsSubmitting(true);
    try {
      await onApply(previewResult);
      onClose();
    } catch (err: any) {
      alert(`Fehler bei der Aufteilung: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keep hooks above this guard. The modal remains mounted while it is closed,
  // so returning before useState/useMemo would make opening it violate React's
  // hook order.
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        width: '100%',
        maxWidth: 580,
        boxShadow: 'var(--shadow-xl)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(245, 158, 11, 0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: '#F59E0B',
              color: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Scissors size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Abschnittslänge festlegen
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Straßen in handliche Teilstücke schneiden – offene Bereiche verteilst du später selbst
              </span>
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

        {/* Content */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          
          {/* Current Status Box */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            background: 'var(--bg-secondary)',
            padding: 12,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            textAlign: 'center'
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Aktuelle Abschnitte</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#F59E0B' }}>{sections.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gesamtstrecke</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>{totalMeters} m</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Verfügbare Helfer</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{helpers.length}</div>
            </div>
          </div>

          {/* Mode Selector */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setMode('by_count')}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: mode === 'by_count' ? '2px solid #F59E0B' : '1px solid var(--border-subtle)',
                background: mode === 'by_count' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-secondary)',
                color: mode === 'by_count' ? '#F59E0B' : 'var(--text-main)',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6
              }}
            >
              <Users size={15} />
              Nach Anzahl
            </button>
            <button
              type="button"
              onClick={() => setMode('by_length')}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: mode === 'by_length' ? '2px solid #F59E0B' : '1px solid var(--border-subtle)',
                background: mode === 'by_length' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-secondary)',
                color: mode === 'by_length' ? '#F59E0B' : 'var(--text-main)',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6
              }}
            >
              <Scissors size={15} />
              Feste Länge (Empfohlen)
            </button>
          </div>

          {/* Controls based on Mode */}
          {mode === 'by_count' ? (
            <div style={{
              background: 'var(--bg-secondary)',
              padding: 14,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
                  Ziel-Anzahl Abschnitte:
                </label>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>
                  {targetCount} Abschnitte
                </span>
              </div>
              <input
                type="range"
                min={Math.min(sections.length, helpers.length || sections.length)}
                max={Math.max(60, helpers.length + 15)}
                value={targetCount}
                onChange={e => setTargetCount(parseInt(e.target.value, 10))}
                style={{ width: '100%', accentColor: '#F59E0B', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[helpers.length, 35, 40, 45, 50].filter((v, i, a) => v > sections.length && a.indexOf(v) === i).map(cnt => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setTargetCount(cnt)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: targetCount === cnt ? '#F59E0B' : 'var(--bg-card)',
                      color: targetCount === cnt ? '#000' : 'var(--text-main)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {cnt} Helfer
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                💡 <b>Fairness-Methode:</b> Erstellt pro Helfer ein Arbeits­paket. Kurze Teilstücke werden kombiniert und lange Wege geteilt; jedes Paket bleibt zwischen 40 und 110 m.
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-secondary)',
              padding: 14,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
                  Wunsch-Abschnittslänge:
                </label>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>
                  {targetChunkLength} m
                </span>
              </div>
              <input
                type="range"
                min={40}
                max={70}
                step={5}
                value={targetChunkLength}
                onChange={e => setTargetChunkLength(parseInt(e.target.value, 10))}
                style={{ width: '100%', accentColor: '#F59E0B', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                {[40, 50, 60, 70].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTargetChunkLength(m)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: targetChunkLength === m ? '#F59E0B' : 'var(--bg-card)',
                      color: targetChunkLength === m ? '#000' : 'var(--text-main)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {m} m
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Diese Einstellung gilt direkt für die freien Straßenabschnitte. Die Vorschau darunter zeigt sofort, wie viele es bei 40 m, 50 m oder 60 m werden. Ein Rest unter der Mindestlänge wird an das vorherige Stück angehängt.
              </div>
            </div>
          )}

          <div style={{ background: '#EFF6FF', border: '1px solid #93C5FD', padding: 14, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, color: '#1E3A8A', fontSize: 13 }}>{autoAssign ? 'Deine Fairness-Regeln' : 'Regel für kurze Reststücke'}</div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                {autoAssign
                  ? 'Diese Grenzen gelten für die Meter pro Helfer. Zusammenhängende Bereiche bleiben dabei Vorrang.'
                  : 'Ein Rest unter diesem Wert wird nicht als Mini-Abschnitt erzeugt, sondern an das vorherige Teilstück angehängt.'}
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#1E3A8A' }}>{autoAssign ? `Mindestens ${minWorkMeters} m pro Helfer` : `Kleinstes Reststück: ${minWorkMeters} m`}
              <input type="range" min={20} max={60} step={5} value={minWorkMeters} onChange={e => setMinWorkMeters(Math.min(Number(e.target.value), maxWorkMeters - 5))} style={{ display: 'block', width: '100%', accentColor: '#2563EB', marginTop: 5 }} />
            </label>
            {autoAssign && <>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#1E3A8A' }}>Höchstens {maxWorkMeters} m pro Helfer
                <input type="range" min={Math.max(25, minWorkMeters + 5)} max={120} step={5} value={maxWorkMeters} onChange={e => setMaxWorkMeters(Number(e.target.value))} style={{ display: 'block', width: '100%', accentColor: '#2563EB', marginTop: 5 }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#1E3A8A' }}>Maximale Differenz: {maxDifferenceMeters} m
                <input type="range" min={5} max={60} step={5} value={maxDifferenceMeters} onChange={e => setMaxDifferenceMeters(Number(e.target.value))} style={{ display: 'block', width: '100%', accentColor: '#2563EB', marginTop: 5 }} />
              </label>
              <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.35 }}>Beispiel: Mit 35–50 m und maximal 15 m Differenz entsteht keine Verteilung wie 20 m gegenüber 90 m. Ist das wegen einer einzelnen langen Straße nicht möglich, bleibt sie sichtbar zur manuellen Entscheidung.</div>
            </>}
          </div>

          {/* Result Calculation Preview */}
          <div style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10B981', fontWeight: 600, fontSize: 13 }}>
              <Sparkles size={16} />
              Ergebnis-Vorschau:
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              textAlign: 'center'
            }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Abschnitte</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>{previewCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Davon offen</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: previewOpenCount ? '#10B981' : 'var(--text-main)' }}>{previewOpenCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ø Länge</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#10B981' }}>~{previewAvgLength} m</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{autoAssign ? 'Helfer-Meter' : 'Min / Max'}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: autoAssign && previewHelperMax - previewHelperMin > maxDifferenceMeters ? '#DC2626' : 'var(--text-main)' }}>
                  {autoAssign ? `${previewHelperMin}m – ${previewHelperMax}m` : `${previewMin}m – ${previewMax}m`}
                </div>
              </div>
            </div>
          </div>

          {/* Auto Assign Checkbox */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)'
          }}>
            <input
              type="checkbox"
              checked={autoAssign}
              onChange={e => setAutoAssign(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#10B981', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 500 }}>
              <b>Freie Abschnitte sofort automatisch zuweisen</b> (optional; berücksichtigt Stationsposition und eine möglichst gleiche Meterlast)
            </span>
          </label>

        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          background: 'var(--bg-secondary)'
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-main)',
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
            disabled={isSubmitting || previewCount === 0}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: '#F59E0B',
              color: '#000',
              fontSize: 12,
              fontWeight: 700,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: isSubmitting ? 0.7 : 1
            }}
          >
            <Check size={16} />
            {isSubmitting ? 'Wird aufgeteilt...' : `${previewCount} Abschnitte erstellen${previewAssignedCount ? ` · ${previewAssignedCount} direkt zuweisen` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};
