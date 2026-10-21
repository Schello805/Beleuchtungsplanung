import React, { useState } from 'react';
import {
  Users,
  MapPin,
  BarChart3,
  Printer,
  Trash2,
  Plus,
  Download,
  Upload,
  RotateCcw,
  Search,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  FileSpreadsheet,
  Compass,
  FileUp,
  FileDown,
  ClipboardList,
  Check,
  X,
  Flame,
  Scissors,
  Paintbrush,
  Zap
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Section, Helper, Street } from '../utils/api';
import { exportSectionsToExcel, exportHelpersToExcel, exportSectionsToCSV, exportSectionsToGeoJSON, exportSectionsToGPX } from '../utils/export';
import { calculateStationFirstAssignment, DEFAULT_FAIRNESS_RULES } from '../utils/fairness';

interface SidebarProps {
  sections: Section[];
  helpers: Helper[];
  streets: Street[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onFocusSection?: (id: string) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onDeleteSection: (sectionId: string) => void;
  onAddHelper: (name: string, color?: string, phone?: string, email?: string) => Promise<void>;
  onUpdateHelper: (id: string, name: string, color?: string, phone?: string, email?: string) => Promise<void>;
  onDeleteHelper: (id: string) => Promise<void>;
  onImportHelpers?: (helpers: Array<{ name: string; phone?: string; email?: string; color?: string }>, mode: 'replace' | 'append') => Promise<void>;
  onOpenPrintView: () => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onResetDatabase: () => void;
  onBatchAssign: (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => Promise<void>;
  onOpenRedistributeModal?: () => void;
  onSplitSection?: (sectionId: string) => Promise<void>;
  onOpenAutoAssign?: () => void;
  onOpenExcelImport?: () => void;
  onOpenHelperImport?: (method?: 'file' | 'paste') => void;
  onDeleteAllHelpers?: () => Promise<void>;
  activeStampHelperId?: string | null;
  onSelectStampHelper?: (id: string | null) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  candleSpacing?: number;
  candleBuffer?: number;
  onUpdateCandleConfig?: (spacing: number, buffer: number) => Promise<void>;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  helpers,
  streets,
  selectedSectionId,
  onSelectSection,
  onFocusSection,
  onUpdateSectionHelper,
  onDeleteSection,
  onAddHelper,
  onUpdateHelper,
  onDeleteHelper,
  onImportHelpers,
  onOpenPrintView,
  onExportBackup,
  onImportBackup,
  onResetDatabase,
  onBatchAssign,
  onOpenRedistributeModal,
  onSplitSection,
  onOpenAutoAssign,
  onOpenExcelImport,
  onOpenHelperImport,
  onDeleteAllHelpers,
  activeStampHelperId,
  onSelectStampHelper,
  theme,
  onToggleTheme,
  candleSpacing = 2.0,
  candleBuffer = 10,
  onUpdateCandleConfig,
  mobileOpen = false,
  onCloseMobile
}) => {
  const [activeTab, setActiveTab] = useState<'workflow' | 'sections' | 'distribute' | 'helpers' | 'stats'>('workflow');

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unassigned' | 'assigned'>('all');
  const [viewGrouping, setViewGrouping] = useState<'flat' | 'street'>('flat');
  const [collapsedStreets, setCollapsedStreets] = useState<Record<string, boolean>>({});

  // Helper management form
  const [newHelperName, setNewHelperName] = useState<string>('');
  const [editingHelperId, setEditingHelperId] = useState<string | null>(null);
  const [editHelperName, setEditHelperName] = useState<string>('');

  // Auto assign dialog state
  const [isAutoAssigning, setIsAutoAssigning] = useState<boolean>(false);
  const [focusedHelperId, setFocusedHelperId] = useState<string | null>(null);
  const [focusedHelperSectionIndex, setFocusedHelperSectionIndex] = useState(0);
  const [statsSort, setStatsSort] = useState<'meters' | 'sections'>('meters');
  const [statsSortDirection, setStatsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showHelperDataActions, setShowHelperDataActions] = useState(false);
  const [showDataTools, setShowDataTools] = useState(false);
  const selectAndFocusSection = (sectionId: string) => {
    onSelectSection(sectionId);
    onFocusSection?.(sectionId);
  };

  // Calculations
  const totalMeters = sections.reduce((sum, s) => sum + s.lengthMeters, 0);
  const assignedSections = sections.filter(s => !!s.assigned_helper_id);
  const unassignedSections = sections.filter(s => !s.assigned_helper_id);

  // Group sections by helper for statistics & fairness
  const helperStats = helpers.map(h => {
    const assigned = sections.filter(s => s.assigned_helper_id === h.id);
    const meters = assigned.reduce((sum, s) => sum + s.lengthMeters, 0);
    return {
      helper: h,
      sectionsCount: assigned.length,
      meters,
      sections: assigned
    };
  }).sort((a, b) => b.meters - a.meters);

  const activeHelperCount = helperStats.filter(h => h.sectionsCount > 0).length;
  const importedStationCount = helpers.filter(h => h.source_station_id && Number.isFinite(Number(h.latitude)) && Number.isFinite(Number(h.longitude))).length;
  const avgMetersPerActiveHelper = activeHelperCount > 0
    ? Math.round(totalMeters / activeHelperCount)
    : 0;
  const maxMeters = Math.max(...helperStats.map(h => h.meters), 1);
  const sortedHelperStats = [...helperStats].sort((left, right) => {
    const leftValue = statsSort === 'meters' ? left.meters : left.sectionsCount;
    const rightValue = statsSort === 'meters' ? right.meters : right.sectionsCount;
    const comparison = leftValue - rightValue || left.helper.name.localeCompare(right.helper.name, 'de');
    return statsSortDirection === 'desc' ? -comparison : comparison;
  });
  const toggleStatsSort = (nextSort: 'meters' | 'sections') => {
    if (nextSort === statsSort) {
      setStatsSortDirection(direction => direction === 'desc' ? 'asc' : 'desc');
    } else {
      setStatsSort(nextSort);
      setStatsSortDirection('desc');
    }
  };

  // Candle / Material calculations
  const totalCandlesBase = sections.reduce((sum, s) => {
    const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
    if (s.type === 'point') return sum + 20;
    return sum + (len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0);
  }, 0);
  const totalCandlesBuffer = Math.round(totalCandlesBase * (candleBuffer / 100));
  const totalCandlesWithBuffer = totalCandlesBase + totalCandlesBuffer;
  const boxesOf50 = Math.ceil(totalCandlesWithBuffer / 50);
  const boxesOf100 = Math.ceil(totalCandlesWithBuffer / 100);

  // Filtered Sections
  const filteredSections = sections.filter(s => {
    if (filterStatus === 'unassigned' && s.assigned_helper_id) return false;
    if (filterStatus === 'assigned' && !s.assigned_helper_id) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchLabel = s.label.toLowerCase().includes(q);
      const matchStreet = s.street_name.toLowerCase().includes(q);
      const matchHelper = (s.assigned_helper_name || '').toLowerCase().includes(q);
      const matchNotes = (s.notes || '').toLowerCase().includes(q);
      return matchLabel || matchStreet || matchHelper || matchNotes;
    }
    return true;
  });

  // Grouping by street
  const streetGroups = new Map<string, Section[]>();
  filteredSections.forEach(s => {
    const list = streetGroups.get(s.street_name) || [];
    list.push(s);
    streetGroups.set(s.street_name, list);
  });

  const toggleStreetCollapse = (name: string) => {
    setCollapsedStreets(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const handleCreateHelper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHelperName.trim()) return;
    await onAddHelper(newHelperName.trim());
    setNewHelperName('');
  };

  const handleDownloadHelperTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([
      { Name: 'Beispiel Helfer', Telefon: '0171 1234567', 'E-Mail': 'helfer@example.de' }
    ]);
    worksheet['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 32 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Helfer');
    XLSX.writeFile(workbook, 'lichternacht-helfer-vorlage.xlsx');
  };

  const handleSaveEditHelper = async (id: string) => {
    if (!editHelperName.trim()) return;
    await onUpdateHelper(id, editHelperName.trim());
    setEditingHelperId(null);
  };

  // Run auto fair assignment
  const handleAutoAssign = async (onlyUnassigned: boolean) => {
    const targetSections = onlyUnassigned ? unassignedSections : sections;
    if (targetSections.length === 0) {
      alert('Keine Abschnitte zum Zuweisen vorhanden.');
      return;
    }
    if (helpers.length === 0) {
      alert('Keine Helfer in der Datenbank vorhanden.');
      return;
    }

    const confMsg = onlyUnassigned
      ? `Möchtest du alle ${targetSections.length} offenen Abschnitte automatisch und fair auf die Helfer verteilen?`
      : `Möchtest du ALLE ${targetSections.length} Abschnitte neu, fair und straßenweise auf die Helfer verteilen?`;

    if (!confirm(confMsg)) return;

    setIsAutoAssigning(true);
    try {
      const result = calculateStationFirstAssignment(targetSections, helpers, onlyUnassigned ? sections : [], DEFAULT_FAIRNESS_RULES);
      const assignments = onlyUnassigned
        ? result.assignments
        : targetSections.map(section => result.assignments.find(item => item.sectionId === section.id) || { sectionId: section.id, helperId: '', helperName: '' });
      await onBatchAssign(assignments);
      alert(`Fairness-Zuweisung abgeschlossen!\n${result.summary.helpersUsed} Helfer eingeteilt, Durchschnitt: ~${result.summary.avgMeters} m pro Helfer.`);
    } catch (err: any) {
      alert(`Fehler bei Zuweisung: ${err.message}`);
    } finally {
      setIsAutoAssigning(false);
    }
  };

  // Batch assign whole street
  const handleAssignEntireStreet = async (streetName: string, helperId: string) => {
    const streetSecs = sections.filter(s => s.street_name === streetName);
    const helper = helpers.find(h => h.id === helperId);
    const assignments = streetSecs.map(s => ({
      sectionId: s.id,
      helperId: helperId || '',
      helperName: helper ? helper.name : ''
    }));
    await onBatchAssign(assignments);
  };

  return (
    <aside
      className={`no-print planner-sidebar${mobileOpen ? ' mobile-open' : ''}`}
      style={{
        width: 400,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        borderRight: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 20
      }}
    >
      {/* HEADER */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🕯️</span>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                Lichternacht Streckenplaner
              </h1>
            </div>
            <div style={{ fontSize: 12, color: 'var(--accent-gold)', fontWeight: 600, marginTop: 2 }}>
              Bechhofen a.d. Heide (PLZ 91572)
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="mobile-sidebar-close"
              onClick={onCloseMobile}
              aria-label="Planungsmenü schließen"
            >
              <X size={18} />
            </button>
            <button
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-main)',
                padding: '7px 8px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
            >
              {theme === 'dark' ? <Sun size={16} color="var(--accent-gold)" /> : <Moon size={16} />}
            </button>

            <button
              onClick={onOpenPrintView}
              title="Druckansicht öffnen (A4 / PDF)"
              style={{
                background: 'var(--accent-gold)',
                color: '#0F172A',
                border: 'none',
                padding: '7px 12px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <Printer size={15} />
              <span className="sidebar-print-label">Druckansicht</span>
            </button>
          </div>
        </div>

        {/* Quick KPI Counters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <div style={{ background: 'var(--bg-input)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 700 }}>Gesamtstrecke</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent-gold)' }}>{totalMeters.toLocaleString('de-DE')} m</div>
          </div>
          <div style={{ background: 'var(--bg-input)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 700 }}>Abschnitte</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)' }}>{sections.length}</div>
          </div>
          <div style={{ background: 'var(--bg-input)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 700 }}>Zugewiesen</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: unassignedSections.length === 0 && sections.length > 0 ? '#10B981' : '#F59E0B' }}>
              {assignedSections.length}/{sections.length}
            </div>
          </div>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)'
        }}
      >
        <button
          onClick={() => setActiveTab('workflow')}
          style={{
            padding: '10px 4px', fontSize: 12, fontWeight: 700, border: 'none',
            borderBottom: activeTab === 'workflow' ? '2px solid var(--accent-gold)' : '2px solid transparent',
            background: 'transparent', color: activeTab === 'workflow' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5
          }}
        >
          <ClipboardList size={15} /> Start
        </button>
        <button
          onClick={() => setActiveTab('sections')}
          style={{
            padding: '10px 4px',
            fontSize: 12,
            fontWeight: 700,
            border: 'none',
            borderBottom: activeTab === 'sections' ? '2px solid var(--accent-gold)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'sections' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <MapPin size={15} />
          Karte
        </button>

        <button
          onClick={() => setActiveTab('distribute')}
          style={{
            padding: '10px 3px', fontSize: 11, fontWeight: 700, border: 'none',
            borderBottom: activeTab === 'distribute' ? '2px solid var(--accent-gold)' : '2px solid transparent',
            background: 'transparent', color: activeTab === 'distribute' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
          }}
        >
          <Zap size={14} /> Verteilen
        </button>

        <button
          onClick={() => setActiveTab('helpers')}
          style={{
            padding: '10px 4px',
            fontSize: 12,
            fontWeight: 700,
            border: 'none',
            borderBottom: activeTab === 'helpers' ? '2px solid var(--accent-gold)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'helpers' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <Users size={15} />
          Helfer
        </button>

        <button
          onClick={() => setActiveTab('stats')}
          style={{
            padding: '10px 4px',
            fontSize: 12,
            fontWeight: 700,
            border: 'none',
            borderBottom: activeTab === 'stats' ? '2px solid var(--accent-gold)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'stats' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <BarChart3 size={15} />
          Prüfen
        </button>
      </div>

      {/* TAB CONTENT CONTAINER */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {activeTab === 'workflow' && (() => {
          const nextStep = importedStationCount === 0 ? 1 : sections.length === 0 ? 2 : unassignedSections.length > 0 ? 3 : 4;
          const steps = [
            {
              number: 1, title: 'Stationen übernehmen',
              detail: importedStationCount ? `${importedStationCount} Stationen mit Kartenposition übernommen` : 'Die stationen.xlsx aus der Lichternacht-App importieren',
              action: 'Stationsliste importieren', complete: importedStationCount > 0,
              onClick: () => { setActiveTab('helpers'); onOpenHelperImport ? onOpenHelperImport('file') : onOpenExcelImport?.(); }
            },
            {
              number: 2, title: 'Straßen erfassen',
              detail: sections.length ? `${streets.length} Straßen · ${sections.length} Abschnitte gespeichert` : 'Straßen auf der Karte wählen, zerschneiden und speichern',
              action: 'Abschnitte ansehen', complete: sections.length > 0,
              onClick: () => setActiveTab('sections')
            },
            {
              number: 3, title: 'Nähegerecht verteilen',
              detail: sections.length === 0 ? 'Wird verfügbar, sobald Abschnitte angelegt sind' : unassignedSections.length ? `${unassignedSections.length} Abschnitte sind noch offen` : 'Alle Abschnitte sind zugewiesen',
              action: 'Verteilung öffnen', complete: sections.length > 0 && unassignedSections.length === 0,
              disabled: sections.length === 0,
              onClick: () => setActiveTab('distribute')
            },
            {
              number: 4, title: 'Prüfen & nachbessern',
              detail: sections.length === 0 ? 'Nach der Verteilung erscheinen hier die Kontrollwerkzeuge' : unassignedSections.length ? 'Offene Abschnitte gezielt auf der Karte bearbeiten' : 'Zuweisungen auf Karte und Meterlast kontrollieren',
              action: unassignedSections.length ? 'Offene Abschnitte prüfen' : 'Kontrolle öffnen',
              complete: sections.length > 0 && unassignedSections.length === 0,
              disabled: sections.length === 0,
              onClick: () => { setActiveTab(unassignedSections.length ? 'sections' : 'stats'); if (unassignedSections.length) setFilterStatus('unassigned'); }
            },
            {
              number: 5, title: 'Kommunizieren & drucken',
              detail: sections.length === 0 ? 'Druckansicht wird nach der Planung relevant' : unassignedSections.length ? 'Noch offene Abschnitte vor dem Ausdruck prüfen' : 'Laufzettel, Materialbedarf und Excel/PDF erzeugen',
              action: 'Druckansicht öffnen', complete: false,
              disabled: sections.length === 0,
              onClick: onOpenPrintView
            }
          ];
          return (
            <div>
              <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, rgba(245,158,11,.18), rgba(56,189,248,.1))', border: '1px solid rgba(245,158,11,.35)', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: 15 }}>Dein Planungsablauf</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Starte mit Schritt {nextStep}. Jede Arbeitsphase hat ihren eigenen Bereich.</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {steps.map(step => {
                  const current = step.number === nextStep;
                  return <div key={step.number} style={{ display: 'flex', gap: 11, padding: 12, borderRadius: 'var(--radius-md)', background: current ? 'var(--bg-card-hover)' : 'var(--bg-card)', border: current ? '1.5px solid var(--accent-gold)' : '1px solid var(--border-subtle)', opacity: step.disabled ? .55 : 1 }}>
                    <div style={{ width: 27, height: 27, flexShrink: 0, borderRadius: '50%', background: step.complete ? '#10B981' : current ? 'var(--accent-gold)' : 'var(--bg-input)', color: step.complete || current ? '#0F172A' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                      {step.complete ? <Check size={15} /> : step.number}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: 13 }}>{step.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>{step.detail}</div>
                      <button type="button" disabled={step.disabled} onClick={step.onClick} style={{ marginTop: 8, border: 'none', borderRadius: 5, background: current ? 'var(--accent-gold)' : 'var(--bg-input)', color: current ? '#0F172A' : 'var(--text-main)', padding: '5px 8px', fontSize: 11, fontWeight: 700, cursor: step.disabled ? 'not-allowed' : 'pointer' }}>{step.action}</button>
                    </div>
                  </div>;
                })}
              </div>
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>
                <b style={{ color: 'var(--text-main)' }}>Kurz erklärt:</b> Karte = Abschnitte bearbeiten, Verteilen = Zuweisungen, Helfer = Stations- und Kontaktdaten, Prüfen = Fairness und offene Punkte.
              </div>
            </div>
          );
        })()}
        {/* TAB 1: ABSCHNITTE */}
        {activeTab === 'sections' && (
          <div>
            {/* Search & Filter Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-light)' }} />
                <input
                  type="text"
                  placeholder="Straße, Abschnitt oder Helfer suchen..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 32px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-input)',
                    fontSize: 12,
                    color: 'var(--text-main)',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => setFilterStatus('all')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: 'none',
                    background: filterStatus === 'all' ? 'var(--accent-gold)' : 'var(--bg-secondary)',
                    color: filterStatus === 'all' ? '#0F172A' : 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  Alle ({sections.length})
                </button>
                <button
                  onClick={() => setFilterStatus('unassigned')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: 'none',
                    background: filterStatus === 'unassigned' ? '#EF4444' : 'var(--bg-secondary)',
                    color: filterStatus === 'unassigned' ? '#FFFFFF' : 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  Offen ({unassignedSections.length})
                </button>
                <button
                  onClick={() => setFilterStatus('assigned')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: 'none',
                    background: filterStatus === 'assigned' ? '#10B981' : 'var(--bg-secondary)',
                    color: filterStatus === 'assigned' ? '#FFFFFF' : 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  Besetzt ({assignedSections.length})
                </button>

                {/* View grouping toggle */}
                <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 4, padding: 2 }}>
                  <button
                    onClick={() => setViewGrouping('flat')}
                    title="Einfache Liste"
                    style={{
                      padding: '4px 6px',
                      fontSize: 10,
                      fontWeight: 700,
                      border: 'none',
                      borderRadius: 3,
                      background: viewGrouping === 'flat' ? 'var(--accent-gold)' : 'transparent',
                      color: viewGrouping === 'flat' ? '#0F172A' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Liste
                  </button>
                  <button
                    onClick={() => setViewGrouping('street')}
                    title="Nach Straßen gruppiert"
                    style={{
                      padding: '4px 6px',
                      fontSize: 10,
                      fontWeight: 700,
                      border: 'none',
                      borderRadius: 3,
                      background: viewGrouping === 'street' ? 'var(--accent-gold)' : 'transparent',
                      color: viewGrouping === 'street' ? '#0F172A' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Straßen
                  </button>
                </div>
              </div>
            </div>

            {sections.length > 0 && (
              <button type="button" onClick={() => setActiveTab('distribute')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.34)', borderRadius: 'var(--radius-sm)', marginBottom: 12, color: 'var(--text-main)', cursor: 'pointer' }}>
                <span style={{ fontSize: 11 }}><b style={{ color: '#34d399' }}>{unassignedSections.length} Abschnitte offen</b><br />Verteilung und Abschnittslänge sind getrennt organisiert.</span>
                <span style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 800 }}>Verteilen →</span>
              </button>
            )}

            {/* Empty State */}
            {filteredSections.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-light)', fontSize: 13 }}>
                {sections.length === 0 ? (
                  <>
                    <MapPin size={32} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                    <p>Noch keine Straßen erfasst.</p>
                    <p style={{ fontSize: 11, marginTop: 4 }}>
                      Nutze oben das Formular „Strecke erfassen & zerschneiden“.
                    </p>
                  </>
                ) : (
                  'Keine passenden Abschnitte für diese Suche/Filter.'
                )}
              </div>
            ) : viewGrouping === 'street' ? (
              /* GROUPED VIEW BY STREET */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from(streetGroups.entries()).map(([streetName, streetSecs]) => {
                  const isCollapsed = !!collapsedStreets[streetName];
                  const streetTotal = streetSecs.reduce((sum, s) => sum + s.lengthMeters, 0);

                  return (
                    <div
                      key={streetName}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden'
                      }}
                    >
                      {/* Street Group Header */}
                      <div
                        onClick={() => toggleStreetCollapse(streetName)}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--bg-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                          <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>
                            {streetName}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-gold)' }}>
                            {streetTotal} m ({streetSecs.length})
                          </span>
                        </div>
                      </div>

                      {/* Street Actions (Batch assign) */}
                      {!isCollapsed && (
                        <div style={{ padding: '6px 12px', background: 'var(--bg-input)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Ganze Straße zuweisen:</span>
                          <select
                            onChange={e => {
                              if (e.target.value) {
                                handleAssignEntireStreet(streetName, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-main)',
                              fontSize: 11
                            }}
                          >
                            <option value="">-- Helfer wählen --</option>
                            {helpers.map(h => (
                              <option key={h.id} value={h.id}>{h.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Sections within street */}
                      {!isCollapsed && (
                        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {streetSecs.map(sec => {
                            const isSelected = selectedSectionId === sec.id;
                            return (
                              <div
                                key={sec.id}
                                onClick={() => selectAndFocusSection(sec.id)}
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: 4,
                                  background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                                  border: isSelected ? `2px solid ${sec.color}` : '1px solid var(--border-subtle)',
                                  cursor: 'pointer'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sec.color }} />
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{sec.label}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: sec.color }}>{sec.lengthMeters} m</span>
                                    {!sec.assigned_helper_id && (
                                      <button
                                        type="button"
                                        title="Offenen Restabschnitt löschen"
                                        onClick={event => {
                                          event.stopPropagation();
                                          if (confirm(`Offenen Restabschnitt "${sec.label}" löschen?`)) onDeleteSection(sec.id);
                                        }}
                                        style={{ display: 'grid', placeItems: 'center', background: 'rgba(239, 68, 68, .12)', border: '1px solid rgba(239, 68, 68, .42)', color: '#F87171', cursor: 'pointer', padding: 3, borderRadius: 4 }}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                                  <select
                                    value={sec.assigned_helper_id || ''}
                                    onChange={e => {
                                      const val = e.target.value;
                                      const h = helpers.find(x => x.id === val);
                                      onUpdateSectionHelper(sec.id, val || null, h ? h.name : null);
                                    }}
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: '3px 6px',
                                      borderRadius: 4,
                                      border: '1px solid var(--border-subtle)',
                                      background: 'var(--bg-secondary)',
                                      color: sec.assigned_helper_name ? '#10B981' : 'var(--text-muted)',
                                      fontSize: 11
                                    }}
                                  >
                                    <option value="">-- Nicht zugewiesen --</option>
                                    {helpers.map(h => (
                                      <option key={h.id} value={h.id}>{h.name}</option>
                                    ))}
                                  </select>
                                  {sec.type === 'line' && (sec.length_meters || sec.lengthMeters || 0) >= 16 && onSplitSection && (
                                    <button
                                      title="Abschnitt in 2 Hälften teilen"
                                      onClick={() => {
                                        const len = sec.length_meters || sec.lengthMeters || 0;
                                        if (confirm(`Abschnitt "${sec.label}" (${len} m) in 2 Hälften (je ~${Math.round(len / 2)} m) teilen?`)) {
                                          onSplitSection(sec.id);
                                        }
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: '#F59E0B', cursor: 'pointer', padding: 2 }}
                                    >
                                      <Scissors size={13} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (confirm(`Abschnitt "${sec.label}" löschen?`)) {
                                        onDeleteSection(sec.id);
                                      }
                                    }}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-light)', cursor: 'pointer' }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* FLAT LIST VIEW */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredSections.map(sec => {
                  const isSelected = selectedSectionId === sec.id;
                  return (
                    <div
                      key={sec.id}
                      onClick={() => selectAndFocusSection(sec.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                        border: isSelected ? `2px solid ${sec.color}` : '1px solid var(--border-subtle)',
                        boxShadow: 'var(--shadow-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              background: sec.color,
                              boxShadow: `0 0 6px ${sec.color}`
                            }}
                          />
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>
                            {sec.label}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 12,
                              padding: '2px 8px',
                              borderRadius: 12,
                              background: `${sec.color}22`,
                              color: sec.color
                            }}
                          >
                            {sec.lengthMeters} m
                          </span>
                          {!sec.assigned_helper_id && (
                            <button
                              type="button"
                              title="Offenen Restabschnitt löschen"
                              onClick={event => {
                                event.stopPropagation();
                                if (confirm(`Offenen Restabschnitt "${sec.label}" löschen?`)) onDeleteSection(sec.id);
                              }}
                              style={{ display: 'grid', placeItems: 'center', background: 'rgba(239, 68, 68, .12)', border: '1px solid rgba(239, 68, 68, .42)', color: '#F87171', cursor: 'pointer', padding: 4, borderRadius: 5 }}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Helper Select */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                        <span style={{ fontSize: 11, color: 'var(--text-light)', width: 44 }}>Helfer:</span>
                        <select
                          value={sec.assigned_helper_id || ''}
                          onChange={e => {
                            const val = e.target.value;
                            const h = helpers.find(x => x.id === val);
                            onUpdateSectionHelper(sec.id, val || null, h ? h.name : null);
                          }}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-input)',
                            color: sec.assigned_helper_name ? '#10B981' : 'var(--text-muted)',
                            fontSize: 12,
                            fontWeight: 600,
                            outline: 'none'
                          }}
                        >
                          <option value="">-- Nicht zugewiesen --</option>
                          {helpers.map(h => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                        </select>

                        {sec.type === 'line' && (sec.length_meters || sec.lengthMeters || 0) >= 16 && onSplitSection && (
                          <button
                            title="Abschnitt in 2 Hälften teilen"
                            onClick={() => {
                              const len = sec.length_meters || sec.lengthMeters || 0;
                              if (confirm(`Abschnitt "${sec.label}" (${len} m) in 2 Hälften (je ~${Math.round(len / 2)} m) teilen?`)) {
                                onSplitSection(sec.id);
                              }
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#F59E0B',
                              padding: 4,
                              cursor: 'pointer',
                              borderRadius: 4
                            }}
                          >
                            <Scissors size={14} />
                          </button>
                        )}

                        <button
                          title="Abschnitt löschen"
                          onClick={() => {
                            if (confirm(`Abschnitt "${sec.label}" löschen?`)) {
                              onDeleteSection(sec.id);
                            }
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-light)',
                            padding: 4,
                            cursor: 'pointer',
                            borderRadius: 4
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-light)')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VERTEILEN: bewusst getrennt von Karte und Helferstammdaten */}
        {activeTab === 'distribute' && (
          <div>
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, rgba(16,185,129,.16), rgba(56,189,248,.1))', border: '1px solid rgba(16,185,129,.35)', marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: 15 }}>Bereiche verteilen</div>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-muted)', marginTop: 4 }}>Zuerst werden Bereiche an den Stationen berücksichtigt. Danach bleiben nur zusammenhängende Restabschnitte zur Verteilung.</div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>1. Stationen zuerst zuordnen</div>
                <p style={{ margin: '4px 0 10px', fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>Die Verteilung zeigt vorher an, wer welchen Bereich erhält. Bestehende Zuweisungen können dabei erhalten bleiben.</p>
                <button type="button" disabled={!sections.length || !helpers.length} onClick={onOpenAutoAssign} style={{ width: '100%', border: 0, borderRadius: 6, padding: '8px 10px', background: '#10B981', color: '#fff', fontSize: 12, fontWeight: 800, cursor: !sections.length || !helpers.length ? 'not-allowed' : 'pointer', opacity: !sections.length || !helpers.length ? .55 : 1 }}>
                  Verteilung mit Vorschau öffnen
                </button>
              </div>

              <div style={{ padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>2. Freie Restabschnitte besprechen</div>
                <p style={{ margin: '4px 0 10px', fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>{unassignedSections.length ? `${unassignedSections.length} freie Abschnitte können direkt auf der Karte einzeln vergeben werden.` : 'Aktuell sind keine freien Abschnitte übrig.'}</p>
                <button type="button" onClick={() => { setActiveTab('sections'); setFilterStatus('unassigned'); }} style={{ width: '100%', border: '1px solid rgba(56,189,248,.42)', borderRadius: 6, padding: '8px 10px', background: 'rgba(56,189,248,.1)', color: '#7dd3fc', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Freie Abschnitte auf Karte zeigen
                </button>
              </div>

              <div style={{ padding: 13, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>3. Abschnittslänge anpassen</div>
                <p style={{ margin: '4px 0 10px', fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>Für freie Straßen kannst du 40 m, 50 m oder 60 m festlegen. Bereits besprochene Zuweisungen bleiben sichtbar.</p>
                <button type="button" disabled={!sections.length || !onOpenRedistributeModal} onClick={onOpenRedistributeModal} style={{ width: '100%', border: 0, borderRadius: 6, padding: '8px 10px', background: 'var(--accent-gold)', color: '#172033', fontSize: 12, fontWeight: 800, cursor: !sections.length || !onOpenRedistributeModal ? 'not-allowed' : 'pointer', opacity: !sections.length || !onOpenRedistributeModal ? .55 : 1 }}>
                  Abschnittslänge einstellen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: HELFER VERWALTUNG */}
        {activeTab === 'helpers' && (
          <div>
            {/* Eine klare Hauptaktion; seltene Datenaktionen bleiben aufgeräumt darunter. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onOpenHelperImport ? onOpenHelperImport('file') : onOpenExcelImport?.()}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1.5px solid rgba(16, 185, 129, 0.4)',
                    color: '#10B981',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                  title="Stations- oder Helferliste aus Excel oder CSV importieren"
                >
                  <FileUp size={15} />
                  Excel/CSV importieren
                </button>

                <button
                  type="button"
                  onClick={() => setShowHelperDataActions(open => !open)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: '#38BDF8',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                  title="Vorlage, Textimport, Export und weitere Helferaktionen"
                >
                  <ChevronDown size={14} /> Mehr
                </button>
              </div>

              {showHelperDataActions && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 8, borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => onOpenHelperImport ? onOpenHelperImport('paste') : onOpenExcelImport?.()}
                  title="Namen direkt aus WhatsApp, Word oder E-Mail importieren"
                  style={{ padding: '7px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.35)', color: '#38BDF8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  <ClipboardList size={12} /> Text importieren
                </button>
                <button
                  type="button"
                  onClick={handleDownloadHelperTemplate}
                  title="Muster-Excel-Vorlage für Helferliste herunterladen"
                  style={{
                    padding: '7px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <FileDown size={12} />
                  Vorlage (.xlsx)
                </button>

                <button
                  type="button"
                  onClick={() => exportHelpersToExcel(helpers, sections, candleSpacing)}
                  title="Aktuelle Helferliste mit Abschnitten als Excel (.xlsx) herunterladen"
                  style={{
                    padding: '7px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: '#10B981',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <FileSpreadsheet size={12} color="#10B981" />
                  Export (.xlsx)
                </button>

                {onDeleteAllHelpers && helpers.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm(`⚠️ Achtung:\nMöchtest du wirklich alle ${helpers.length} Helfer löschen?\n\nAlle bestehenden Zuweisungen zu Straßenabschnitten werden aufgehoben.`)) {
                        await onDeleteAllHelpers();
                      }
                    }}
                    title="Alle bestehenden Helfer löschen und Liste leeren"
                    style={{
                      padding: '7px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#EF4444',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Trash2 size={12} />
                      Helferliste leeren
                  </button>
                )}
              </div>}
            </div>

            <form onSubmit={handleCreateHelper} style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input
                type="text"
                placeholder="Neuer Helfer (z.B. Anna Schmidt)..."
                value={newHelperName}
                onChange={e => setNewHelperName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  fontSize: 12,
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'var(--accent-gold)',
                  color: '#0F172A',
                  border: 'none',
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <Plus size={14} />
                Hinzufügen
              </button>
            </form>

            <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10 }}>
              Du kannst Helfernamen anklicken zum Bearbeiten oder neue hinzufügen:
            </div>

            {/* Helpers List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {helpers.map(h => {
                const assigned = sections.filter(s => s.assigned_helper_id === h.id);
                const assignedMeters = assigned.reduce((sum, s) => sum + s.lengthMeters, 0);

                if (editingHelperId === h.id) {
                  return (
                    <div
                      key={h.id}
                      style={{
                        display: 'flex',
                        gap: 6,
                        padding: '6px 8px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-sm)',
                        alignItems: 'center'
                      }}
                    >
                      <input
                        type="text"
                        value={editHelperName}
                        onChange={e => setEditHelperName(e.target.value)}
                        autoFocus
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          fontSize: 12,
                          background: 'var(--bg-input)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--accent-gold)',
                          borderRadius: 4
                        }}
                      />
                      <button
                        onClick={() => handleSaveEditHelper(h.id)}
                        style={{
                          background: '#10B981',
                          color: 'white',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setEditingHelperId(null)}
                        style={{
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: 'none',
                          padding: '4px 6px',
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color || '#3B82F6' }} />
                      <span
                        style={{ fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer' }}
                        onClick={() => {
                          setEditingHelperId(h.id);
                          setEditHelperName(h.name);
                        }}
                        title="Klicken zum Bearbeiten des Namens"
                      >
                        {h.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: assignedMeters > 0 ? 'var(--accent-gold)' : 'var(--text-light)' }}>
                        {assignedMeters > 0 ? `${assignedMeters} m (~${Math.max(1, Math.round(assignedMeters / candleSpacing))} 🕯️)` : '0 m'}
                      </span>

                      {onSelectStampHelper && (
                        <button
                          type="button"
                          onClick={() => onSelectStampHelper(activeStampHelperId === h.id ? null : h.id)}
                          title={activeStampHelperId === h.id ? "Kartenansicht für diesen Helfer schließen" : `Zeigt die Abschnitte von ${h.name} auf der Karte`}
                          style={{
                            background: activeStampHelperId === h.id ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.06)',
                            border: activeStampHelperId === h.id ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
                            color: activeStampHelperId === h.id ? '#0F172A' : 'var(--text-muted)',
                            padding: '3px 6px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3
                          }}
                        >
                          <MapPin size={11} />
                          {activeStampHelperId === h.id ? 'Auf Karte' : 'Zeigen'}
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setEditingHelperId(h.id);
                          setEditHelperName(h.name);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-light)',
                          fontSize: 11,
                          cursor: 'pointer',
                          padding: '2px 4px'
                        }}
                      >
                        ✎
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Helfer "${h.name}" löschen? Zugewiesene Abschnitte werden wieder frei.`)) {
                            onDeleteHelper(h.id);
                          }
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-light)',
                          cursor: 'pointer',
                          padding: 2
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-light)')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: FAIRNESS & STATISTIK */}
        {activeTab === 'stats' && (
          <div>
            <div style={{ padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'rgba(56,189,248,.09)', border: '1px solid rgba(56,189,248,.28)', marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: 14 }}>Prüfen & nachbessern</div>
              <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>Klicke einen Helfer oder Abschnitt an, um ihn auf der Karte hervorzuheben. Offene und unfaire Bereiche werden hier zuerst sichtbar.</div>
            </div>

            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: 13 }}>Verteilungsübersicht</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>Nach den Spaltenüberschriften sortierbar · Klick auf eine Zeile zeigt den Bereich auf der Karte.</div>
                </div>
                <span style={{ color: 'var(--accent-gold)', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>Ø {avgMetersPerActiveHelper} m</span>
              </div>
              <div style={{ overflowX: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11 }}>
                  <colgroup>
                    <col style={{ width: 30 }} />
                    <col />
                    <col style={{ width: 54 }} />
                    <col style={{ width: 48 }} />
                    <col style={{ width: 38 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-input)', textAlign: 'left' }}>
                      <th style={{ padding: '7px 6px' }}>#</th>
                      <th style={{ padding: '7px 5px' }}>Helfer</th>
                      <th style={{ padding: '7px 4px', textAlign: 'right' }}>
                        <button type="button" onClick={() => toggleStatsSort('meters')} title="Nach Metern sortieren" style={{ border: 0, background: 'transparent', color: statsSort === 'meters' ? 'var(--accent-gold)' : 'var(--text-muted)', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          m {statsSort === 'meters' ? (statsSortDirection === 'desc' ? '↓' : '↑') : '↕'}
                        </button>
                      </th>
                      <th style={{ padding: '7px 4px', textAlign: 'right' }}>
                        <button type="button" onClick={() => toggleStatsSort('sections')} title="Nach Abschnittsanzahl sortieren" style={{ border: 0, background: 'transparent', color: statsSort === 'sections' ? 'var(--accent-gold)' : 'var(--text-muted)', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          Abs. {statsSort === 'sections' ? (statsSortDirection === 'desc' ? '↓' : '↑') : '↕'}
                        </button>
                      </th>
                      <th style={{ padding: '7px 4px' }} aria-label="Auf Karte anzeigen" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHelperStats.map((item, index) => {
                      const difference = item.meters - avgMetersPerActiveHelper;
                      const isFocused = focusedHelperId === item.helper.id;
                      return (
                        <tr
                          key={item.helper.id}
                          onClick={() => {
                            if (!item.sections.length) return;
                            setFocusedHelperId(item.helper.id);
                            setFocusedHelperSectionIndex(0);
                            selectAndFocusSection(item.sections[0].id);
                          }}
                          title={item.sections.length ? `${item.helper.name} auf der Karte anzeigen` : 'Noch kein Bereich zugeteilt'}
                          style={{ borderTop: '1px solid var(--border-subtle)', cursor: item.sections.length ? 'pointer' : 'default', background: isFocused ? 'rgba(245,158,11,.10)' : 'transparent' }}
                        >
                          <td style={{ padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 700 }}>{index + 1}</td>
                          <td style={{ padding: '8px 5px', minWidth: 0, overflowWrap: 'anywhere' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-main)', fontWeight: 700 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.helper.color || 'var(--accent-gold)', flexShrink: 0 }} />
                              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.helper.name}</span>
                            </div>
                            {item.sectionsCount > 0 && <div style={{ fontSize: 10, marginTop: 2, color: difference > 0 ? '#F59E0B' : difference < 0 ? '#60A5FA' : 'var(--text-muted)' }}>{difference === 0 ? 'genau im Durchschnitt' : `${difference > 0 ? '+' : ''}${difference} m zum Ø`}</div>}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--accent-gold)', fontWeight: 800, whiteSpace: 'nowrap' }}>{item.meters} m</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-main)', fontWeight: 700 }}>{item.sectionsCount}</td>
                          <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                            {item.sectionsCount > 0 && (
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  setFocusedHelperId(item.helper.id);
                                  setFocusedHelperSectionIndex(0);
                                  selectAndFocusSection(item.sections[0].id);
                                }}
                                title={`${item.helper.name} auf der Karte anzeigen`}
                                aria-label={`${item.helper.name} auf der Karte anzeigen`}
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 27, border: '1px solid rgba(245,158,11,.45)', borderRadius: 5, padding: 0, background: 'rgba(245,158,11,.10)', color: 'var(--accent-gold)', cursor: 'pointer' }}
                              >
                                <MapPin size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Section Redistribution Action Card */}
            {onOpenRedistributeModal && sections.length > 0 && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 16
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Scissors size={18} color="#F59E0B" />
                  <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    Straßen in Teilstücke einteilen
                  </h4>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                  Aktuell: <b>{sections.length} Abschnitte</b> auf <b>{totalMeters.toLocaleString('de-DE')} m</b>.
                  <br />
                  Stelle z. B. 40 m, 50 m oder 60 m ein und sieh sofort, wie viele freie Abschnitte entstehen. Die Zuordnung bleibt zunächst offen.
                </p>
                <button
                  type="button"
                  onClick={onOpenRedistributeModal}
                  style={{
                    width: '100%',
                    background: '#F59E0B',
                    color: '#000',
                    border: 'none',
                    padding: '8px 12px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  <Scissors size={14} />
                  Abschnittslänge einstellen
                </button>
              </div>
            )}

            {/* Auto Assignment Action Card */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(16, 185, 129, 0.15))',
                border: '1px solid var(--accent-gold)',
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                marginBottom: 16
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Sparkles size={18} color="var(--accent-gold)" />
                <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-main)' }}>
                  Smarte automatische Verteilung
                </h4>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                Balanciert die Meteranzahl gleichmäßig zwischen Helfern aus und hält Abschnitte derselben Straße zusammen.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleAutoAssign(true)}
                  disabled={isAutoAssigning || unassignedSections.length === 0}
                  style={{
                    flex: 1,
                    background: '#10B981',
                    color: 'white',
                    border: 'none',
                    padding: '8px 10px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: unassignedSections.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: unassignedSections.length === 0 ? 0.5 : 1
                  }}
                >
                  Offene verteilen ({unassignedSections.length})
                </button>
                <button
                  onClick={() => handleAutoAssign(false)}
                  disabled={isAutoAssigning || sections.length === 0}
                  style={{
                    flex: 1,
                    background: 'var(--accent-gold)',
                    color: '#0F172A',
                    border: 'none',
                    padding: '8px 10px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: sections.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: sections.length === 0 ? 0.5 : 1
                  }}
                >
                  Alle neu ausgleichen
                </button>
              </div>
            </div>

            {/* Material- & Kerzenrechner Card */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(239, 68, 68, 0.08))',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                marginBottom: 16
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Flame size={18} color="#F59E0B" />
                  <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    Material- & Kerzenrechner
                  </h4>
                </div>
                <span style={{ fontSize: 11, background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                  Lichter-Planer
                </span>
              </div>

              {/* Spacing & Buffer Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Abstand: <b>{candleSpacing} m</b>
                  </label>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[1.5, 2.0, 2.5, 3.0].map(val => (
                      <button
                        key={val}
                        onClick={() => onUpdateCandleConfig?.(val, candleBuffer)}
                        style={{
                          flex: 1,
                          padding: '4px 0',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: candleSpacing === val ? '1px solid #F59E0B' : '1px solid var(--border-subtle)',
                          background: candleSpacing === val ? '#F59E0B' : 'transparent',
                          color: candleSpacing === val ? '#0F172A' : 'var(--text-main)',
                          cursor: 'pointer'
                        }}
                      >
                        {val}m
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Reserve: <b>+{candleBuffer}%</b>
                  </label>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[5, 10, 15, 20].map(val => (
                      <button
                        key={val}
                        onClick={() => onUpdateCandleConfig?.(candleSpacing, val)}
                        style={{
                          flex: 1,
                          padding: '4px 0',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: candleBuffer === val ? '1px solid #F59E0B' : '1px solid var(--border-subtle)',
                          background: candleBuffer === val ? '#F59E0B' : 'transparent',
                          color: candleBuffer === val ? '#0F172A' : 'var(--text-main)',
                          cursor: 'pointer'
                        }}
                      >
                        +{val}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Results Metrics */}
              <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Strecken-Lichter ({totalMeters} m):</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{totalCandlesBase.toLocaleString('de-DE')} Stk.</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Puffer (+{candleBuffer}% Reserve):</span>
                  <span style={{ fontWeight: 700, color: '#F59E0B' }}>+{totalCandlesBuffer.toLocaleString('de-DE')} Stk.</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-main)' }}>Gesamt-Bedarf:</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: '#10B981' }}>
                    {totalCandlesWithBuffer.toLocaleString('de-DE')} Lichter
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                  <span>📦 Kartons à 50 Stk.: <b>{boxesOf50}</b></span>
                  <span>📦 Kartons à 100 Stk.: <b>{boxesOf100}</b></span>
                </div>
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-secondary)',
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 16
              }}
            >
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--accent-gold)' }}>
                ⚖️ Gerechtigkeits-Kennzahlen
              </h4>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>Durchschnitt (aktive Helfer):</span>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>~{avgMetersPerActiveHelper} m</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>Eingeteilte Helfer:</span>
                <span style={{ fontWeight: 700, color: '#10B981' }}>{activeHelperCount} von {helpers.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Offene Abschnitte:</span>
                <span style={{ fontWeight: 700, color: unassignedSections.length > 0 ? '#EF4444' : '#10B981' }}>
                  {unassignedSections.length}
                </span>
              </div>
            </div>

            <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
              Meter- & Lichter-Verteilung pro Helfer:
            </h4>

            {/* Helper distribution bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {helperStats
                .filter(item => item.meters > 0)
                .map(item => {
                  const percent = maxMeters > 0 ? (item.meters / maxMeters) * 100 : 0;
                  const isHigh = item.meters > avgMetersPerActiveHelper * 1.35;
                  const isLow = item.meters < avgMetersPerActiveHelper * 0.65;
                  const hCandles = Math.max(1, Math.round(item.meters / candleSpacing));
                  const isFocused = focusedHelperId === item.helper.id;

                  return (
                    <div
                      key={item.helper.id}
                      onClick={() => {
                        const nextIndex = isFocused ? (focusedHelperSectionIndex + 1) % item.sections.length : 0;
                        setFocusedHelperId(item.helper.id);
                        setFocusedHelperSectionIndex(nextIndex);
                        selectAndFocusSection(item.sections[nextIndex].id);
                      }}
                      title="Klicken: Abschnitt auf der Karte anzeigen; bei mehreren Abschnitten erneut klicken"
                      style={{
                        background: 'var(--bg-card)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: isFocused ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
                        boxShadow: isFocused ? '0 0 0 1px rgba(245, 158, 11, .25)' : 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>{item.helper.name}</span>
                          <span style={{ color: 'var(--accent-gold)', fontSize: 10, fontWeight: 800 }}>↗ Karte</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isHigh && (
                            <span style={{ fontSize: 9, background: 'rgba(239, 68, 68, 0.2)', color: '#F87171', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                              Hoch
                            </span>
                          )}
                          {isLow && (
                            <span style={{ fontSize: 9, background: 'rgba(59, 130, 246, 0.2)', color: '#60A5FA', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                              Niedrig
                            </span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-gold)' }}>
                            {item.meters} m <span style={{ color: '#10B981', fontSize: 11, fontWeight: 600 }}> (~{hCandles} 🕯️)</span>
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${percent}%`,
                            background: isHigh ? '#EF4444' : item.helper.color || 'var(--accent-gold)',
                            borderRadius: 3,
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>

                      <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4 }}>
                        {item.sectionsCount} {item.sectionsCount === 1 ? 'Abschnitt' : 'Abschnitte'} · Abschnitt anklicken = Karte anzeigen
                      </div>

                      <div style={{ display: 'grid', gap: 6, marginTop: 9 }} onClick={event => event.stopPropagation()}>
                        {item.sections.map(section => {
                          const isSelected = selectedSectionId === section.id;
                          return (
                            <div
                              key={section.id}
                              onClick={() => {
                                setFocusedHelperId(item.helper.id);
                                setFocusedHelperSectionIndex(item.sections.findIndex(candidate => candidate.id === section.id));
                                selectAndFocusSection(section.id);
                              }}
                              style={{ padding: '7px 8px', borderRadius: 6, background: isSelected ? 'rgba(245,158,11,.12)' : 'var(--bg-input)', border: isSelected ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)', cursor: 'pointer' }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-main)', fontSize: 11, fontWeight: 800 }}>{section.label}</span>
                                <span style={{ color: 'var(--accent-gold)', fontSize: 11, fontWeight: 800 }}>{Math.round(section.length_meters ?? section.lengthMeters ?? 0)} m</span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>{section.street_name}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginTop: 7 }}>
                                <select
                                  aria-label={`Helfer für ${section.label} ändern`}
                                  value={section.assigned_helper_id || ''}
                                  onClick={event => event.stopPropagation()}
                                  onChange={event => {
                                    event.stopPropagation();
                                    const nextHelper = helpers.find(helper => helper.id === event.target.value);
                                    onUpdateSectionHelper(section.id, nextHelper?.id || null, nextHelper?.name || null);
                                  }}
                                  style={{ minWidth: 0, padding: '5px 6px', borderRadius: 5, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', color: 'var(--text-main)', fontSize: 10 }}
                                >
                                  <option value="">— Nicht zugewiesen —</option>
                                  {helpers.map(helper => <option key={helper.id} value={helper.id}>{helper.name}</option>)}
                                </select>
                                <button
                                  type="button"
                                  aria-label={`${section.label} löschen`}
                                  title="Abschnitt löschen"
                                  onClick={event => {
                                    event.stopPropagation();
                                    if (window.confirm(`Abschnitt „${section.label}“ wirklich löschen?`)) onDeleteSection(section.id);
                                  }}
                                  style={{ border: '1px solid rgba(239,68,68,.35)', borderRadius: 5, padding: '4px 7px', background: 'rgba(239,68,68,.1)', color: '#f87171', cursor: 'pointer' }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

              {helperStats.every(h => h.meters === 0) && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-light)', fontSize: 12 }}>
                  Bisher wurden noch keine Abschnitte an Helfer zugewiesen.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Seltene Datei- und Sicherungsaktionen sind bewusst nur bei Bedarf sichtbar. */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <button type="button" onClick={() => setShowDataTools(open => !open)} style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📁 Daten & Sicherung</span><ChevronDown size={15} style={{ transform: showDataTools ? 'rotate(180deg)' : undefined, transition: 'transform .15s ease' }} />
        </button>
        {showDataTools && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => exportSectionsToExcel(sections, helpers, candleSpacing, candleBuffer)} title="Vollständigen Plan als Excel herunterladen" style={{ padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,.4)', background: 'rgba(16,185,129,.12)', color: '#10B981', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}><FileSpreadsheet size={13} /> Plan als Excel</button>
          {onOpenExcelImport && <button onClick={onOpenExcelImport} title="Kompletten Plan aus Excel importieren" style={{ padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(56,189,248,.4)', background: 'rgba(56,189,248,.12)', color: '#38BDF8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}><Upload size={13} /> Plan importieren</button>}
          <button onClick={() => exportSectionsToGeoJSON(sections)} title="GeoJSON für QGIS / Google Maps exportieren" style={{ padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-main)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}><Compass size={13} /> GeoJSON</button>
          <button onClick={() => exportSectionsToGPX(sections)} title="GPX-Track für Smartphone Outdoor-Apps exportieren" style={{ padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-main)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}><Download size={13} /> GPX</button>
            <button
              onClick={onExportBackup}
              title="Datenbank als JSON herunterladen"
              style={{
                background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
                padding: '7px 8px', borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <Download size={12} />
              Backup speichern
            </button>

            <label
              title="JSON-Backup wiederherstellen"
              style={{
                background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
                padding: '7px 8px', borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <Upload size={12} />
              Backup einspielen
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportBackup(file);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          <button
            onClick={onResetDatabase}
            title="Alle Strecken & Daten zurücksetzen"
            style={{
              background: 'transparent', border: '1px solid rgba(239,68,68,.3)', padding: '7px 8px', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-light)',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-light)')}
          >
            <RotateCcw size={12} />
            Alles zurücksetzen
          </button>
        </div>}
      </div>

    </aside>
  );
};
