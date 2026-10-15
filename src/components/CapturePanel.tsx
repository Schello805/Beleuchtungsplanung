import React, { useState, useEffect } from 'react';
import { Scissors, MapPin, Search, Check, X, RefreshCw, AlertCircle, Compass, Layers, Users, Plus, Trash2, ListPlus, Route } from 'lucide-react';
import { api } from '../utils/api';
import { chunkLineWithFairness, chunkLinePreferringJunctions, createPointSection, createSideSections, type GeneratedSection } from '../utils/geo';
import * as turf from '@turf/turf';

interface CapturePanelProps {
  streetSearchArea?: { city: string; postalCode: string };
  onPreviewGenerated: (sections: GeneratedSection[], streetInfo: { name: string; method: string; chunkLength: number; minLength: number; totalLength: number }) => void;
  onClearPreview: () => void;
  previewSections: GeneratedSection[];
  onRemovePreviewSection: (id: string) => void;
  focusedPreviewId?: string | null;
  onFocusPreviewSection?: (id: string | null) => void;
  onSavePreview: () => Promise<void>;
  isSaving: boolean;
  captureMode: 'none' | 'segment' | 'custom_path' | 'point';
  setCaptureMode: (mode: 'none' | 'segment' | 'custom_path' | 'point') => void;
  segmentPoints: [number, number][];
  setSegmentPoints: (points: [number, number][]) => void;
}

export const CapturePanel: React.FC<CapturePanelProps> = ({
  streetSearchArea,
  onPreviewGenerated,
  onClearPreview,
  previewSections,
  onRemovePreviewSection,
  focusedPreviewId,
  onFocusPreviewSection,
  onSavePreview,
  isSaving,
  captureMode,
  setCaptureMode,
  segmentPoints,
  setSegmentPoints
}) => {
  const [method, setMethod] = useState<'full_street' | 'batch' | 'segment' | 'custom_path' | 'point'>('full_street');
  const [lightingSides, setLightingSides] = useState<'left' | 'right' | 'both'>('both');
  const [latestStreetPreview, setLatestStreetPreview] = useState<{ name: string; method: string; chunkLength: number; minLength: number; totalLength: number } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // Capture uses stable, coarse defaults. Fair length limits are deliberately
  // configured later in the dedicated redistribution workflow.
  const chunkLength = 100;
  const minLength = 50;

  // Full street search
  const [streetQuery, setStreetQuery] = useState<string>('');
  const [availableStreets, setAvailableStreets] = useState<string[]>([]);
  const [filteredStreets, setFilteredStreets] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  // Batch Mode State (Multi-street partitioning on N participants)
  const [batchStreetList, setBatchStreetList] = useState<string[]>([
    'Marktplatz',
    'Dinkelsbühler Straße',
    'Ansbacher Straße',
    'Kirchenallee'
  ]);
  const [batchInputText, setBatchInputText] = useState<string>('');
  const [showBatchTextInput, setShowBatchTextInput] = useState<boolean>(false);
  const [participantCount, setParticipantCount] = useState<number>(35);
  const [keepShortStreetsIntact, setKeepShortStreetsIntact] = useState<boolean>(true);
  const [batchSearchQuery, setBatchSearchQuery] = useState<string>('');
  const [batchFilterSuggestions, setBatchFilterSuggestions] = useState<string[]>([]);
  const [showBatchDropdown, setShowBatchDropdown] = useState<boolean>(false);
  const [batchStats, setBatchStats] = useState<{
    totalMeters: number;
    recommendedChunk: number;
    count: number;
    shortStreets: number;
  } | null>(null);

  // Point capture
  const [pointLabel, setPointLabel] = useState<string>('Brunnen');
  const [customPathLabel, setCustomPathLabel] = useState<string>('Weg St. Katharina');

  // Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fairnessNotice, setFairnessNotice] = useState<string | null>(null);

  // Load Bechhofen streets for autocomplete
  useEffect(() => {
    api.getBechhofenStreets(streetSearchArea).then(list => {
      setAvailableStreets(list);
    }).catch(err => {
      console.warn('Streets fetch error:', err);
    });
  }, [streetSearchArea?.city, streetSearchArea?.postalCode]);

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

  // Filter batch suggestions
  useEffect(() => {
    if (!batchSearchQuery.trim()) {
      setBatchFilterSuggestions([]);
      return;
    }
    const qNorm = batchSearchQuery.toLowerCase().replace(/ß/g, 'ss');
    const matches = availableStreets.filter(s =>
      !batchStreetList.includes(s) &&
      s.toLowerCase().replace(/ß/g, 'ss').includes(qNorm)
    );
    setBatchFilterSuggestions(matches.slice(0, 8));
  }, [batchSearchQuery, availableStreets, batchStreetList]);

  // Method switch handler
  const handleMethodChange = (newMethod: 'full_street' | 'batch' | 'segment' | 'custom_path' | 'point') => {
    setMethod(newMethod);
    setErrorMessage(null);
    setFairnessNotice(null);
    onClearPreview();
    setLatestStreetPreview(null);

    if (newMethod === 'segment') {
      setCaptureMode('segment');
      setSegmentPoints([]);
    } else if (newMethod === 'custom_path') {
      setCaptureMode('custom_path');
      setSegmentPoints([]);
    } else if (newMethod === 'point') {
      setCaptureMode('point');
      setSegmentPoints([]);
    } else {
      setCaptureMode('none');
      setSegmentPoints([]);
    }
  };

  const showStreetPreview = (sections: GeneratedSection[], info: { name: string; method: string; chunkLength: number; minLength: number; totalLength: number }) => {
    setLatestStreetPreview(info);
    onPreviewGenerated(createSideSections(sections, lightingSides), info);
  };

  const handleLightingSideChange = (selection: 'left' | 'right' | 'both') => {
    setLightingSides(selection);
    if (!latestStreetPreview || previewSections.length === 0) return;

    // The selector must also alter an already loaded preview. Normalize the
    // existing A/B variants first, then recreate exactly the requested side(s).
    const originals = new Map<string, GeneratedSection>();
    previewSections.forEach(section => {
      const originalId = section.id.replace(/-(left|right)$/u, '');
      if (!originals.has(originalId)) {
        originals.set(originalId, {
          ...section,
          id: originalId,
          label: section.label.replace(/\s*·\s*Seite [AB]$/u, ''),
          lighting_side: undefined
        });
      }
    });
    onPreviewGenerated(createSideSections([...originals.values()], selection), latestStreetPreview);
  };

  // Add street to batch list
  const handleAddStreetToBatch = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!batchStreetList.includes(trimmed)) {
      setBatchStreetList(prev => [...prev, trimmed]);
    }
    setBatchSearchQuery('');
    setShowBatchDropdown(false);
  };

  // Remove street from batch list
  const handleRemoveStreetFromBatch = (name: string) => {
    setBatchStreetList(prev => prev.filter(s => s !== name));
  };

  // Add from pasted text (comma or newline separated)
  const handleImportPastedBatchText = () => {
    if (!batchInputText.trim()) return;
    const names = batchInputText
      .split(/[\n,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const merged = Array.from(new Set([...batchStreetList, ...names]));
    setBatchStreetList(merged);
    setBatchInputText('');
    setShowBatchTextInput(false);
  };

  // Execute Batch Street Auto-Partitioning on N Participants
  const handleQueryBatchStreets = async () => {
    if (batchStreetList.length === 0) {
      setErrorMessage('Bitte füge mindestens eine Straße zum Paket hinzu.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setFairnessNotice(null);

    try {
      // 1. Fetch geometry for all selected streets
      const streetDataList: Array<{ name: string; features: GeoJSON.Feature<GeoJSON.LineString>[]; totalMeters: number; junctionPoints: Array<[number, number]> }> = [];
      const failedStreets: string[] = [];

      for (const stName of batchStreetList) {
        try {
          const res = await api.getStreetGeometry(stName, streetSearchArea);
          if (res.features && res.features.length > 0) {
            streetDataList.push({
              name: res.streetName,
              features: res.features,
              totalMeters: res.totalLengthMeters,
              junctionPoints: res.junctionPoints || []
            });
          } else {
            failedStreets.push(stName);
          }
        } catch {
          failedStreets.push(stName);
        }
      }

      if (streetDataList.length === 0) {
        throw new Error('Für keine der ausgewählten Straßen konnte eine Geometrie gefunden werden.');
      }

      // 2. Total Length across all selected streets
      const grandTotalMeters = streetDataList.reduce((sum, s) => sum + s.totalMeters, 0);

      // 3. Recommended chunk length for N participants (e.g. 35)
      const calculatedIdealChunk = Math.max(30, Math.round(grandTotalMeters / participantCount));
      const effectiveChunk = chunkLength > 0 ? chunkLength : calculatedIdealChunk;
      const effectiveMin = minLength;

      // 4. Partition streets:
      // Short streets stay intact as 1 section (Kein Stückwerk!)
      let allGenerated: GeneratedSection[] = [];
      let colorOffset = 0;
      let shortStreetsCount = 0;

      streetDataList.forEach((streetData) => {
        // Michael's requirement: If a street is shorter than target chunk or minimal length, keep it intact!
        const isShortStreet = keepShortStreetsIntact && streetData.totalMeters <= (effectiveChunk + effectiveMin);

        if (isShortStreet) {
          // Keep entire street as 1 unified section
          shortStreetsCount++;
          const primaryFeat = streetData.features[0];
          const color = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'][colorOffset % 8];
          allGenerated.push({
            id: `sec-b-${Date.now()}-${colorOffset}-1`,
            streetName: streetData.name,
            sectionIndex: 1,
            label: `${streetData.name} (Gesamt)`,
            lengthMeters: streetData.totalMeters,
            color,
            type: 'line',
            geojson: primaryFeat
          });
          colorOffset++;
        } else {
          // Standard street chunking with tail fairness
          streetData.features.forEach((feat, branchIdx) => {
            const branchLabel = streetData.features.length > 1 ? `${streetData.name} (Teil ${branchIdx + 1})` : streetData.name;
            const branchSections = chunkLinePreferringJunctions(feat, branchLabel, effectiveChunk, effectiveMin, streetData.junctionPoints, colorOffset);

            branchSections.forEach(s => {
              s.streetName = streetData.name;
            });

            allGenerated = [...allGenerated, ...branchSections];
            colorOffset += branchSections.length;
          });
        }
      });

      setBatchStats({
        totalMeters: grandTotalMeters,
        recommendedChunk: calculatedIdealChunk,
        count: allGenerated.length,
        shortStreets: shortStreetsCount
      });

      setFairnessNotice(
        `Paket berechnet: ${grandTotalMeters}m auf ${allGenerated.length} Abschnitte für ${participantCount} Helfer aufgeteilt! ` +
        `(${shortStreetsCount} kurze Straßen blieben kompakt als 1 eigener Abschnitt erhalten).`
      );

      showStreetPreview(allGenerated, {
        name: `Paket (${batchStreetList.length} Straßen, ${participantCount} Helfer)`,
        method: 'batch',
        chunkLength: effectiveChunk,
        minLength: effectiveMin,
        totalLength: grandTotalMeters
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Fehler bei der Berechnung');
    } finally {
      setIsLoading(false);
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
      const data = await api.getStreetGeometry(targetName, streetSearchArea);
      if (!data.features || data.features.length === 0) {
        throw new Error(`Keine Geometrie für "${targetName}" gefunden.`);
      }

      // Chunk each branch with fairness rule
      let allGenerated: GeneratedSection[] = [];
      let colorOffset = 0;
      let hadFairnessMerge = false;

      data.features.forEach((feat, branchIdx) => {
        const branchLabel = data.features.length > 1 ? `${data.streetName} (Teil ${branchIdx + 1})` : data.streetName;
        const branchSections = chunkLinePreferringJunctions(feat, branchLabel, chunkLength, minLength, data.junctionPoints || [], colorOffset);
        
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
      showStreetPreview(allGenerated, {
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

  const handleCreateCustomPath = () => {
    if (segmentPoints.length < 2) {
      setErrorMessage('Bitte setze mindestens zwei Punkte auf der Karte, um einen Weg zu zeichnen.');
      return;
    }

    const name = customPathLabel.trim() || 'Sonderweg';
    const label = `Sonderbereich – ${name}`;
    const coordinates = segmentPoints.map(([lat, lon]) => [lon, lat] as [number, number]);
    const line = turf.lineString(coordinates);
    const lengthMeters = Math.max(1, Math.round(turf.length(line, { units: 'kilometers' }) * 1000));
    const section = {
      id: `sec-${Date.now()}-sonderweg`,
      streetName: name,
      sectionIndex: 1,
      label,
      lengthMeters,
      color: '#A855F7',
      type: 'line' as const,
      geojson: line
    };

    onPreviewGenerated([section], {
      name,
      method: 'custom_path',
      chunkLength: lengthMeters,
      minLength: 0,
      totalLength: lengthMeters
    });
    setErrorMessage(null);
  };

  // Expose point click to parent
  useEffect(() => {
    (window as any).__onPointMapClick = handlePointCreated;
  }, [pointLabel]);

  const totalPreviewLength = previewSections.reduce((sum, s) => sum + s.lengthMeters, 0);

  // Group preview sections by branch / street if multiple branches exist
  const previewBranches = React.useMemo(() => {
    const map = new Map<string, GeneratedSection[]>();
    previewSections.forEach(sec => {
      const partMatch = sec.label.match(/^(.*?\(Teil \d+\))/);
      const groupKey = partMatch ? partMatch[1] : (sec.streetName || '');
      if (groupKey) {
        const list = map.get(groupKey) || [];
        list.push(sec);
        map.set(groupKey, list);
      }
    });
    if (map.size <= 1) return [];
    return Array.from(map.entries());
  }, [previewSections]);

  if (isCollapsed) {
    return (
      <div
        className="glass-panel"
        onClick={() => setIsCollapsed(false)}
        style={{
          padding: '8px 14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-card)',
          marginBottom: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Scissors size={16} color="var(--accent-gold)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
            Strecke erfassen & zerschneiden
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontWeight: 700 }}>
          Ausklappen ▼
        </span>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)', margin: 0 }}>
          <Scissors size={18} color="var(--accent-gold)" />
          Strecke erfassen & zerschneiden
        </h3>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          title="Panel minimieren für volle Sicht auf die Karte"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          Minimieren ▲
        </button>
      </div>

      {/* Method Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 14 }}>
        <button
          onClick={() => handleMethodChange('full_street')}
          style={{
            padding: '7px 2px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'full_street' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'full_street' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'full_street' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Ganze Str.
        </button>

        <button
          onClick={() => handleMethodChange('batch')}
          style={{
            padding: '7px 2px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 'var(--radius-sm)',
            border: method === 'batch' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'batch' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'batch' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Paket ({participantCount})
        </button>

        <button
          onClick={() => handleMethodChange('segment')}
          style={{
            padding: '7px 2px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'segment' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'segment' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'segment' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Teilstück
        </button>

        <button
          onClick={() => handleMethodChange('custom_path')}
          title="Weg, Brücke oder Platzrand frei auf der Karte zeichnen"
          style={{
            padding: '7px 2px', fontSize: 11, fontWeight: 700, borderRadius: 'var(--radius-sm)',
            border: method === 'custom_path' ? '1px solid #A855F7' : '1px solid var(--border-subtle)',
            background: method === 'custom_path' ? 'rgba(168, 85, 247, .14)' : 'transparent',
            color: method === 'custom_path' ? '#C084FC' : 'var(--text-muted)', cursor: 'pointer', transition: 'all .15s ease'
          }}
        >
          Weg
        </button>

        <button
          onClick={() => handleMethodChange('point')}
          style={{
            padding: '7px 2px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: method === 'point' ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            background: method === 'point' ? 'var(--accent-gold-glow)' : 'transparent',
            color: method === 'point' ? 'var(--accent-gold)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Punkt
        </button>
      </div>

      {(method === 'full_street' || method === 'batch') && (
        <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', marginBottom: 7 }}>Welche Straßenseite wird geschmückt?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
            {([
              ['left', 'Seite A', 'in der Vorschau mit A markiert'],
              ['both', 'Beide Seiten', 'zwei getrennte, beschriftete Linien'],
              ['right', 'Seite B', 'in der Vorschau mit B markiert']
            ] as const).map(([value, title, description]) => (
              <button
                type="button"
                key={value}
                onClick={() => handleLightingSideChange(value)}
                style={{ padding: '7px 4px', borderRadius: 5, border: lightingSides === value ? '1px solid var(--accent-gold)' : '1px solid var(--border-subtle)', background: lightingSides === value ? 'var(--accent-gold-glow)' : 'var(--bg-input)', color: lightingSides === value ? 'var(--accent-gold)' : 'var(--text-main)', cursor: 'pointer', textAlign: 'center' }}
              >
                <span style={{ display: 'block', fontSize: 11, fontWeight: 800 }}>{title}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 9, color: 'var(--text-muted)' }}>{description}</span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 7 }}>Bei „Beide Seiten“ werden A und B sofort als getrennte, unabhängig zuweisbare Abschnitte angelegt. Auf der Karte liegt die Markierung direkt auf der jeweiligen Straßenseite.</div>
        </div>
      )}

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

      {/* METHOD 2: Straßen-Paket (Batch auf Helfer berechnen) */}
      {method === 'batch' && (
        <div style={{ marginBottom: 14 }}>
          {/* Participant count stepper */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              marginBottom: 10
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} color="var(--accent-gold)" />
                Anzahl Teilnehmer / Helfer:
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                Abschnittslänge wird automatisch berechnet
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setParticipantCount(prev => Math.max(1, prev - 1))}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-main)',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                -
              </button>
              <input
                type="number"
                min="1"
                max="200"
                value={participantCount}
                onChange={e => setParticipantCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{
                  width: 48,
                  textAlign: 'center',
                  padding: '4px 2px',
                  borderRadius: 4,
                  border: '1px solid var(--accent-gold)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-main)',
                  fontWeight: 800,
                  fontSize: 14
                }}
              />
              <button
                type="button"
                onClick={() => setParticipantCount(prev => prev + 1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-main)',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Quick selection presets */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => {
                const presets = ['Marktplatz', 'Dinkelsbühler Straße', 'Ansbacher Straße', 'Feuchtwanger Straße', 'Gunzenhausener Straße'];
                setBatchStreetList(Array.from(new Set([...batchStreetList, ...presets])));
              }}
              style={{
                fontSize: 10,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-main)',
                cursor: 'pointer'
              }}
            >
              + 5 Hauptstraßen
            </button>

            <button
              type="button"
              onClick={() => {
                if (availableStreets.length > 0) {
                  setBatchStreetList(availableStreets);
                }
              }}
              style={{
                fontSize: 10,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-main)',
                cursor: 'pointer'
              }}
            >
              + Alle Straßen ({availableStreets.length})
            </button>

            <button
              type="button"
              onClick={() => setShowBatchTextInput(prev => !prev)}
              style={{
                fontSize: 10,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
                background: showBatchTextInput ? 'var(--accent-gold-glow)' : 'var(--bg-secondary)',
                color: showBatchTextInput ? 'var(--accent-gold)' : 'var(--text-main)',
                cursor: 'pointer'
              }}
            >
              Text einfügen
            </button>

            {batchStreetList.length > 0 && (
              <button
                type="button"
                onClick={() => setBatchStreetList([])}
                style={{
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#EF4444',
                  cursor: 'pointer',
                  marginLeft: 'auto'
                }}
              >
                ✕ Leeren
              </button>
            )}
          </div>

          {/* Pasted text input modal/textarea */}
          {showBatchTextInput && (
            <div style={{ marginBottom: 10, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Straßennamen einfügen (komma- oder zeilengetrennt):
              </label>
              <textarea
                rows={3}
                value={batchInputText}
                onChange={e => setBatchInputText(e.target.value)}
                placeholder="z.B. Marktplatz, Dinkelsbühler Straße, Ansbacher Straße, Kirchplatz..."
                style={{
                  width: '100%',
                  padding: 6,
                  fontSize: 11,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  color: 'var(--text-main)',
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowBatchTextInput(false)}
                  style={{ fontSize: 11, padding: '3px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleImportPastedBatchText}
                  style={{ fontSize: 11, padding: '4px 10px', background: 'var(--accent-gold)', color: '#0F172A', fontWeight: 700, borderRadius: 4, border: 'none', cursor: 'pointer' }}
                >
                  Übernehmen
                </button>
              </div>
            </div>
          )}

          {/* Autocomplete Search to add individual street */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Weitere Straße hinzufügen..."
                value={batchSearchQuery}
                onChange={e => {
                  setBatchSearchQuery(e.target.value);
                  setShowBatchDropdown(true);
                }}
                onFocus={() => setShowBatchDropdown(true)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  fontSize: 12,
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (batchSearchQuery.trim()) {
                    handleAddStreetToBatch(batchSearchQuery);
                  }
                }}
                style={{
                  padding: '6px 10px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-gold)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                <Plus size={14} />
                Hinzufügen
              </button>
            </div>

            {/* Dropdown suggestions */}
            {showBatchDropdown && batchFilterSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 2000,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  maxHeight: 140,
                  overflowY: 'auto',
                  boxShadow: 'var(--shadow-card)',
                  marginTop: 2
                }}
              >
                {batchFilterSuggestions.map(name => (
                  <div
                    key={name}
                    onClick={() => handleAddStreetToBatch(name)}
                    style={{
                      padding: '6px 10px',
                      fontSize: 11,
                      cursor: 'pointer',
                      color: 'var(--text-main)',
                      borderBottom: '1px solid var(--border-subtle)'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    + {name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* List of currently selected streets */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                Ausgewählte Straßen ({batchStreetList.length}):
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                maxHeight: 90,
                overflowY: 'auto',
                padding: 6,
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {batchStreetList.map(name => (
                <span
                  key={name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 11,
                    color: 'var(--text-main)'
                  }}
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => handleRemoveStreetFromBatch(name)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Michael's Fairness Rule: Keep Short Streets Intact */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              marginBottom: 10,
              fontSize: 11
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: 'var(--text-main)' }}>
              <input
                type="checkbox"
                checked={keepShortStreetsIntact}
                onChange={e => setKeepShortStreetsIntact(e.target.checked)}
                style={{ accentColor: '#10B981', cursor: 'pointer' }}
              />
              <span>Kurze Straßen als 1 Abschnitt belassen</span>
            </label>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 4, paddingLeft: 20 }}>
              💡 Straßen, die kürzer sind als die Abschnittslänge, werden nicht zerlegt und nicht mit entfernten Straßen kombiniert (kein Stückwerk über 5 km hinweg).
            </div>
          </div>

          {/* Action button to calculate batch */}
          <button
            type="button"
            onClick={handleQueryBatchStreets}
            disabled={isLoading || batchStreetList.length === 0}
            style={{
              width: '100%',
              background: 'var(--accent-gold)',
              color: '#0F172A',
              border: 'none',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            {isLoading ? <RefreshCw size={15} className="spin" /> : <Layers size={15} />}
            Paket für {participantCount} Helfer berechnen
          </button>
        </div>
      )}
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

      {method === 'custom_path' && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Bezeichnung des Sonderbereichs:
          </label>
          <input
            type="text"
            placeholder="z.B. Weg St. Katharina, Fußweg zum Parkplatz, Brücke"
            value={customPathLabel}
            onChange={e => setCustomPathLabel(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)', fontSize: 13, color: 'var(--text-main)', outline: 'none', marginBottom: 8 }}
          />
          <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: 'rgba(168, 85, 247, .1)', border: '1px solid rgba(168, 85, 247, .3)', fontSize: 12, color: 'var(--text-main)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#C084FC', marginBottom: 5 }}><Route size={15} /> Weg, Brücke oder Platzrand frei einzeichnen</div>
            <div>Klicke die Punkte entlang des tatsächlichen Verlaufs an. Der violette Linienzug zeigt die Vorschau.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }}>
              <span style={{ color: segmentPoints.length >= 2 ? '#34D399' : 'var(--text-muted)', fontWeight: 600 }}>{segmentPoints.length} Punkt{segmentPoints.length === 1 ? '' : 'e'} gesetzt</span>
              <button type="button" onClick={() => { setSegmentPoints([]); onClearPreview(); }} disabled={!segmentPoints.length} style={{ fontSize: 11, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', padding: '4px 7px', borderRadius: 4, cursor: segmentPoints.length ? 'pointer' : 'not-allowed' }}>Zurücksetzen</button>
            </div>
          </div>
          <button type="button" onClick={handleCreateCustomPath} disabled={segmentPoints.length < 2} style={{ width: '100%', marginTop: 8, padding: '8px 10px', border: 0, borderRadius: 'var(--radius-sm)', background: segmentPoints.length >= 2 ? '#A855F7' : 'var(--bg-input)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: segmentPoints.length >= 2 ? 'pointer' : 'not-allowed', opacity: segmentPoints.length >= 2 ? 1 : .6 }}>
            Weg als Vorschau übernehmen
          </button>
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

          {/* Branch filter if multiple parts/branches exist (e.g. Dinkelsbühler Str. Industriegebiet vs Ortsmitte) */}
          {previewBranches.length > 1 && (
            <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                Gefundene Straßenteile ({previewBranches.length} Zweige):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {previewBranches.map(([branchName, bSecs]) => {
                  const bMeters = bSecs.reduce((sum, s) => sum + s.lengthMeters, 0);
                  return (
                    <div
                      key={branchName}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--bg-secondary)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 11
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {branchName}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>
                          ({bMeters} m, {bSecs.length} {bSecs.length === 1 ? 'Abschnitt' : 'Abschnitte'})
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => onFocusPreviewSection?.(bSecs[0].id)}
                          title="Diesen Zweig auf der Karte heranzoomen"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--accent-gold)',
                            cursor: 'pointer',
                            padding: '2px 5px',
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: 10,
                            gap: 2
                          }}
                        >
                          <MapPin size={10} /> Zeigen
                        </button>
                        <button
                          type="button"
                          onClick={() => bSecs.forEach(s => onRemovePreviewSection(s.id))}
                          title={`Ganzen Zweig "${branchName}" komplett aus der Vorschau entfernen`}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#EF4444',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: 10,
                            fontWeight: 600,
                            gap: 2
                          }}
                        >
                          <X size={10} /> Raus-xen
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* User Hint */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.35, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <span>💡</span>
            <span>
              Klicke bei ungewünschten Abschnitten auf <strong style={{ color: '#EF4444' }}>❌</strong>, um sie aus der Vorschau herauszunehmen. Mit <strong style={{ color: 'var(--accent-gold)' }}>📍</strong> zoomst du direkt auf den Abschnitt.
            </span>
          </div>

          {/* List of preview chunks */}
          <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {previewSections.map((sec, idx) => {
              const isFocused = focusedPreviewId === sec.id;
              return (
                <div
                  key={sec.id || idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '5px 8px',
                    background: isFocused ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-secondary)',
                    border: isFocused ? '1px solid var(--accent-gold)' : '1px solid transparent',
                    borderRadius: 4,
                    fontSize: 11,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => onFocusPreviewSection?.(sec.id)}
                    title="Klicken, um diesen Abschnitt auf der Karte heranzuzoomen"
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: sec.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sec.label}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent-gold)', fontSize: 11 }}>
                      {sec.lengthMeters} m
                    </span>
                    <button
                      type="button"
                      onClick={() => onFocusPreviewSection?.(sec.id)}
                      title="Auf Karte zentrieren"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px 3px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: 3
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-gold)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      <MapPin size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemovePreviewSection(sec.id)}
                      title="Diesen Abschnitt aus der Vorschau entfernen (raus-xen)"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        color: '#EF4444',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = '#EF4444';
                        e.currentTarget.style.color = '#FFFFFF';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                        e.currentTarget.style.color = '#EF4444';
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
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
