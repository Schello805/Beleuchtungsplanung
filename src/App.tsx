import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { MapComponent } from './components/MapComponent';
import { CapturePanel } from './components/CapturePanel';
import { PrintView } from './components/PrintView';
import { RedistributeModal } from './components/RedistributeModal';
import { api, type Section, type Helper, type Street } from './utils/api';
import { splitSectionInHalf, type GeneratedSection } from './utils/geo';
import { Database, Wifi, Check, Copy, AlertCircle, X } from 'lucide-react';

export const App: React.FC = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [streets, setStreets] = useState<Street[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  // Preview & Capture state
  const [previewSections, setPreviewSections] = useState<GeneratedSection[]>([]);
  const [currentStreetInfo, setCurrentStreetInfo] = useState<{
    name: string;
    method: string;
    chunkLength: number;
    minLength: number;
    totalLength: number;
  } | null>(null);

  const [captureMode, setCaptureMode] = useState<'none' | 'segment' | 'point'>('none');
  const [segmentPoints, setSegmentPoints] = useState<[number, number][]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [focusedPreviewId, setFocusedPreviewId] = useState<string | null>(null);

  // Theme & Map Layer (Synced directly with SQLite DB)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mapTileTheme, setMapTileTheme] = useState<string>('dark');
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);
  const [isRedistributeOpen, setIsRedistributeOpen] = useState<boolean>(false);

  // Candle & Material Planning state
  const [candleSpacing, setCandleSpacing] = useState<number>(2.0);
  const [candleBuffer, setCandleBuffer] = useState<number>(10);

  const handleUpdateCandleConfig = async (spacing: number, buffer: number) => {
    setCandleSpacing(spacing);
    setCandleBuffer(buffer);
    await api.setSetting('candle_spacing', String(spacing));
    await api.setSetting('candle_buffer', String(buffer));
  };

  const handleSaveMapboxToken = async (token: string) => {
    setMapboxToken(token);
    await api.setSetting('mapbox_token', token);
  };

  const handleMapTileThemeChange = async (newTileTheme: string) => {
    setMapTileTheme(newTileTheme);
    await api.setSetting('map_tile_theme', newTileTheme);
  };

  const handleToggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    await api.setSetting('theme', nextTheme);
  };

  // Database status & multi-PC network access
  const [dbStatus, setDbStatus] = useState<{
    online: boolean;
    networkIps: string[];
    helpersCount: number;
    streetsCount: number;
    sectionsCount: number;
  } | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load Initial Data & Settings from SQLite Database
  const loadData = useCallback(async () => {
    try {
      // 1. Check for legacy localStorage data and auto-migrate to SQLite
      const mig = await api.checkAndMigrateLocalStorage();
      if (mig.migrated) {
        setMigrationNotice(`Alte Browser-Daten wurden erfolgreich in die zentrale SQLite-Datenbank übertragen (${mig.importedStreets} Straßen, ${mig.importedSections} Abschnitte)!`);
      }

      // 2. Fetch all data directly from SQLite
      const [h, s, sec, settings, status] = await Promise.all([
        api.getHelpers(),
        api.getStreets(),
        api.getSections(),
        api.getSettings(),
        api.getStatus().catch(() => null)
      ]);

      setHelpers(h);
      setStreets(s);
      setSections(sec);

      if (status) {
        setDbStatus({
          online: true,
          networkIps: (status as any).networkIps || [],
          helpersCount: h.length,
          streetsCount: s.length,
          sectionsCount: sec.length
        });
      } else {
        setDbStatus({
          online: false,
          networkIps: [],
          helpersCount: h.length,
          streetsCount: s.length,
          sectionsCount: sec.length
        });
      }

      if (settings.mapbox_token !== undefined) {
        setMapboxToken(settings.mapbox_token);
      }
      if (settings.map_tile_theme) {
        setMapTileTheme(settings.map_tile_theme);
      }
      if (settings.theme === 'dark' || settings.theme === 'light') {
        setTheme(settings.theme);
      }
      if (settings.candle_spacing) {
        setCandleSpacing(parseFloat(settings.candle_spacing) || 2.0);
      }
      if (settings.candle_buffer) {
        setCandleBuffer(parseInt(settings.candle_buffer, 10) || 10);
      }
    } catch (err) {
      console.error('Failed to load data from database:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Automatic multi-PC synchronization: Poll every 4 seconds and refresh on window focus
  useEffect(() => {
    const handleFocus = () => {
      loadData();
    };
    window.addEventListener('focus', handleFocus);

    const interval = setInterval(() => {
      // Only sync in background when user is not currently clicking/capturing a segment
      if (captureMode === 'none' && previewSections.length === 0) {
        loadData();
      }
    }, 4000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [loadData, captureMode, previewSections.length]);

  // Map Click Handler for interactive capture
  const handleMapClick = (lat: number, lon: number) => {
    if (captureMode === 'segment') {
      if (segmentPoints.length === 0) {
        setSegmentPoints([[lat, lon]]);
      } else if (segmentPoints.length === 1) {
        setSegmentPoints([segmentPoints[0], [lat, lon]]);
      }
    } else if (captureMode === 'point') {
      if (typeof (window as any).__onPointMapClick === 'function') {
        (window as any).__onPointMapClick(lat, lon);
      }
    }
  };

  // Handle Preview Generated
  const handlePreviewGenerated = (
    newSections: GeneratedSection[],
    streetInfo: { name: string; method: string; chunkLength: number; minLength: number; totalLength: number }
  ) => {
    setPreviewSections(newSections);
    setCurrentStreetInfo(streetInfo);
  };

  // Clear Preview
  const handleClearPreview = () => {
    setPreviewSections([]);
    setCurrentStreetInfo(null);
    setSegmentPoints([]);
    setFocusedPreviewId(null);
  };

  // Remove a single section from preview ("raus-xen")
  const handleRemovePreviewSection = (sectionId: string) => {
    setPreviewSections(prev => {
      const remaining = prev.filter(s => s.id !== sectionId);
      if (remaining.length === 0) {
        setCurrentStreetInfo(null);
      }
      return remaining;
    });
    if (focusedPreviewId === sectionId) {
      setFocusedPreviewId(null);
    }
  };

  // Save Preview to Database
  const handleSavePreview = async () => {
    if (!currentStreetInfo || previewSections.length === 0) return;
    setIsSaving(true);

    try {
      if (currentStreetInfo.method === 'batch') {
        // Group previewSections by their streetName
        const streetMap = new Map<string, GeneratedSection[]>();
        previewSections.forEach(sec => {
          const streetName = (sec as any).streetName || currentStreetInfo.name;
          const list = streetMap.get(streetName) || [];
          list.push(sec);
          streetMap.set(streetName, list);
        });

        const batch: Array<{ street: any; sections: any[] }> = [];
        let sIdx = 0;
        for (const [stName, secs] of streetMap.entries()) {
          const streetId = `st-b-${Date.now()}-${sIdx++}`;
          const streetTotal = secs.reduce((sum, s) => sum + (s.lengthMeters || 0), 0);
          const streetRecord = {
            id: streetId,
            name: stName,
            method: 'batch',
            chunk_length: currentStreetInfo.chunkLength,
            min_length: currentStreetInfo.minLength,
            total_length: streetTotal
          };

          const sectionRecords = secs.map((sec, idx) => ({
            id: sec.id,
            street_id: streetId,
            street_name: stName,
            section_index: idx + 1,
            label: sec.label,
            length_meters: sec.lengthMeters,
            color: sec.color,
            type: sec.type,
            geojson: sec.geojson,
            assigned_helper_id: null,
            assigned_helper_name: null,
            notes: null
          }));

          batch.push({ street: streetRecord, sections: sectionRecords });
        }

        await api.saveBatchStreetsWithSections(batch);
      } else {
        const streetId = `st-${Date.now()}`;
        const streetTotal = previewSections.reduce((sum, s) => sum + (s.lengthMeters || 0), 0);
        const streetRecord = {
          id: streetId,
          name: currentStreetInfo.name,
          method: currentStreetInfo.method,
          chunk_length: currentStreetInfo.chunkLength,
          min_length: currentStreetInfo.minLength,
          total_length: streetTotal
        };

        const sectionRecords = previewSections.map((sec, idx) => ({
          id: sec.id,
          street_id: streetId,
          street_name: sec.streetName || currentStreetInfo.name,
          section_index: idx + 1,
          label: sec.label,
          length_meters: sec.lengthMeters,
          color: sec.color,
          type: sec.type,
          geojson: sec.geojson,
          assigned_helper_id: null,
          assigned_helper_name: null,
          notes: null
        }));

        await api.saveStreetWithSections(streetRecord, sectionRecords);
      }

      // Reset capture and preview
      handleClearPreview();
      setCaptureMode('none');

      // Reload fresh data from SQLite
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Speichern: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Update Section Helper Assignment
  const handleUpdateSectionHelper = async (
    sectionId: string,
    helperId: string | null,
    helperName: string | null
  ) => {
    // Optimistic UI update
    setSections(prev =>
      prev.map(s =>
        s.id === sectionId
          ? { ...s, assigned_helper_id: helperId, assigned_helper_name: helperName }
          : s
      )
    );

    try {
      await api.updateSection(sectionId, {
        assigned_helper_id: helperId,
        assigned_helper_name: helperName
      });
    } catch (err) {
      console.error('Update section helper error:', err);
      loadData(); // Revert on error
    }
  };

  // Delete Section
  const handleDeleteSection = async (sectionId: string) => {
    try {
      await api.deleteSection(sectionId);
      setSections(prev => prev.filter(s => s.id !== sectionId));
      if (selectedSectionId === sectionId) setSelectedSectionId(null);
    } catch (err) {
      console.error('Delete section error:', err);
    }
  };

  // Fair Redistribution (Subdivide into N sections)
  const handleApplyRedistribute = async (newSections: Section[]) => {
    try {
      await api.replaceAllSections(newSections);
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Speichern der neuen Aufteilung: ${err.message}`);
    }
  };

  // Split single section in half
  const handleSplitSection = async (sectionId: string) => {
    const target = sections.find(s => s.id === sectionId);
    if (!target) return;
    const parts = splitSectionInHalf(target, sections.length);
    if (!parts) {
      alert('Dieser Abschnitt ist zu kurz zum Teilen (unter 16 m).');
      return;
    }
    const updated = sections.flatMap(s => (s.id === sectionId ? parts : [s]));
    try {
      await api.replaceAllSections(updated);
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Halbieren: ${err.message}`);
    }
  };

  // Helper CRUD
  const handleAddHelper = async (name: string, color?: string, phone?: string) => {
    try {
      const created = await api.addHelper(name, color, phone);
      setHelpers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'de')));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdateHelper = async (id: string, name: string, color?: string, phone?: string) => {
    try {
      await api.updateHelper(id, name, color, phone);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteHelper = async (id: string) => {
    try {
      await api.deleteHelper(id);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImportHelpers = async (helperList: Array<{ name: string; phone?: string; color?: string }>, mode: 'replace' | 'append') => {
    try {
      const count = await api.importHelpers(helperList, mode);
      await loadData();
      alert(`Erfolgreich ${count} Helfer in die zentrale SQLite-Datenbank importiert!`);
    } catch (err: any) {
      alert(`Fehler beim Importieren: ${err.message}`);
    }
  };

  // Backup & Restore
  const handleExportBackup = async () => {
    try {
      const blob = await api.exportDatabase();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lichternacht_bechhofen_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export fehlgeschlagen: ${err.message}`);
    }
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!confirm('Soll dieses Backup wirklich eingespielt werden? Bestehende Daten werden überschrieben.')) {
        return;
      }
      await api.importDatabase(json);
      await loadData();
      alert('Backup erfolgreich wiederhergestellt!');
    } catch (err: any) {
      alert(`Fehler beim Importieren: ${err.message}`);
    }
  };

  const handleResetDatabase = async () => {
    if (confirm('Achtung: Möchtest du wirklich alle erfassten Straßen und Zuweisungen löschen? Die 30 Helfer werden auf Standard zurückgesetzt.')) {
      try {
        await api.resetDatabase();
        handleClearPreview();
        await loadData();
        alert('Datenbank wurde zurückgesetzt.');
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  // Batch Helper Assignment (Auto Fairness or Street Batch)
  const handleBatchAssign = async (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => {
    // Optimistic UI update
    const map = new Map(assignments.map(a => [a.sectionId, a]));
    setSections(prev =>
      prev.map(s => {
        const item = map.get(s.id);
        if (item) {
          return { ...s, assigned_helper_id: item.helperId || null, assigned_helper_name: item.helperName || null };
        }
        return s;
      })
    );

    try {
      await api.batchAssignHelpers(assignments);
    } catch (err) {
      console.error('Batch assign error:', err);
      loadData();
    }
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* SIDEBAR */}
      <Sidebar
        sections={sections}
        helpers={helpers}
        streets={streets}
        selectedSectionId={selectedSectionId}
        onSelectSection={setSelectedSectionId}
        onUpdateSectionHelper={handleUpdateSectionHelper}
        onDeleteSection={handleDeleteSection}
        onAddHelper={handleAddHelper}
        onUpdateHelper={handleUpdateHelper}
        onDeleteHelper={handleDeleteHelper}
        onImportHelpers={handleImportHelpers}
        onOpenPrintView={() => setIsPrintOpen(true)}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onResetDatabase={handleResetDatabase}
        onBatchAssign={handleBatchAssign}
        onOpenRedistributeModal={() => setIsRedistributeOpen(true)}
        onSplitSection={handleSplitSection}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        candleSpacing={candleSpacing}
        candleBuffer={candleBuffer}
        onUpdateCandleConfig={handleUpdateCandleConfig}
      />

      {/* MAP & CAPTURE AREA */}
      <main style={{ flex: 1, position: 'relative', height: '100%' }}>
        {/* Floating Capture Panel */}
        <div
          className="no-print"
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1000,
            width: 380,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto'
          }}
        >
          <CapturePanel
            onPreviewGenerated={handlePreviewGenerated}
            onClearPreview={handleClearPreview}
            previewSections={previewSections}
            onRemovePreviewSection={handleRemovePreviewSection}
            focusedPreviewId={focusedPreviewId}
            onFocusPreviewSection={setFocusedPreviewId}
            onSavePreview={handleSavePreview}
            isSaving={isSaving}
            captureMode={captureMode}
            setCaptureMode={setCaptureMode}
            segmentPoints={segmentPoints}
            setSegmentPoints={setSegmentPoints}
          />
        </div>

        {/* Central Database & Multi-PC Status Badge */}
        <div
          className="no-print"
          style={{
            position: 'absolute',
            top: 16,
            left: 412,
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '6px 12px',
            boxShadow: 'var(--shadow-card)',
            backdropFilter: 'blur(12px)',
            fontSize: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dbStatus?.online !== false ? '#10B981' : '#EF4444',
                boxShadow: dbStatus?.online !== false ? '0 0 8px #10B981' : '0 0 8px #EF4444'
              }}
            />
            <Database size={14} color="var(--accent-gold)" />
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              SQLite Zentral
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              ({sections.length} Abschnitte | {streets.length} Straßen)
            </span>
          </div>

          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 4px' }} />

          {/* Network URL for multi-PC access */}
          {dbStatus?.networkIps && dbStatus.networkIps.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={13} color="#3B82F6" />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Auf anderen PCs:
              </span>
              <code style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, color: '#38BDF8' }}>
                http://{dbStatus.networkIps[0]}:5173
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`http://${dbStatus.networkIps[0]}:5173`);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
                title="Netzwerk-Link kopieren, um ihn auf anderem PC im Browser zu öffnen"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedUrl ? '#10B981' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  padding: '2px 4px'
                }}
              >
                {copiedUrl ? <Check size={12} /> : <Copy size={12} />}
                {copiedUrl ? 'Kopiert!' : 'Kopieren'}
              </button>
            </div>
          )}
        </div>

        {/* Migration notice banner */}
        {migrationNotice && (
          <div
            className="no-print"
            style={{
              position: 'absolute',
              top: 56,
              left: 412,
              zIndex: 950,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#065F46',
              border: '1px solid #10B981',
              color: '#ECFDF5',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
          >
            <Check size={14} color="#10B981" />
            <span>{migrationNotice}</span>
            <button
              onClick={() => setMigrationNotice(null)}
              style={{ background: 'transparent', border: 'none', color: '#ECFDF5', cursor: 'pointer', marginLeft: 8 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Interactive Map */}
        <MapComponent
          sections={sections}
          previewSections={previewSections}
          helpers={helpers}
          selectedSectionId={selectedSectionId}
          onSelectSection={setSelectedSectionId}
          onUpdateSectionHelper={handleUpdateSectionHelper}
          onDeleteSection={handleDeleteSection}
          onRemovePreviewSection={handleRemovePreviewSection}
          focusedPreviewId={focusedPreviewId}
          onFocusPreviewSection={setFocusedPreviewId}
          captureMode={captureMode}
          segmentPoints={segmentPoints}
          onMapClick={handleMapClick}
          mapTileTheme={mapTileTheme}
          onMapTileThemeChange={handleMapTileThemeChange}
          mapboxToken={mapboxToken}
          onSaveMapboxToken={handleSaveMapboxToken}
        />
      </main>

      {/* PRINT VIEW MODAL OVERLAY */}
      {isPrintOpen && (
        <PrintView
          sections={sections}
          helpers={helpers}
          candleSpacing={candleSpacing}
          candleBuffer={candleBuffer}
          onClose={() => setIsPrintOpen(false)}
        />
      )}

      {/* FAIR REDISTRIBUTION MODAL */}
      <RedistributeModal
        isOpen={isRedistributeOpen}
        onClose={() => setIsRedistributeOpen(false)}
        sections={sections}
        helpers={helpers}
        onApply={handleApplyRedistribute}
      />
    </div>
  );
};

export default App;
