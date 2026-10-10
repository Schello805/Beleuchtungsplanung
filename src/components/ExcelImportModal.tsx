import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  FileSpreadsheet,
  Upload,
  Check,
  AlertCircle,
  ArrowRight,
  UserPlus,
  Users,
  Sparkles,
  ClipboardList,
  FileText,
  Trash2,
  HelpCircle,
  RefreshCw
} from 'lucide-react';
import type { Section, Helper } from '../utils/api';
import { parsePastedHelperText, parseSheetHelpers } from '../utils/helperImportParser';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFile?: File | null;
  initialTab?: 'helpers' | 'schedule';
  initialInputMethod?: 'file' | 'paste';
  sections: Section[];
  helpers: Helper[];
  onApplyAssignments: (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => Promise<void>;
  onImportHelpers: (helpers: Array<{ name: string; phone?: string; color?: string }>, mode: 'replace' | 'append') => Promise<void>;
  onRefreshData?: () => Promise<void>;
  onDeleteAllHelpers?: () => Promise<void>;
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
  initialTab = 'helpers',
  initialInputMethod = 'file',
  sections,
  helpers,
  onApplyAssignments,
  onImportHelpers,
  onRefreshData,
  onDeleteAllHelpers
}) => {
  // Main Tab: 'helpers' (nur Namen überschreiben/importieren) vs 'schedule' (ganzen Plan mit Abschnitten abgleichen)
  const [activeMainTab, setActiveMainTab] = useState<'helpers' | 'schedule'>(initialTab);

  // Helper Input Mode: 'paste' (Namen per Textfeld) vs 'file' (Excel / CSV Datei)
  const [helperInputMethod, setHelperInputMethod] = useState<'file' | 'paste'>(initialInputMethod);
  const [pastedHelperText, setPastedHelperText] = useState<string>('');

  // File state
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  // Helper import mode: DEFAULT IS 'replace' so user can overwrite placeholders!
  const [helperImportMode, setHelperImportMode] = useState<'replace' | 'append'>('replace');

  // Schedule import options
  const [sectionMatches, setSectionMatches] = useState<ParsedSectionMatch[]>([]);
  const [applyAssignments, setApplyAssignments] = useState<boolean>(true);
  const [createMissingHelpers, setCreateMissingHelpers] = useState<boolean>(true);
  const [wipeHelpersBeforeSchedule, setWipeHelpersBeforeSchedule] = useState<boolean>(false);

  // Pure helpers list from file
  const [fileHelpers, setFileHelpers] = useState<Array<{ name: string; phone: string }>>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Sync initial props when opened
  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveMainTab(initialTab);
      if (initialInputMethod) setHelperInputMethod(initialInputMethod);
      if (initialFile) setFile(initialFile);
      setErrorMessage(null);
    }
  }, [isOpen, initialTab, initialInputMethod, initialFile]);

  // Read workbook whenever file changes
  useEffect(() => {
    if (!file) {
      setWorkbook(null);
      setAvailableSheets([]);
      setActiveSheetName('');
      setSectionMatches([]);
      setFileHelpers([]);
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

        // Pick initial sheet based on active tab
        let preferredSheet = wb.SheetNames[0];
        if (activeMainTab === 'helpers') {
          // Look for helper sheet first
          const hSheet = wb.SheetNames.find(s => {
            const lower = s.toLowerCase();
            return lower.includes('helfer') || lower.includes('ausgabe') || lower.includes('material') || lower.includes('person') || lower.includes('teilnehmer');
          });
          if (hSheet) preferredSheet = hSheet;
        } else {
          // Look for schedule sheet first
          const sSheet = wb.SheetNames.find(s => {
            const lower = s.toLowerCase();
            return lower.includes('strecke') || lower.includes('plan') || lower.includes('abschnitt');
          });
          if (sSheet) preferredSheet = sSheet;
        }

        setActiveSheetName(preferredSheet || '');
      } catch (err: any) {
        setErrorMessage(`Excel-Datei konnte nicht gelesen werden: ${err.message}`);
      }
    };

    readFile();
  }, [file, activeMainTab]);

  // Parse active sheet whenever workbook or active sheet changes
  useEffect(() => {
    if (!workbook || !activeSheetName) return;

    try {
      const sheet = workbook.Sheets[activeSheetName];
      if (!sheet) return;

      const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      if (rawRows.length === 0) {
        setErrorMessage(`Das Tabellenblatt "${activeSheetName}" ist leer.`);
        setFileHelpers([]);
        setSectionMatches([]);
        return;
      }

      // Always parse pure helpers from sheet
      const parsedH = parseSheetHelpers(rawRows);
      setFileHelpers(parsedH);

      // Also parse schedule matches
      let headerRowIdx = -1;
      let labelCol = -1;
      let streetCol = -1;
      let helperCol = -1;
      let phoneCol = -1;
      let notesCol = -1;

      for (let r = 0; r < Math.min(6, rawRows.length); r++) {
        const row = (rawRows[r] || []).map(c => String(c).trim().toLowerCase());

        row.forEach((cell, idx) => {
          if (cell.includes('bezeichnung') || cell === 'abschnitt' || cell.includes('abschnitts-name') || cell === 'nr.' || cell === 'nr') labelCol = idx;
          if (cell.includes('straße') || cell.includes('strasse') || cell === 'street') streetCol = idx;
          if (cell.includes('helfer') || cell.includes('zugewiesen') || cell.includes('zuständig')) helperCol = idx;
          if (cell.includes('telefon') || cell.includes('phone') || cell.includes('mobil') || cell.includes('handy')) phoneCol = idx;
          if (cell.includes('notiz') || cell.includes('bemerkung') || cell.includes('besonderheit')) notesCol = idx;
        });

        if (labelCol !== -1 || (streetCol !== -1 && helperCol !== -1)) {
          headerRowIdx = r;
          break;
        }
      }

      const matches: ParsedSectionMatch[] = [];
      const startR = headerRowIdx !== -1 ? headerRowIdx + 1 : 1;

      for (let r = startR; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const label = labelCol !== -1 ? String(row[labelCol] || '').trim() : '';
        const street = streetCol !== -1 ? String(row[streetCol] || '').trim() : '';
        const helperRaw = helperCol !== -1 ? String(row[helperCol] || '').trim() : '';
        const phone = phoneCol !== -1 ? String(row[phoneCol] || '').trim() : '';
        const notes = notesCol !== -1 ? String(row[notesCol] || '').trim() : '';

        if (!label && !street) continue;

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

        // Match section
        let matched: Section | null = null;
        if (label && street) {
          matched = sections.find(s =>
            s.label.toLowerCase() === label.toLowerCase() &&
            s.street_name.toLowerCase().includes(street.toLowerCase())
          ) || null;
        }
        if (!matched && label) {
          matched = sections.find(s => s.label.toLowerCase() === label.toLowerCase()) || null;
        }
        if (!matched && street) {
          matched = sections.find(s => s.street_name.toLowerCase() === street.toLowerCase()) || null;
        }

        const matchedH = helperName
          ? helpers.find(h => h.name.toLowerCase() === helperName.toLowerCase()) || null
          : null;

        matches.push({
          rowIdx: r,
          label: label || `Zeile ${r + 1}`,
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
    } catch (err: any) {
      setErrorMessage(`Fehler beim Analysieren des Tabellenblatts: ${err.message}`);
    }
  }, [workbook, activeSheetName, sections, helpers]);

  // Helpers parsed from pasted text
  const pastedHelpers = useMemo(() => {
    return parsePastedHelperText(pastedHelperText);
  }, [pastedHelperText]);

  // The active list of helpers to import
  const currentHelpersToImport = useMemo(() => {
    if (helperInputMethod === 'paste') {
      return pastedHelpers;
    }
    return fileHelpers;
  }, [helperInputMethod, pastedHelpers, fileHelpers]);

  // Unique new helpers to create from schedule
  const uniqueScheduleHelpers = useMemo(() => {
    const map = new Map<string, string>();
    sectionMatches.forEach(m => {
      if (m.excelHelperName) {
        if (!map.has(m.excelHelperName)) {
          map.set(m.excelHelperName, m.excelHelperPhone);
        }
      }
    });
    return Array.from(map.entries()).map(([name, phone]) => ({ name, phone }));
  }, [sectionMatches]);

  const matchedSectionsCount = sectionMatches.filter(m => !!m.matchedSection).length;
  const assignmentsCount = sectionMatches.filter(m => !!m.matchedSection && !!m.excelHelperName).length;

  // Execute Helper Import
  const handleExecuteHelperImport = async () => {
    if (currentHelpersToImport.length === 0) {
      alert('Es wurden noch keine Helfernamen gefunden. Bitte gib Namen ein oder wähle eine Datei aus.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      await onImportHelpers(currentHelpersToImport, helperImportMode);
      if (onRefreshData) {
        await onRefreshData();
      }

      const modeText = helperImportMode === 'replace'
        ? `Die alte Helferliste wurde komplett überschrieben.`
        : `Die Helfer wurden hinzugefügt.`;

      alert(`✅ Erfolgreich ${currentHelpersToImport.length} Helfer importiert!\n\n${modeText}`);
      onClose();
    } catch (err: any) {
      setErrorMessage(`Import fehlgeschlagen: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Execute Schedule Import
  const handleExecuteScheduleImport = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // 1. Wipe existing helpers if option chosen
      if (wipeHelpersBeforeSchedule && onDeleteAllHelpers) {
        await onDeleteAllHelpers();
      }

      // 2. Create missing helpers if enabled
      if (createMissingHelpers && uniqueScheduleHelpers.length > 0) {
        await onImportHelpers(uniqueScheduleHelpers, 'append');
      }

      // 3. Refresh helpers
      if (onRefreshData) {
        await onRefreshData();
      }

      // 4. Apply assignments
      if (applyAssignments) {
        const assignments: Array<{ sectionId: string; helperId: string; helperName: string }> = [];

        sectionMatches.forEach(m => {
          if (!m.matchedSection) return;

          if (m.excelHelperName) {
            const existing = helpers.find(h => h.name.toLowerCase() === m.excelHelperName.toLowerCase());
            const helperId = existing ? existing.id : `h-gen-${m.excelHelperName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

            assignments.push({
              sectionId: m.matchedSection.id,
              helperId,
              helperName: m.excelHelperName
            });
          } else {
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

      alert(`✅ Einsatzplan-Import erfolgreich!\n• ${matchedSectionsCount} Abschnitte abgeglichen\n• ${assignmentsCount} Zuweisungen aktualisiert`);
      onClose();
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
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: 740,
          maxWidth: '100%',
          maxHeight: '92vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
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
              <Users size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                Helferliste importieren & überschreiben
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Ersetze Platzhalter ('Helfer 01' etc.) durch deine echten Namen – per Excel, CSV oder Copy & Paste
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
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

        {/* MAIN TABS: HELPERS VS SCHEDULE */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.15)' }}>
          <button
            type="button"
            onClick={() => setActiveMainTab('helpers')}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: activeMainTab === 'helpers' ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              borderBottom: activeMainTab === 'helpers' ? '2.5px solid #10B981' : '2.5px solid transparent',
              color: activeMainTab === 'helpers' ? '#10B981' : 'var(--text-muted)',
              fontWeight: 800,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <Users size={16} />
            👥 Helferliste importieren / überschreiben
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('schedule')}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: activeMainTab === 'schedule' ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              borderBottom: activeMainTab === 'schedule' ? '2.5px solid var(--accent-gold)' : '2.5px solid transparent',
              color: activeMainTab === 'schedule' ? 'var(--accent-gold)' : 'var(--text-muted)',
              fontWeight: 800,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <FileSpreadsheet size={16} />
            🗺️ Gesamten Einsatzplan abgleichen (Abschnitte & Zuweisungen)
          </button>
        </div>

        {/* MODAL BODY */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {errorMessage && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 6,
                padding: '10px 14px',
                marginBottom: 16,
                color: '#EF4444',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 1: PURE HELPERS IMPORT (DIE HELFERLISTE ÜBERSCHREIBEN) */}
          {/* ============================================================ */}
          {activeMainTab === 'helpers' && (
            <div>
              {/* Input Method Toggle: File vs Copy & Paste */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setHelperInputMethod('file')}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: helperInputMethod === 'file' ? '1.5px solid #10B981' : '1px solid var(--border-subtle)',
                    background: helperInputMethod === 'file' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card)',
                    color: helperInputMethod === 'file' ? '#10B981' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: 'pointer'
                  }}
                >
                  <FileSpreadsheet size={15} />
                  📁 Excel- oder CSV-Datei hochladen (.xlsx, .csv)
                </button>

                <button
                  type="button"
                  onClick={() => setHelperInputMethod('paste')}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: helperInputMethod === 'paste' ? '1.5px solid #10B981' : '1px solid var(--border-subtle)',
                    background: helperInputMethod === 'paste' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card)',
                    color: helperInputMethod === 'paste' ? '#10B981' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: 'pointer'
                  }}
                >
                  <ClipboardList size={15} />
                  📋 Namen direkt einfügen (Copy & Paste)
                </button>
              </div>

              {/* METHOD A: FILE UPLOAD */}
              {helperInputMethod === 'file' && (
                <div style={{ marginBottom: 18 }}>
                  {!file ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: '2px dashed #10B981',
                        borderRadius: 'var(--radius-md)',
                        padding: '30px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: 'rgba(16, 185, 129, 0.05)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".xlsx, .xls, .csv"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) setFile(f);
                        }}
                      />
                      <Upload size={34} color="#10B981" style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                        Excel- oder CSV-Datei hier ablegen oder anklicken
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Unterstützt .xlsx, .xls, .csv (Spalten "Name", "Vorname + Nachname" oder reine Namenslisten)
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        marginBottom: 12
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
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-main)',
                                fontSize: 12,
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontWeight: 600
                              }}
                            >
                              {availableSheets.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setFile(null);
                            setFileHelpers([]);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            fontSize: 11,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            marginLeft: 6
                          }}
                        >
                          Andere Datei wählen
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* METHOD B: DIRECT TEXT COPY & PASTE */}
              {helperInputMethod === 'paste' && (
                <div style={{ marginBottom: 18 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 6 }}>
                    Namen hier einfügen (eine Person pro Zeile):
                  </label>
                  <textarea
                    rows={7}
                    value={pastedHelperText}
                    onChange={e => setPastedHelperText(e.target.value)}
                    placeholder={`Beispiel:\nAnna Schmidt\nMichael Weber, 0171 1234567\nThomas Müller (09822 1234)\nLisa Meier\nStefan Bauer...`}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-main)',
                      fontSize: 13,
                      fontFamily: 'monospace',
                      lineHeight: 1.5,
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>💡 Tipp: Du kannst einfach eine Liste aus WhatsApp, einer E-Mail oder Word hier reinkopieren.</span>
                    {pastedHelperText && (
                      <button
                        type="button"
                        onClick={() => setPastedHelperText('')}
                        style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}
                      >
                        Feld leeren
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* RECOGNITION STATUS & IMPORT MODE */}
              <div
                style={{
                  background: currentHelpersToImport.length > 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-card)',
                  border: currentHelpersToImport.length > 0 ? '1.5px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-subtle)',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 16
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: currentHelpersToImport.length > 0 ? '#10B981' : 'var(--text-main)' }}>
                    {currentHelpersToImport.length > 0 ? (
                      `✓ ${currentHelpersToImport.length} Helfer erkannt`
                    ) : (
                      'Warte auf Eingabe oder Datei...'
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Aktuell im System: <strong style={{ color: 'var(--accent-gold)' }}>{helpers.length} Helfer</strong>
                  </div>
                </div>

                {/* Import Mode Radio: Replace (DEFAULT) vs Append */}
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: helperImportMode === 'replace' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(0,0,0,0.1)',
                      border: helperImportMode === 'replace' ? '1.5px solid #10B981' : '1px solid transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="helperImportMode"
                      checked={helperImportMode === 'replace'}
                      onChange={() => setHelperImportMode('replace')}
                      style={{ accentColor: '#10B981', marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981' }}>
                        Bestehende Helferliste komplett überschreiben (Empfohlen)
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                        Löscht alle bisherigen <strong>{helpers.length} Platzhalter ('Helfer 01' bis ...)</strong> und trägt deine <strong>{currentHelpersToImport.length} neuen Helfer</strong> ein. Zuweisungen werden zurückgesetzt.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: helperImportMode === 'append' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(0,0,0,0.1)',
                      border: helperImportMode === 'append' ? '1.5px solid #38BDF8' : '1px solid transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="helperImportMode"
                      checked={helperImportMode === 'append'}
                      onChange={() => setHelperImportMode('append')}
                      style={{ accentColor: '#38BDF8', marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
                        Zu bestehenden Helfern hinzufügen (Anhängen)
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                        Behält die {helpers.length} vorhandenen Helfer bei und fügt die {currentHelpersToImport.length} neuen Personen hinzu.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* LIVE PREVIEW OF PARSED HELPERS */}
              {currentHelpersToImport.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                    Vorschau der zu übernehmenden Helfer ({currentHelpersToImport.length} Personen):
                  </div>
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      background: 'var(--bg-input)',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      padding: '8px 12px',
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                      {currentHelpersToImport.map((h, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 8px',
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: 4,
                            border: '1px solid rgba(255,255,255,0.05)'
                          }}
                        >
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                            <span style={{ color: '#10B981', marginRight: 6 }}>{idx + 1}.</span>
                            {h.name}
                          </span>
                          {h.phone && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                              {h.phone}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: SCHEDULE IMPORT (EINSATZPLAN MIT ABSCHNITTEN ABGLEICHEN) */}
          {/* ============================================================ */}
          {activeMainTab === 'schedule' && (
            <div>
              {!file ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--accent-gold)',
                    borderRadius: 'var(--radius-md)',
                    padding: '30px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(245, 158, 11, 0.05)',
                    transition: 'all 0.2s ease',
                    marginBottom: 16
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".xlsx, .xls, .csv"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) setFile(f);
                    }}
                  />
                  <Upload size={34} color="var(--accent-gold)" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                    Einsatzplan-Exceldatei hier ablegen oder anklicken
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Tabelle mit Spalten für Abschnitt, Straße und Helfer
                  </div>
                </div>
              ) : (
                <div>
                  {/* File & Sheet bar */}
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
                      <FileSpreadsheet size={16} color="var(--accent-gold)" />
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>{file.name}</span>
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
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-main)',
                              fontSize: 12,
                              padding: '4px 8px',
                              borderRadius: 4
                            }}
                          >
                            {availableSheets.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

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
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>werden übernommen</div>
                    </div>

                    <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Helfer in Tabelle</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#38BDF8' }}>
                        {uniqueScheduleHelpers.length}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>verschiedene Personen</div>
                    </div>
                  </div>

                  {/* Options */}
                  <div style={{ background: 'var(--bg-card)', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
                      Optionen für den Einsatzplan-Import:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-main)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={applyAssignments}
                          onChange={e => setApplyAssignments(e.target.checked)}
                          style={{ accentColor: 'var(--accent-gold)' }}
                        />
                        <span><b>Zuweisungen auf die Abschnitte anwenden:</b> Trägt die Helfer auf der Karte ein</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-main)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={createMissingHelpers}
                          onChange={e => setCreateMissingHelpers(e.target.checked)}
                          style={{ accentColor: 'var(--accent-gold)' }}
                        />
                        <span><b>Helfer aus der Tabelle im System anlegen ({uniqueScheduleHelpers.length} Personen)</b></span>
                      </label>

                      {onDeleteAllHelpers && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#EF4444', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={wipeHelpersBeforeSchedule}
                            onChange={e => setWipeHelpersBeforeSchedule(e.target.checked)}
                            style={{ accentColor: '#EF4444' }}
                          />
                          <span><b>Bestehende {helpers.length} Helfer vorher komplett leeren</b> (überschreibt alte Platzhalter 'Helfer 01' etc.)</span>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Table preview */}
                  <div
                    style={{
                      maxHeight: 180,
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
                          <th style={{ padding: '6px 10px' }}>Abschnitt</th>
                          <th style={{ padding: '6px 10px' }}>Straße</th>
                          <th style={{ padding: '6px 10px' }}>Helfer</th>
                          <th style={{ padding: '6px 10px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionMatches.map((m, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '5px 10px', fontWeight: 600, color: m.matchedSection ? 'var(--text-main)' : '#EF4444' }}>
                              {m.label}
                            </td>
                            <td style={{ padding: '5px 10px', color: 'var(--text-muted)' }}>{m.streetName || '—'}</td>
                            <td style={{ padding: '5px 10px', fontWeight: 600, color: m.excelHelperName ? '#10B981' : 'var(--text-muted)' }}>
                              {m.excelHelperName || 'Frei'}
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

          {activeMainTab === 'helpers' ? (
            <button
              type="button"
              onClick={handleExecuteHelperImport}
              disabled={isProcessing || currentHelpersToImport.length === 0}
              style={{
                padding: '9px 22px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: currentHelpersToImport.length === 0
                  ? 'var(--bg-secondary)'
                  : 'linear-gradient(135deg, #10B981, #059669)',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 800,
                cursor: currentHelpersToImport.length === 0 || isProcessing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: currentHelpersToImport.length > 0 ? '0 0 16px rgba(16, 185, 129, 0.4)' : 'none',
                opacity: isProcessing ? 0.7 : 1
              }}
            >
              <Sparkles size={16} />
              {isProcessing
                ? 'Wird importiert...'
                : helperImportMode === 'replace'
                ? `⚡ Helferliste jetzt überschreiben (${currentHelpersToImport.length} Personen)`
                : `⚡ ${currentHelpersToImport.length} Helfer jetzt hinzufügen`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleExecuteScheduleImport}
              disabled={!file || isProcessing || (matchedSectionsCount === 0 && uniqueScheduleHelpers.length === 0)}
              style={{
                padding: '9px 22px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: !file ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 800,
                cursor: !file || isProcessing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: file ? '0 0 16px rgba(245, 158, 11, 0.4)' : 'none',
                opacity: isProcessing ? 0.7 : 1
              }}
            >
              <Sparkles size={16} />
              {isProcessing ? 'Wird angewendet...' : '⚡ Einsatzplan jetzt anwenden'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
