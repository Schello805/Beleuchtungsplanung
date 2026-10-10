import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { MapComponent } from './components/MapComponent';
import { CapturePanel } from './components/CapturePanel';
import { PrintView } from './components/PrintView';
import { api, type Section, type Helper, type Street } from './utils/api';
import type { GeneratedSection } from './utils/geo';
import { Layers } from 'lucide-react';

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

  // Theme & Map Layer
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mapTileTheme, setMapTileTheme] = useState<string>('dark');
  const [mapboxToken, setMapboxToken] = useState<string>(() => localStorage.getItem('ln_mapbox_token') || '');
  const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);

  const handleSaveMapboxToken = (token: string) => {
    setMapboxToken(token);
    localStorage.setItem('ln_mapbox_token', token);
  };

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Align default map layer with theme
    if (theme === 'dark') {
      setMapTileTheme('dark');
    } else {
      setMapTileTheme('light');
    }
  }, [theme]);

  // Load Initial Data
  const loadData = useCallback(async () => {
    try {
      const [h, s, sec] = await Promise.all([
        api.getHelpers(),
        api.getStreets(),
        api.getSections()
      ]);
      setHelpers(h);
      setStreets(s);
      setSections(sec);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
  };

  // Save Preview to Database
  const handleSavePreview = async () => {
    if (!currentStreetInfo || previewSections.length === 0) return;
    setIsSaving(true);

    try {
      const streetId = `st-${Date.now()}`;
      const streetRecord = {
        id: streetId,
        name: currentStreetInfo.name,
        method: currentStreetInfo.method,
        chunk_length: currentStreetInfo.chunkLength,
        min_length: currentStreetInfo.minLength,
        total_length: currentStreetInfo.totalLength
      };

      const sectionRecords = previewSections.map(sec => ({
        id: sec.id,
        street_id: streetId,
        street_name: currentStreetInfo.name,
        section_index: sec.sectionIndex,
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
        onOpenPrintView={() => setIsPrintOpen(true)}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onResetDatabase={handleResetDatabase}
        onBatchAssign={handleBatchAssign}
        theme={theme}
        onToggleTheme={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
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
            onSavePreview={handleSavePreview}
            isSaving={isSaving}
            captureMode={captureMode}
            setCaptureMode={setCaptureMode}
            segmentPoints={segmentPoints}
            setSegmentPoints={setSegmentPoints}
          />
        </div>

        {/* Interactive Map */}
        <MapComponent
          sections={sections}
          previewSections={previewSections}
          helpers={helpers}
          selectedSectionId={selectedSectionId}
          onSelectSection={setSelectedSectionId}
          onUpdateSectionHelper={handleUpdateSectionHelper}
          onDeleteSection={handleDeleteSection}
          captureMode={captureMode}
          segmentPoints={segmentPoints}
          onMapClick={handleMapClick}
          mapTileTheme={mapTileTheme}
          onMapTileThemeChange={setMapTileTheme}
          mapboxToken={mapboxToken}
          onSaveMapboxToken={handleSaveMapboxToken}
        />
      </main>

      {/* PRINT VIEW MODAL OVERLAY */}
      {isPrintOpen && (
        <PrintView
          sections={sections}
          helpers={helpers}
          onClose={() => setIsPrintOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
