import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { X, FileSpreadsheet, Upload, Check, AlertCircle, ArrowRight, UserPlus, Users, Sparkles, CheckSquare } from 'lucide-react';
import type { Section, Helper } from '../utils/api';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFile?: File | null;
  sections: Section[];
  helpers: Helper[];
  onApplyAssignments: (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => Promise<void>;
  onImportHelpers: (helpers: Array<{ name: string; phone?: string; color?: string }>, mode: 'replace' | 'append') => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

interface ParsedSectionMatch {
  rowIdx: number;
  label: string;
  streetName: string;
  excelHelperName: string;
  excelHelperPhone: string;
  excelNotes: string;
  matchedSection: Section | null;
  matchedHelper: Helper | null;
  isNewHelper: boolean;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  initialFile,
  sections,
  helpers,
  onApplyAssignments,
  onImportHelpers,
  onRefreshData
}) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  // Import type detection
  const [detectedType, setDetectedType] = useState<'schedule' | 'helpers' | 'unknown'>('unknown');

  // Schedule import options
  const [sectionMatches, setSectionMatches] = useState<ParsedSectionMatch[]>([]);
  const [applyAssignments, setApplyAssignments] = useState<boolean>(true);
  const [createMissingHelpers, setCreateMissingHelpers] = useState<boolean>(true);
  const [applyNotes, setApplyNotes] = useState<boolean>(true);

  // Pure helpers import options
  const [parsedHelpers, setParsedHelpers] = useState<Array<{ name: string; phone: string }>>([]);
  const [helperImportMode, setHelperImportMode] = useState<'append' | 'replace'>('append');

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialFile) {
      setFile(initialFile);
    }
  }, [initialFile]);

  // Read workbook whenever file changes
  useEffect(() => {
    if (!file) {
      setWorkbook(null);
      setAvailableSheets([]);
      setActiveSheetName('');
      setSectionMatches([]);
      setParsedHelpers([]);
      setDetectedType('unknown');
      setErrorMessage(null);
      return;
    }

    const readFile = async () => {
      try {
        setErrorMessage(null);
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        setWorkbook(wb);
        setAvailableSheets(wb.SheetNames);

        // Auto-select preferred sheet (Streckenplan first, then first sheet)
        const preferredSheet = wb.SheetNames.find(s =>
          s.toLowerCase().includes('strecke') || s.toLowerCase().includes('plan') || s.toLowerCase().includes('abschnitt')
        ) || wb.SheetNames[0];

        setActiveSheetName(preferredSheet || '');
      } catch (err: any) {
        setErrorMessage(`Excel-Datei konnte nicht gelesen werden: ${err.message}`);
      }
    };

    readFile();
  }, [file]);

  // Parse active sheet
  useEffect(() => {
    if (!workbook || !activeSheetName) return;

    try {
      const sheet = workbook.Sheets[activeSheetName];
      if (!sheet) return;

      const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      if (rawRows.length === 0) {
        setErrorMessage(`Das Tabellenblatt "${activeSheetName}" ist leer.`);
        return;
      }

      // 1. Look for Header Row
      let headerRowIdx = -1;
      let labelCol = -1;
      let streetCol = -1;
      let helperCol = -1;
      let phoneCol = -1;
      let notesCol = -1;
      let nameCol = -1;

      for (let r = 0; r < Math.min(6, rawRows.length); r++) {
        const row = (rawRows[r] || []).map(c => String(c).trim().toLowerCase());

        row.forEach((cell, idx) => {
          if (cell.includes('bezeichnung') || cell === 'abschnitt' || cell.includes('abschnitts-name')) labelCol = idx;
          if (cell.includes('straße') || cell.includes('strasse') || cell === 'street') streetCol = idx;
          if (cell.includes('helfer') || cell.includes('zugewiesen') || cell.includes('zuständig')) helperCol = idx;
          if (cell.includes('telefon') || cell.includes('phone') || cell.includes('mobil') || cell.includes('handy')) phoneCol = idx;
          if (cell.includes('notiz') || cell.includes('bemerkung') || cell.includes('besonderheit')) notesCol = idx;
          if (cell === 'name' || cell === 'helfer-name' || cell.includes('name')) nameCol = idx;
        });

        if (labelCol !== -1 || (nameCol !== -1 && helperCol === -1)) {
          headerRowIdx = r;
          break;
        }
      }

      // Check if this sheet is a schedule (has label/street or section columns)
      const isSchedule = labelCol !== -1 && (streetCol !== -1 || helperCol !== -1);

      if (isSchedule) {
        setDetectedType('schedule');
        const matches: ParsedSectionMatch[] = [];
        const startR = headerRowIdx !== -1 ? headerRowIdx + 1 : 1;

        for (let r = startR; r < rawRows.length; r++) {
          const row = rawRows[r];
          if (!row || row.length === 0) continue;

          const label = String(row[labelCol] || '').trim();
          const street = streetCol !== -1 ? String(row[streetCol] || '').trim() : '';
          const helperRaw = helperCol !== -1 ? String(row[helperCol] || '').trim() : '';
          const phone = phoneCol !== -1 ? String(row[phoneCol] || '').trim() : '';
          const notes = notesCol !== -1 ? String(row[notesCol] || '').trim() : '';

          if (!label) continue;

          // Helper clean-up: ignore placeholders
          let helperName = helperRaw;
          if (
            helperName.toLowerCase() === 'nicht zugewiesen' ||
            helperName.toLowerCase() === 'offen' ||
            helperName.toLowerCase() === 'frei' ||
            helperName === '-' ||
            helperName === '—'
          ) {
            helperName = '';
          }

          // Match section in project
          let matched: Section | null = null;
          // Match 1: exact label & street
          matched = sections.find(s =>
            s.label.toLowerCase() === label.toLowerCase() &&
            (!street || s.street_name.toLowerCase() === street.toLowerCase())
          ) || null;

          // Match 2: label only
          if (!matched) {
            matched = sections.find(s => s.label.toLowerCase() === label.toLowerCase()) || null;
          }

          // Match helper in project
          let matchedH: Helper | null = null;
          if (helperName) {
            matchedH = helpers.find(h => h.name.toLowerCase() === helperName.toLowerCase()) || null;
          }

          matches.push({
            rowIdx: r + 1,
            label,
            streetName: street,
            excelHelperName: helperName,
            excelHelperPhone: phone,
            excelNotes: notes,
            matchedSection: matched,
            matchedHelper: matchedH,
            isNewHelper: !!helperName && !matchedH
          });
        }

        setSectionMatches(matches);
      } else {
        // Assume pure helper list
        setDetectedType('helpers');
        const helperList: Array<{ name: string; phone: string }> = [];
        const startR = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
        const actualNameCol = nameCol !== -1 ? nameCol : (helperCol !== -1 ? helperCol : 0);

        for (let r = startR; r < rawRows.length; r++) {
          const row = rawRows[r];
          if (!row || row.length === 0) continue;

          const name = String(row[actualNameCol] || '').trim();
          const phone = phoneCol !== -1 ? String(row[phoneCol] || '').trim() : '';

          if (!name || name.toLowerCase() === 'name' || name.toLowerCase() === 'helfer') continue;

          helperList.push({ name, phone });
        }

        setParsedHelpers(helperList);
      }
    } catch (err: any) {
      setErrorMessage(`Fehler beim Analysieren des Tabellenblatts: ${err.message}`);
    }
  }, [workbook, activeSheetName, sections, helpers]);

  // Unique new helpers to create from schedule
  const uniqueNewHelpers = useMemo(() => {
    const map = new Map<string, string>();
    sectionMatches.forEach(m => {
      if (m.isNewHelper && m.excelHelperName) {
        if (!map.has(m.excelHelperName)) {
          map.set(m.excelHelperName, m.excelHelperPhone);
        }
      }
    });
    return Array.from(map.entries()).map(([name, phone]) => ({ name, phone }));
  }, [sectionMatches]);

  const matchedSectionsCount = sectionMatches.filter(m => !!m.matchedSection).length;
  const assignmentsCount = sectionMatches.filter(m => !!m.matchedSection && !!m.excelHelperName).length;

  // Handle final import execution
  const handleExecuteImport = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      if (detectedType === 'schedule') {
        // 1. Create missing helpers if option enabled
        if (createMissingHelpers && uniqueNewHelpers.length > 0) {
          await onImportHelpers(uniqueNewHelpers, 'append');
        }

        // 2. Fetch fresh helpers list after adding
        if (onRefreshData) {
          await onRefreshData();
        }

        // 3. Prepare assignments
        if (applyAssignments) {
          const assignments: Array<{ sectionId: string; helperId: string; helperName: string }> = [];

          sectionMatches.forEach(m => {
            if (!m.matchedSection) return;

            if (m.excelHelperName) {
              // Helper was existing or was just created
              const existing = helpers.find(h => h.name.toLowerCase() === m.excelHelperName.toLowerCase());
              const helperId = existing ? existing.id : `h-gen-${m.excelHelperName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

              assignments.push({
                sectionId: m.matchedSection.id,
                helperId,
                helperName: m.excelHelperName
              });
            } else {
              // Unassign if blank in excel
              assignments.push({
                sectionId: m.matchedSection.id,
                helperId: '',
                helperName: ''
              });
            }
          });

          if (assignments.length > 0) {
            await onApplyAssignments(assignments);
          }
        }

        alert(`✅ Excel-Import erfolgreich!\n• ${matchedSectionsCount} Abschnitte abgeglichen\n• ${assignmentsCount} Zuweisungen aktualisiert\n• ${uniqueNewHelpers.length} neue Helfer angelegt`);
        onClose();
      } else if (detectedType === 'helpers') {
        if (parsedHelpers.length === 0) {
          alert('Keine Helfer in der Datei gefunden.');
          return;
        }

        await onImportHelpers(parsedHelpers, helperImportMode);
        alert(`✅ Erfolgreich ${parsedHelpers.length} Helfer aus Excel importiert!`);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(`Import fehlgeschlagen: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

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
          width: 720,
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
                background: 'linear-gradient(135deg, #10B981, #059669)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                boxShadow: '0 0 14px rgba(16, 185, 129, 0.4)'
              }}
            >
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                Excel (.xlsx) Import & Synchronisation
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Importiert Einsatzpläne, Helferzuweisungen oder Helferlisten direkt aus Excel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* MODAL BODY */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {/* File Picker / Drop Area if no file */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--accent-gold)',
                borderRadius: 'var(--radius-md)',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(245, 158, 11, 0.05)',
                transition: 'all 0.2s ease'
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx, .xls"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
              <Upload size={38} color="var(--accent-gold)" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                Excel-Datei (.xlsx / .xls) hierher ziehen oder anklicken
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Unterstützt vollständige Einsatzpläne sowie einfache Helferlisten
              </div>
            </div>
          ) : (
            <div>
              {/* File Info Bar & Sheet Switcher */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: 16
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileSpreadsheet size={16} color="#10B981" />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>{file.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({Math.round(file.size / 1024)} KB)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {availableSheets.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tabellenblatt:</span>
                      <select
                        value={activeSheetName}
                        onChange={e => setActiveSheetName(e.target.value)}
                        style={{
                          background: 'var(--bg-input)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 12
                        }}
                      >
                        {availableSheets.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={() => setFile(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#EF4444',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Anderes Dokument wählen
                  </button>
                </div>
              </div>

              {/* Error Alert */}
              {errorMessage && (
                <div
                  style={{
                    background: '#FEE2E2',
                    border: '1px solid #FECACA',
                    color: '#991B1B',
                    padding: '10px 14px',
                    borderRadius: 6,
                    fontSize: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* DETECTED MODE: SCHEDULE IMPORT */}
              {detectedType === 'schedule' && (
                <div>
                  {/* Summary badges */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Erkannte Abschnitte</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-gold)' }}>
                        {matchedSectionsCount} / {sectionMatches.length}
                      </div>
                      <div style={{ fontSize: 10, color: '#10B981' }}>in der Karte zuordenbar</div>
                    </div>

                    <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Helfer-Zuweisungen</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#10B981' }}>
                        {assignmentsCount}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>werden aktualisiert</div>
                    </div>

                    <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Neue Helfer in Excel</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: uniqueNewHelpers.length > 0 ? '#38BDF8' : 'var(--text-muted)' }}>
                        +{uniqueNewHelpers.length}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>werden automatisch angelegt</div>
                    </div>
                  </div>

                  {/* Options Checkboxes */}
                  <div style={{ background: 'var(--bg-card)', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
                      Import-Optionen:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-main)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={applyAssignments}
                          onChange={e => setApplyAssignments(e.target.checked)}
                          style={{ accentColor: 'var(--accent-gold)' }}
                        />
                        <span><b>Helfer-Zuweisungen übernehmen:</b> Aktualisiert, welcher Helfer welchem Straßenstück zugeteilt ist</span>
                      </label>

                      {uniqueNewHelpers.length > 0 && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-main)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={createMissingHelpers}
                            onChange={e => setCreateMissingHelpers(e.target.checked)}
                            style={{ accentColor: 'var(--accent-gold)' }}
                          />
                          <span><b>Fehlende Helfer anlegen ({uniqueNewHelpers.length} Personen):</b> Fügt Helfer, die in Excel stehen aber noch nicht existieren, automatisch hinzu</span>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                      Vorschau der Änderungen ({sectionMatches.length} Zeilen):
                    </div>
                    <div
                      style={{
                        maxHeight: 220,
                        overflowY: 'auto',
                        background: 'var(--bg-input)',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        fontSize: 11
                      }}
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                            <th style={{ padding: '6px 10px' }}>Abschnitt in Excel</th>
                            <th style={{ padding: '6px 10px' }}>Straße</th>
                            <th style={{ padding: '6px 10px' }}>Helfer in Excel</th>
                            <th style={{ padding: '6px 10px' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sectionMatches.map((m, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '5px 10px', fontWeight: 600, color: m.matchedSection ? 'var(--text-main)' : '#DC2626' }}>
                                {m.label}
                                {!m.matchedSection && <span style={{ fontSize: 9, color: '#DC2626', marginLeft: 4 }}>(nicht gefunden)</span>}
                              </td>
                              <td style={{ padding: '5px 10px', color: 'var(--text-muted)' }}>{m.streetName || '—'}</td>
                              <td style={{ padding: '5px 10px' }}>
                                {m.excelHelperName ? (
                                  <span style={{ fontWeight: 700, color: m.matchedHelper ? '#10B981' : '#38BDF8' }}>
                                    {m.excelHelperName}
                                    {m.isNewHelper && <span style={{ fontSize: 9, marginLeft: 4, background: 'rgba(56, 189, 248, 0.2)', padding: '1px 4px', borderRadius: 3 }}>Neu</span>}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Frei / Unbesetzt</span>
                                )}
                              </td>
                              <td style={{ padding: '5px 10px' }}>
                                {m.matchedSection ? (
                                  <span style={{ color: '#10B981', fontWeight: 600 }}>✓ Wird zugewiesen</span>
                                ) : (
                                  <span style={{ color: '#94A3B8' }}>Übersprungen</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* DETECTED MODE: PURE HELPERS IMPORT */}
              {detectedType === 'helpers' && (
                <div>
                  <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)', padding: '12px 14px', borderRadius: 6, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#10B981', marginBottom: 2 }}>
                      📋 Helferliste erkannt: {parsedHelpers.length} Personen gefunden
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Die Excel-Datei enthält eine reine Namensliste zur Helferverwaltung.
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 6 }}>
                      Import-Modus:
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-main)' }}>
                        <input
                          type="radio"
                          name="helperMode"
                          checked={helperImportMode === 'append'}
                          onChange={() => setHelperImportMode('append')}
                        />
                        <span>Zu bestehenden Helfern hinzufügen ({helpers.length} vorhanden)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-main)' }}>
                        <input
                          type="radio"
                          name="helperMode"
                          checked={helperImportMode === 'replace'}
                          onChange={() => setHelperImportMode('replace')}
                        />
                        <span>Bestehende Helferliste komplett ersetzen</span>
                      </label>
                    </div>
                  </div>

                  {/* Helpers preview list */}
                  <div
                    style={{
                      maxHeight: 200,
                      overflowY: 'auto',
                      background: 'var(--bg-input)',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      padding: '8px 12px',
                      fontSize: 11
                    }}
                  >
                    {parsedHelpers.map((h, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: idx < parsedHelpers.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                        <span><b>{h.name}</b></span>
                        <span style={{ color: 'var(--text-muted)' }}>{h.phone || 'Keine Telefonnummer'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
            disabled={isProcessing}
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
            onClick={handleExecuteImport}
            disabled={!file || isProcessing || (detectedType === 'schedule' && matchedSectionsCount === 0 && uniqueNewHelpers.length === 0)}
            style={{
              padding: '9px 20px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: !file ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #10B981, #059669)',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 800,
              cursor: !file || isProcessing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: file ? '0 0 16px rgba(16, 185, 129, 0.4)' : 'none',
              opacity: isProcessing ? 0.7 : 1
            }}
          >
            <Sparkles size={16} />
            {isProcessing ? 'Wird importiert...' : '⚡ Excel-Daten jetzt anwenden'}
          </button>
        </div>
      </div>
    </div>
  );
};
