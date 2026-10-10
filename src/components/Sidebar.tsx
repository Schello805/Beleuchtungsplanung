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
import { calculateFairAssignment } from '../utils/fairness';

interface SidebarProps {
  sections: Section[];
  helpers: Helper[];
  streets: Street[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onDeleteSection: (sectionId: string) => void;
  onAddHelper: (name: string, color?: string, phone?: string) => Promise<void>;
  onUpdateHelper: (id: string, name: string, color?: string, phone?: string) => Promise<void>;
  onDeleteHelper: (id: string) => Promise<void>;
  onImportHelpers?: (helpers: Array<{ name: string; phone?: string; color?: string }>, mode: 'replace' | 'append') => Promise<void>;
  onOpenPrintView: () => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onResetDatabase: () => void;
  onBatchAssign: (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => Promise<void>;
  onOpenRedistributeModal?: () => void;
  onSplitSection?: (sectionId: string) => Promise<void>;
  onOpenAutoAssign?: () => void;
  activeStampHelperId?: string | null;
  onSelectStampHelper?: (id: string | null) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  candleSpacing?: number;
  candleBuffer?: number;
  onUpdateCandleConfig?: (spacing: number, buffer: number) => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  helpers,
  streets,
  selectedSectionId,
  onSelectSection,
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
  activeStampHelperId,
  onSelectStampHelper,
  theme,
  onToggleTheme,
  candleSpacing = 2.0,
  candleBuffer = 10,
  onUpdateCandleConfig
}) => {
  const [activeTab, setActiveTab] = useState<'sections' | 'helpers' | 'stats'>('sections');

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

  // Helper import from Excel / CSV (.xlsx / .csv)
  const [showHelperImportModal, setShowHelperImportModal] = useState<boolean>(false);
  const [importedHelperPreview, setImportedHelperPreview] = useState<Array<{ name: string; phone: string }>>([]);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importHelperMode, setImportHelperMode] = useState<'replace' | 'append'>('replace');
  const [isImportingHelpers, setIsImportingHelpers] = useState<boolean>(false);
  const helperFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDownloadHelperTemplate = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Name', 'Telefon'],
      ['Anna Schmidt', '0171 1234567'],
      ['Michael Weber', '0160 9876543'],
      ['Thomas Müller', '09822 1234'],
      ['Helfer 04', ''],
      ['Helfer 05', '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Helfer');
    XLSX.writeFile(wb, 'lichternacht_helfer_vorlage.xlsx');
  };

  const handleHelperFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });

      if (rawRows.length === 0) {
        alert('Die ausgewählte Datei enthält keine Daten.');
        return;
      }

      // Detect header row
      let headerRowIdx = -1;
      let nameColIdx = 0;
      let phoneColIdx = -1;
      let vornameColIdx = -1;
      let nachnameColIdx = -1;

      for (let r = 0; r < Math.min(5, rawRows.length); r++) {
        const row = (rawRows[r] || []).map(c => String(c).trim().toLowerCase());
        const hasHeader = row.some(cell =>
          cell.includes('name') || cell.includes('helfer') || cell.includes('telefon') || cell.includes('phone') || cell.includes('mobil')
        );
        if (hasHeader) {
          headerRowIdx = r;
          row.forEach((cell, idx) => {
            if (cell === 'vorname') vornameColIdx = idx;
            else if (cell === 'nachname') nachnameColIdx = idx;
            else if (cell.includes('name') || cell.includes('helfer')) nameColIdx = idx;
            else if (cell.includes('telefon') || cell.includes('phone') || cell.includes('mobil') || cell.includes('handy') || cell.includes('tel')) phoneColIdx = idx;
          });
          break;
        }
      }

      const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
      const parsed: Array<{ name: string; phone: string }> = [];

      for (let r = startRow; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        let name = '';
        if (vornameColIdx !== -1 && nachnameColIdx !== -1) {
          const v = String(row[vornameColIdx] || '').trim();
          const n = String(row[nachnameColIdx] || '').trim();
          name = `${v} ${n}`.trim();
        } else {
          name = String(row[nameColIdx] || '').trim();
        }

        if (!name || name.toLowerCase() === 'name' || name.toLowerCase() === 'vorname') continue;

        let phone = '';
        if (phoneColIdx !== -1) {
          phone = String(row[phoneColIdx] || '').trim();
        } else if (row.length > 1 && nameColIdx === 0) {
          phone = String(row[1] || '').trim();
        }

        parsed.push({ name, phone });
      }

      if (parsed.length === 0) {
        alert('Keine gültigen Helfernamen in der Datei gefunden. Bitte prüfe das Format (z.B. Spalte "Name").');
        return;
      }

      setImportFileName(file.name);
      setImportedHelperPreview(parsed);
      setShowHelperImportModal(true);
    } catch (err: any) {
      alert(`Fehler beim Lesen der Datei: ${err.message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleConfirmHelperImport = async () => {
    if (importedHelperPreview.length === 0) return;
    setIsImportingHelpers(true);
    try {
      if (onImportHelpers) {
        await onImportHelpers(importedHelperPreview, importHelperMode);
      }
      setShowHelperImportModal(false);
      setImportedHelperPreview([]);
    } catch (err: any) {
      alert(`Import fehlgeschlagen: ${err.message}`);
    } finally {
      setIsImportingHelpers(false);
    }
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
  const avgMetersPerActiveHelper = activeHelperCount > 0
    ? Math.round(totalMeters / activeHelperCount)
    : 0;
  const maxMeters = Math.max(...helperStats.map(h => h.meters), 1);

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
      const result = calculateFairAssignment(targetSections, helpers);
      await onBatchAssign(result.assignments);
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
      className="no-print"
      style={{
        width: 440,
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
              Druckansicht
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
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)'
        }}
      >
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
          Abschnitte ({sections.length})
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
          Helfer ({helpers.length})
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
          Fairness
        </button>
      </div>

      {/* TAB CONTENT CONTAINER */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
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

            {/* Fair Redistribution Action Banner */}
            {sections.length > 0 && onOpenRedistributeModal && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 12,
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-main)' }}>
                  <Scissors size={14} style={{ color: '#F59E0B' }} />
                  <span>
                    <b>{sections.length} Abschnitte</b>
                    {helpers.length > sections.length ? (
                      <span style={{ color: '#F59E0B', marginLeft: 4 }}>({helpers.length} Helfer vorhanden)</span>
                    ) : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenRedistributeModal}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 4,
                    background: '#F59E0B',
                    color: '#000',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)'
                  }}
                >
                  <Sparkles size={12} />
                  Auf alle Helfer aufteilen
                </button>
              </div>
            )}

            {/* 1-Click Auto Assign Banner */}
            {unassignedSections.length > 0 && onOpenAutoAssign && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.12))',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 12,
                  gap: 8
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-main)' }}>
                  <b style={{ color: '#10B981' }}>{unassignedSections.length} Abschnitte offen</b>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Schnell an Helfer vergeben</div>
                </div>
                <button
                  type="button"
                  onClick={onOpenAutoAssign}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 4,
                    background: '#10B981',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Zap size={12} />
                  ⚡ Auto-Zuweisen
                </button>
              </div>
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
                                onClick={() => onSelectSection(sec.id)}
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
                                  <span style={{ fontSize: 11, fontWeight: 700, color: sec.color }}>{sec.lengthMeters} m</span>
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
                      onClick={() => onSelectSection(sec.id)}
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

        {/* TAB 2: HELFER VERWALTUNG */}
        {activeTab === 'helpers' && (
          <div>
            {/* 1-Click Auto Assign Banner */}
            {onOpenAutoAssign && unassignedSections.length > 0 && (
              <button
                type="button"
                onClick={onOpenAutoAssign}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  border: 'none',
                  color: '#0F172A',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                  marginBottom: 12,
                  boxShadow: '0 0 14px rgba(245, 158, 11, 0.3)'
                }}
              >
                <Zap size={15} />
                ⚡ 1-Klick Auto-Zuweisung ({unassignedSections.length} offene Abschnitte)
              </button>
            )}

            {/* CSV / Excel Import & Template Bar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                type="file"
                ref={helperFileInputRef}
                accept=".xlsx, .xls, .csv"
                style={{ display: 'none' }}
                onChange={handleHelperFileUpload}
              />
              <button
                type="button"
                onClick={() => helperFileInputRef.current?.click()}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#10B981',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                <FileUp size={14} />
                Excel / CSV importieren
              </button>

              <button
                type="button"
                onClick={handleDownloadHelperTemplate}
                title="Muster-Excel-Vorlage für Helferliste herunterladen"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <FileDown size={13} />
                Vorlage (.xlsx)
              </button>

              <button
                type="button"
                onClick={() => exportHelpersToExcel(helpers, sections, candleSpacing)}
                title="Aktuelle Helferliste mit zugewiesenen Abschnitten & Metern als Excel (.xlsx) herunterladen"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  color: '#10B981',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <FileSpreadsheet size={13} color="#10B981" />
                Helfer (.xlsx)
              </button>
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
                          title={activeStampHelperId === h.id ? "Stempel-Modus für diesen Helfer deaktivieren" : `Stempel-Modus aktivieren: Klicke Abschnitte auf der Karte, um sie direkt ${h.name} zuzuweisen`}
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
                          <Paintbrush size={11} />
                          {activeStampHelperId === h.id ? 'Aktiv' : 'Stempel'}
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
                    Strecken auf alle Helfer aufteilen ({helpers.length} Helfer)
                  </h4>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                  Aktuell: <b>{sections.length} Abschnitte</b> für <b>{helpers.length} Helfer</b>. 
                  {helpers.length > sections.length 
                    ? ` (${helpers.length - sections.length} Helfer gehen aktuell leer aus!)`
                    : ''}
                  <br />
                  Verkleinert längere Strecken intelligent (z. B. auf ~40 m), damit jeder Helfer ein Teilstück bekommt.
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
                  Jetzt auf {Math.max(sections.length, helpers.length)} Abschnitte zuschneiden
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

                  return (
                    <div
                      key={item.helper.id}
                      style={{
                        background: 'var(--bg-card)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
                          {item.helper.name}
                        </span>
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
                        {item.sectionsCount} {item.sectionsCount === 1 ? 'Abschnitt' : 'Abschnitte'}:{' '}
                        {item.sections.map(s => s.street_name).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
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

      {/* FOOTER: EXPORTS, BACKUP & SYSTEM ACTIONS */}
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
        {/* Export formats row */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => exportSectionsToExcel(sections, helpers, candleSpacing, candleBuffer)}
            title="Vollständigen Strecken- & Helferplan als echte Excel-Arbeitsmappe (.xlsx mit 3 Tabellenblättern) herunterladen"
            style={{
              flex: 1.2,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#10B981',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5
            }}
          >
            <FileSpreadsheet size={14} color="#10B981" />
            Excel (.xlsx)
          </button>

          <button
            onClick={() => exportSectionsToGeoJSON(sections)}
            title="GeoJSON für QGIS / Google Maps exportieren"
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-main)',
              padding: '5px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4
            }}
          >
            <Compass size={13} color="#3B82F6" />
            GeoJSON
          </button>

          <button
            onClick={() => exportSectionsToGPX(sections)}
            title="GPX-Track für Smartphone Outdoor-Apps exportieren"
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-main)',
              padding: '5px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4
            }}
          >
            <Download size={13} color="var(--accent-gold)" />
            GPX
          </button>
        </div>

        {/* Database actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onExportBackup}
              title="Datenbank als JSON herunterladen"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <Download size={12} />
              JSON-Backup
            </button>

            <label
              title="JSON-Backup wiederherstellen"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <Upload size={12} />
              Import
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
          </div>

          <button
            onClick={onResetDatabase}
            title="Alle Strecken & Daten zurücksetzen"
            style={{
              background: 'transparent',
              border: 'none',
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
            Reset
          </button>
        </div>
      </div>

      {/* Excel / CSV Helper Import Modal */}
      {showHelperImportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(5px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => !isImportingHelpers && setShowHelperImportModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1A1F2C)',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
              borderRadius: 16,
              maxWidth: 540,
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
              color: 'var(--text-main, #FFFFFF)'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255, 255, 255, 0.02)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10B981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Helfer importieren</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #94A3B8)' }}>
                    Datei: <strong style={{ color: 'var(--accent-gold, #F59E0B)' }}>{importFileName}</strong> ({importedHelperPreview.length} Einträge erkannt)
                  </div>
                </div>
              </div>
              <button
                onClick={() => !isImportingHelpers && setShowHelperImportModal(false)}
                disabled={isImportingHelpers}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted, #94A3B8)',
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Import Mode Selection */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #94A3B8)', display: 'block', marginBottom: 8 }}>
                  Import-Modus:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div
                    onClick={() => setImportHelperMode('replace')}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1.5px solid ${importHelperMode === 'replace' ? '#10B981' : 'var(--border-subtle, rgba(255,255,255,0.1))'}`,
                      background: importHelperMode === 'replace' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <input
                        type="radio"
                        checked={importHelperMode === 'replace'}
                        onChange={() => setImportHelperMode('replace')}
                        style={{ accentColor: '#10B981', cursor: 'pointer' }}
                      />
                      Ersetzen (Empfohlen)
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted, #94A3B8)', lineHeight: 1.3 }}>
                      Bestehende {helpers.length} Helfer komplett durch die {importedHelperPreview.length} neuen ersetzen.
                    </div>
                  </div>

                  <div
                    onClick={() => setImportHelperMode('append')}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1.5px solid ${importHelperMode === 'append' ? '#10B981' : 'var(--border-subtle, rgba(255,255,255,0.1))'}`,
                      background: importHelperMode === 'append' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <input
                        type="radio"
                        checked={importHelperMode === 'append'}
                        onChange={() => setImportHelperMode('append')}
                        style={{ accentColor: '#10B981', cursor: 'pointer' }}
                      />
                      Anhängen
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted, #94A3B8)', lineHeight: 1.3 }}>
                      {importedHelperPreview.length} neue Helfer an die vorhandenen {helpers.length} anhängen.
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Preview Table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #94A3B8)' }}>
                    Vorschau der erkannten Daten ({importedHelperPreview.length}):
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--accent-gold, #F59E0B)' }}>
                    Automatisch formatiert
                  </span>
                </div>
                <div
                  style={{
                    maxHeight: 240,
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                    borderRadius: 8,
                    background: 'rgba(0, 0, 0, 0.2)'
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255, 255, 255, 0.05)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.1))' }}>
                        <th style={{ padding: '8px 12px', width: 40, color: 'var(--text-muted, #94A3B8)' }}>#</th>
                        <th style={{ padding: '8px 12px', color: 'var(--text-main, #FFFFFF)' }}>Name</th>
                        <th style={{ padding: '8px 12px', color: 'var(--text-muted, #94A3B8)' }}>Telefon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedHelperPreview.map((h, idx) => (
                        <tr
                          key={idx}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'
                          }}
                        >
                          <td style={{ padding: '6px 12px', color: 'var(--text-muted, #94A3B8)', fontSize: 11 }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: '6px 12px', fontWeight: 600 }}>
                            {h.name}
                          </td>
                          <td style={{ padding: '6px 12px', color: h.phone ? 'var(--text-main, #FFFFFF)' : 'var(--text-light, #64748B)', fontFamily: 'monospace', fontSize: 11 }}>
                            {h.phone || '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                background: 'rgba(255, 255, 255, 0.02)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10
              }}
            >
              <button
                onClick={() => setShowHelperImportModal(false)}
                disabled={isImportingHelpers}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.15))',
                  background: 'transparent',
                  color: 'var(--text-main, #FFFFFF)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isImportingHelpers ? 'not-allowed' : 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmHelperImport}
                disabled={isImportingHelpers}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#10B981',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isImportingHelpers ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                }}
              >
                <Check size={16} />
                {isImportingHelpers
                  ? 'Wird importiert...'
                  : `${importedHelperPreview.length} Helfer jetzt importieren`}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
