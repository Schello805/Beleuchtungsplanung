import React, { useState, useEffect } from 'react';
import { Scissors, MapPin, Search, Check, X, RefreshCw, AlertCircle, Compass } from 'lucide-react';
import { api } from '../utils/api';
import { chunkLineWithFairness, createPointSection, type GeneratedSection } from '../utils/geo';
import * as turf from '@turf/turf';

interface CapturePanelProps {
  onPreviewGenerated: (sections: GeneratedSection[], streetInfo: { name: string; method: string; chunkLength: number; minLength: number; totalLength: number }) => void;
  onClearPreview: () => void;
  previewSections: GeneratedSection[];
  onSavePreview: () => Promise<void>;
  isSaving: boolean;
  captureMode: 'none' | 'segment' | 'point';
  setCaptureMode: (mode: 'none' | 'segment' | 'point') => void;
  segmentPoints: [number, number][];
  setSegmentPoints: (points: [number, number][]) => void;
}

export const CapturePanel: React.FC<CapturePanelProps> = ({
  onPreviewGenerated,
  onClearPreview,
  previewSections,
  onSavePreview,
  isSaving,
  captureMode,
  setCaptureMode,
  segmentPoints,
  setSegmentPoints
}) => {
  const [method, setMethod] = useState<'full_street' | 'segment' | 'point'>('full_street');

  // Parameters
  const [chunkLength, setChunkLength] = useState<number>(100);
  const [minLength, setMinLength] = useState<number>(50);

  // Full street search
  const [streetQuery, setStreetQuery] = useState<string>('');
  const [availableStreets, setAvailableStreets] = useState<string[]>([]);
  const [filteredStreets, setFilteredStreets] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  // Point capture
  const [pointLabel, setPointLabel] = useState<string>('Brunnen');

  // Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fairnessNotice, setFairnessNotice] = useState<string | null>(null);

  // Load Bechhofen streets for autocomplete
  useEffect(() => {
    api.getBechhofenStreets().then(list => {
      setAvailableStreets(list);
    }).catch(err => {
      console.warn('Streets fetch error:', err);
    });
  }, []);

  // Filter street suggestions with ß/ss tolerance
  useEffect(() => {
    if (!streetQuery.trim()) {
      setFilteredStreets([]);
      return;
    }
    const qNorm = streetQuery.toLowerCase().replace(/ß/g, 'ss');
    const matches = availableStreets.filter(s =>
      s.toLowerCase().replace(/ß/g, 'ss').includes(qNorm)
    );
    setFilteredStreets(matches.slice(0, 8));
  }, [streetQuery, availableStreets]);

  // Method switch handler
  const handleMethodChange = (newMethod: 'full_street' | 'segment' | 'point') => {
    setMethod(newMethod);
    setErrorMessage(null);
    setFairnessNotice(null);
    onClearPreview();

    if (newMethod === 'segment') {
      setCaptureMode('segment');
      setSegmentPoints([]);
    } else if (newMethod === 'point') {
      setCaptureMode('point');
      setSegmentPoints([]);
    } else {
      setCaptureMode('none');
      setSegmentPoints([]);
    }
  };

  // Full Street Query Execution
  const handleQueryFullStreet = async (nameToQuery?: string) => {
    const targetName = nameToQuery || streetQuery;
    if (!targetName.trim()) {
      setErrorMessage('Bitte gib einen Straßennamen ein.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setFairnessNotice(null);

    try {
      const data = await api.getStreetGeometry(targetName);
      if (!data.features || data.features.length === 0) {
        throw new Error(`Keine Geometrie für "${targetName}" gefunden.`);
      }

      // Chunk each branch with fairness rule
      let allGenerated: GeneratedSection[] = [];
      let colorOffset = 0;
      let hadFairnessMerge = false;

      data.features.forEach((feat, branchIdx) => {
        const branchLabel = data.features.length > 1 ? `${data.streetName} (Teil ${branchIdx + 1})` : data.streetName;
        const branchSections = chunkLineWithFairness(feat, branchLabel, chunkLength, minLength, colorOffset);
        
        // Check if fairness merge occurred
        const rawLen = Math.round(turf.length(feat, { units: 'kilometers' }) * 1000);
        const remainder = rawLen % chunkLength;
        if (rawLen > chunkLength && remainder > 0 && remainder < minLength) {
          hadFairnessMerge = true;
        }

        allGenerated = [...allGenerated, ...branchSections];
        colorOffset += branchSections.length;
      });

      if (hadFairnessMerge) {
        setFairnessNotice(`Fairness-Regel aktiv: Das letzte Reststück (< ${minLength}m) wurde an den vorletzten Abschnitt angehängt!`);
      }

      const totalLen = allGenerated.reduce((sum, s) => sum + s.lengthMeters, 0);
      onPreviewGenerated(allGenerated, {
        name: data.streetName,
        method: 'full_street',
        chunkLength,
        minLength,
        totalLength: totalLen
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Fehler beim Laden der Straße');
    } finally {
      setIsLoading(false);
    }
  };

  // Process segment routing after 2 points clicked
  useEffect(() => {
    if (method === 'segment' && segmentPoints.length === 2) {
      const runRouting = async () => {
        setIsLoading(true);
        setErrorMessage(null);
        setFairnessNotice(null);

        try {
          const [start, end] = segmentPoints;
          // start: [lat, lon], end: [lat, lon]
          const route = await api.getFootRoute(start[1], start[0], end[1], end[0]);
          const lineFeature = turf.feature(route.geometry) as GeoJSON.Feature<GeoJSON.LineString>;

          const name = streetQuery.trim() || 'Teilstrecke';
          const sections = chunkLineWithFairness(lineFeature, name, chunkLength, minLength);

          const rawLen = route.distanceMeters;
          const remainder = rawLen % chunkLength;
          if (rawLen > chunkLength && remainder > 0 && remainder < minLength) {
            setFairnessNotice(`Fairness-Regel aktiv: Das Reststück (< ${minLength}m) wurde an den vorletzten Abschnitt angehängt.`);
          }

          onPreviewGenerated(sections, {
            name,
            method: 'segment',
            chunkLength,
            minLength,
            totalLength: route.distanceMeters
          });
        } catch (err: any) {
          setErrorMessage(err.message || 'Routing zwischen den Punkten fehlgeschlagen.');
        } finally {
          setIsLoading(false);
        }
      };

      runRouting();
    }
  }, [segmentPoints, method, chunkLength, minLength, streetQuery]);

  // Handle Point click
  const handlePointCreated = (lat: number, lon: number) => {
    const ptFeature = turf.point([lon, lat]);
    const label = pointLabel.trim() || 'Punkt-Station';
    const section = createPointSection(ptFeature, label);

    onPreviewGenerated([section], {
      name: label,
      method: 'point',
      chunkLength: 0,
      minLength: 0,
      totalLength: 0
    });
  };

  // Expose point click to parent
  useEffect(() => {
    (window as any).__onPointMapClick = handlePointCreated;
  }, [pointLabel]);

  const totalPreviewLength = previewSections.reduce((sum, s) => sum + s.lengthMeters, 0);

  return (
    <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
          <Scissors size={18} color="var(--accent-gold)" />
          Strecke erfassen & zerschneiden
        </h3>
      </div>

      {/* Method Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => handleMethodChange('full_street')}
          style={{
            padding: '8px 4px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'full_street' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'full_street' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'full_street' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Ganze Straße
        </button>

        <button
          onClick={() => handleMethodChange('segment')}
          style={{
            padding: '8px 4px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'segment' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'segment' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'segment' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Teilstück (A → B)
        </button>

        <button
          onClick={() => handleMethodChange('point')}
          style={{
            padding: '8px 4px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'point' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'point' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'point' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Einzelpunkt
        </button>
      </div>

      {/* METHOD 1: Ganze Straße */}
      {method === 'full_street' && (
        <div style={{ marginBottom: 14, position: 'relative' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Straßenname in Bechhofen (tolerant für ß / ss):
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                placeholder="z.B. Ansbacher Straße, Marktplatz..."
                value={streetQuery}
                onChange={e => {
                  setStreetQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setShowDropdown(false);
                    handleQueryFullStreet();
                  }
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  fontSize: 13,
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />

              {/* Suggestions Dropdown */}
              {showDropdown && filteredStreets.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    marginTop: 4,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow-lg)',
                    maxHeight: 180,
                    overflowY: 'auto'
                  }}
                >
                  {filteredStreets.map(name => (
                    <div
                      key={name}
                      onClick={() => {
                        setStreetQuery(name);
                        setShowDropdown(false);
                        handleQueryFullStreet(name);
                      }}
                      style={{
                        padding: '7px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                        color: 'var(--text-main)',
                        borderBottom: '1px solid var(--border-subtle)'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setShowDropdown(false);
                handleQueryFullStreet();
              }}
              disabled={isLoading}
              style={{
                background: 'var(--accent-gold)',
                color: '#0F172A',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              {isLoading ? <RefreshCw size={14} className="spin" /> : <Search size={14} />}
              Laden
            </button>
          </div>
        </div>
      )}

      {/* METHOD 2: Teilstück (Interaktiv) */}
      {method === 'segment' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              Bezeichnung des Teilstücks (optional):
            </label>
            <input
              type="text"
              placeholder="z.B. Hauptstraße Südabschnitt"
              value={streetQuery}
              onChange={e => setStreetQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                fontSize: 13,
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
          </div>

          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              fontSize: 12,
              color: 'var(--text-main)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 600, color: '#60A5FA' }}>
              <Compass size={15} />
              Interaktive Punkte auf Karte setzen:
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: segmentPoints.length >= 1 ? '#10B981' : 'var(--text-muted)' }}>
                ● Startpunkt A: {segmentPoints.length >= 1 ? '✓ Gesetzt' : 'Ausstehend'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: segmentPoints.length >= 2 ? '#EF4444' : 'var(--text-muted)' }}>
                ● Zielpunkt B: {segmentPoints.length >= 2 ? '✓ Gesetzt' : 'Ausstehend'}
              </span>
            </div>
            {segmentPoints.length > 0 && (
              <button
                onClick={() => {
                  setSegmentPoints([]);
                  onClearPreview();
                }}
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  cursor: 'pointer'
                }}
              >
                Punkte zurücksetzen
              </button>
            )}
          </div>
        </div>
      )}

      {/* METHOD 3: Einzelpunkt */}
      {method === 'point' && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Bezeichnung des Punktes:
          </label>
          <input
            type="text"
            placeholder="z.B. Brunnen am Marktplatz, Trafostation..."
            value={pointLabel}
            onChange={e => setPointLabel(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-input)',
              fontSize: 13,
              color: 'var(--text-main)',
              outline: 'none',
              marginBottom: 8
            }}
          />
          <div
            style={{
              padding: 8,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              fontSize: 12,
              color: 'var(--text-main)'
            }}
          >
            📍 <b>Klicke auf die Karte</b>, um den Punkt an der gewünschten Stelle zu platzieren. Er wird nicht zerschnitten (0 m).
          </div>
        </div>
      )}

      {/* Fairness & Chunking Controls (for line methods) */}
      {method !== 'point' && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            marginBottom: 12
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Abschnittslänge:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-gold)' }}>{chunkLength} m</span>
          </div>
          <input
            type="range"
            min="30"
            max="300"
            step="10"
            value={chunkLength}
            onChange={e => setChunkLength(parseInt(e.target.value, 10))}
            style={{ width: '100%', accentColor: 'var(--accent-gold)', marginBottom: 10 }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              Fairness: Minimale Restlänge:
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981' }}>{minLength} m</span>
          </div>
          <input
            type="range"
            min="15"
            max="100"
            step="5"
            value={minLength}
            onChange={e => setMinLength(parseInt(e.target.value, 10))}
            style={{ width: '100%', accentColor: '#10B981' }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4 }}>
            Reststücke unter {minLength}m werden automatisch an den vorletzten Abschnitt angehängt.
          </div>
        </div>
      )}

      {/* Fairness Notice Banner */}
      {fairnessNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34D399',
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 12
          }}
        >
          <Check size={14} />
          {fairnessNotice}
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#F87171',
            fontSize: 12,
            marginBottom: 12
          }}
        >
          <AlertCircle size={15} />
          {errorMessage}
        </div>
      )}

      {/* PREVIEW CARD: Visual confirmation before saving */}
      {previewSections.length > 0 && (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid var(--accent-gold)',
            borderRadius: 'var(--radius-sm)',
            padding: 12,
            marginTop: 10
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-gold)' }}>
              Vorschau: {previewSections.length} {previewSections.length === 1 ? 'Abschnitt' : 'Abschnitte'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
              Gesamt: {totalPreviewLength} m
            </span>
          </div>

          {/* List of preview chunks */}
          <div style={{ maxHeight: 130, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {previewSections.map((sec, idx) => (
              <div
                key={sec.id || idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '5px 8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 4,
                  fontSize: 11
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: sec.color }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{sec.label}</span>
                </div>
                <span style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>{sec.lengthMeters} m</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSavePreview}
              disabled={isSaving}
              style={{
                flex: 1,
                background: '#10B981',
                color: '#FFFFFF',
                border: 'none',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              {isSaving ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}
              In Datenbank speichern
            </button>

            <button
              onClick={onClearPreview}
              disabled={isSaving}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <X size={14} />
              Verwerfen
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
