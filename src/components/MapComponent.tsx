import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Section, Helper } from '../utils/api';
import type { GeneratedSection } from '../utils/geo';
import { Settings, Key, Check, Globe } from 'lucide-react';

interface MapComponentProps {
  sections: Section[];
  previewSections: GeneratedSection[];
  helpers: Helper[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onDeleteSection: (sectionId: string) => void;
  // Preview interaction props
  onRemovePreviewSection?: (id: string) => void;
  focusedPreviewId?: string | null;
  onFocusPreviewSection?: (id: string | null) => void;
  // Interactive capture props
  captureMode: 'none' | 'segment' | 'point';
  segmentPoints: [number, number][];
  onMapClick: (lat: number, lon: number) => void;
  mapTileTheme: string;
  onMapTileThemeChange: (theme: string) => void;
  mapboxToken: string;
  onSaveMapboxToken: (token: string) => void;
}

export const MapComponent: React.FC<MapComponentProps> = ({
  sections,
  previewSections,
  helpers,
  selectedSectionId,
  onSelectSection,
  onUpdateSectionHelper,
  onDeleteSection,
  onRemovePreviewSection,
  focusedPreviewId,
  onFocusPreviewSection,
  captureMode,
  segmentPoints,
  onMapClick,
  mapTileTheme,
  onMapTileThemeChange,
  mapboxToken,
  onSaveMapboxToken
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const sectionsLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const previewLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const captureLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [tokenInput, setTokenInput] = useState<string>(mapboxToken);

  // Helper to get tile configuration
  const getTileConfig = (theme: string, token: string) => {
    if (token.trim()) {
      if (theme === 'mapbox_satellite' || theme === 'satellite') {
        return {
          url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${token.trim()}`,
          attribution: '&copy; Mapbox &copy; OpenStreetMap &copy; Maxar',
          maxZoom: 21,
          tileSize: 512,
          zoomOffset: -1
        };
      }
      if (theme === 'mapbox_streets' || theme === 'light' || theme === 'osm') {
        return {
          url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${token.trim()}`,
          attribution: '&copy; Mapbox &copy; OpenStreetMap',
          maxZoom: 21,
          tileSize: 512,
          zoomOffset: -1
        };
      }
      if (theme === 'mapbox_dark' || theme === 'dark') {
        return {
          url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token.trim()}`,
          attribution: '&copy; Mapbox &copy; OpenStreetMap',
          maxZoom: 21,
          tileSize: 512,
          zoomOffset: -1
        };
      }
    }

    // Free Open/Community Providers (100% Free, NO Watermarks, NO API Key Required)
    if (theme === 'satellite') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri World Imagery &copy; Maxar',
        maxZoom: 19
      };
    }
    // Default (Dark, Light, OSM): Standard OpenStreetMap
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    };
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [49.17056, 10.56494],
      zoom: 15,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const cfg = getTileConfig(mapTileTheme, mapboxToken);
    const tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom || 19,
      tileSize: cfg.tileSize || 256,
      zoomOffset: cfg.zoomOffset || 0
    }).addTo(map);

    // Apply or remove dark tiles filter
    const isDark = (mapTileTheme === 'dark' || mapTileTheme === 'mapbox_dark') && !mapboxToken.trim();
    if (mapContainerRef.current) {
      if (isDark) {
        mapContainerRef.current.classList.add('dark-tiles');
      } else {
        mapContainerRef.current.classList.remove('dark-tiles');
      }
    }

    tileLayerRef.current = tileLayer;

    // Groups
    sectionsLayerGroupRef.current = L.layerGroup().addTo(map);
    previewLayerGroupRef.current = L.layerGroup().addTo(map);
    captureLayerGroupRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Tile Layer when mapTileTheme or token changes
  useEffect(() => {
    if (!mapRef.current) return;
    const cfg = getTileConfig(mapTileTheme, mapboxToken);

    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }

    const newLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom || 19,
      tileSize: cfg.tileSize || 256,
      zoomOffset: cfg.zoomOffset || 0
    }).addTo(mapRef.current);

    // Apply or remove dark tiles filter
    const isDark = (mapTileTheme === 'dark' || mapTileTheme === 'mapbox_dark') && !mapboxToken.trim();
    if (mapContainerRef.current) {
      if (isDark) {
        mapContainerRef.current.classList.add('dark-tiles');
      } else {
        mapContainerRef.current.classList.remove('dark-tiles');
      }
    }

    // Keep tiles at the back
    newLayer.bringToBack();
    tileLayerRef.current = newLayer;
  }, [mapTileTheme, mapboxToken]);

  // Handle map click events
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (captureMode !== 'none') {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [captureMode, onMapClick]);

  // Cursor style
  useEffect(() => {
    if (!mapContainerRef.current) return;
    mapContainerRef.current.style.cursor = captureMode !== 'none' ? 'crosshair' : 'grab';
  }, [captureMode]);

  // Render Interactive Capture Points
  useEffect(() => {
    const group = captureLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (segmentPoints.length > 0) {
      const start = segmentPoints[0];
      const startIcon = L.divIcon({
        className: 'custom-step-marker',
        html: `<div style="background:#10B981; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 0 10px #10B981; border:2px solid white;">A</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker([start[0], start[1]], { icon: startIcon })
        .bindTooltip('Startpunkt (A)', { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(group);
    }

    if (segmentPoints.length > 1) {
      const end = segmentPoints[1];
      const endIcon = L.divIcon({
        className: 'custom-step-marker',
        html: `<div style="background:#EF4444; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 0 10px #EF4444; border:2px solid white;">B</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker([end[0], end[1]], { icon: endIcon })
        .bindTooltip('Zielpunkt (B)', { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(group);
    }
  }, [segmentPoints]);

  // Render Preview Sections
  useEffect(() => {
    const group = previewLayerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();

    if (!previewSections || previewSections.length === 0) return;
    const bounds = L.latLngBounds([]);

    previewSections.forEach(sec => {
      const isFocused = focusedPreviewId === sec.id;

      if (sec.type === 'line' && sec.geojson.geometry.type === 'LineString') {
        const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
        coords.forEach(pt => bounds.extend(pt));

        // Highlight halo if focused
        if (isFocused) {
          L.polyline(coords, {
            color: '#FFFFFF',
            weight: 12,
            opacity: 0.9
          }).addTo(group);
        }

        const polyline = L.polyline(coords, {
          color: sec.color,
          weight: isFocused ? 9 : 7,
          opacity: 0.95,
          dashArray: '8, 6',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(group);

        polyline.on('click', () => {
          onFocusPreviewSection?.(sec.id);
        });

        polyline.bindTooltip(
          `<strong>${sec.label}</strong> (Vorschau)<br/>Länge: <strong>${sec.lengthMeters} m</strong><br/><span style="color:#EF4444; font-size:10px;">Klicken zum Raus-xen</span>`,
          { sticky: true }
        );

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '220px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong style="font-size:13px; color:#0F172A;">${sec.label}</strong>
              <span style="background:${sec.color}22; color:${sec.color}; font-weight:700; padding:2px 8px; border-radius:12px; font-size:12px;">${sec.lengthMeters} m</span>
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">(Vorschau – noch nicht in DB gespeichert)</div>
          </div>
          <div style="display:flex; justify-content:flex-end;">
            <button id="preview-popup-remove-${sec.id}" style="width:100%; background:#EF4444; color:#FFFFFF; border:none; padding:7px 10px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(239,68,68,0.3);">
              ❌ Diesen Abschnitt entfernen (raus-xen)
            </button>
          </div>
        `;

        polyline.bindPopup(popupDiv);

        polyline.on('popupopen', () => {
          const btn = document.getElementById(`preview-popup-remove-${sec.id}`);
          if (btn) {
            btn.onclick = () => {
              onRemovePreviewSection?.(sec.id);
              map.closePopup();
            };
          }
        });
      } else if (sec.type === 'point' && sec.geojson.geometry.type === 'Point') {
        const [lon, lat] = sec.geojson.geometry.coordinates;
        bounds.extend([lat, lon]);

        const icon = L.divIcon({
          className: 'custom-point-marker',
          html: `<div style="background:${sec.color}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px ${sec.color}; border:2px solid #fff;">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lon], { icon }).addTo(group);
        marker.bindTooltip(`<strong>${sec.label}</strong> (Punkt-Vorschau)`);

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '200px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <strong style="font-size:13px; color:#0F172A;">${sec.label}</strong>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">(Punkt-Vorschau)</div>
          </div>
          <button id="preview-popup-remove-${sec.id}" style="width:100%; background:#EF4444; color:#FFFFFF; border:none; padding:6px 10px; border-radius:6px; font-size:11px; cursor:pointer; font-weight:700;">
            ❌ Punkt entfernen (raus-xen)
          </button>
        `;
        marker.bindPopup(popupDiv);

        marker.on('popupopen', () => {
          const btn = document.getElementById(`preview-popup-remove-${sec.id}`);
          if (btn) {
            btn.onclick = () => {
              onRemovePreviewSection?.(sec.id);
              map.closePopup();
            };
          }
        });
      }
    });

    if (bounds.isValid() && !focusedPreviewId) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    }
  }, [previewSections, focusedPreviewId]);

  // Smoothly zoom to focused preview section if clicked in sidebar
  useEffect(() => {
    if (!focusedPreviewId || !previewSections || previewSections.length === 0) return;
    const sec = previewSections.find(s => s.id === focusedPreviewId);
    if (!sec || !mapRef.current) return;

    if (sec.type === 'line' && sec.geojson?.geometry?.type === 'LineString') {
      const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
      const bounds = L.latLngBounds(coords);
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
      }
    } else if (sec.type === 'point' && sec.geojson?.geometry?.type === 'Point') {
      const [lon, lat] = sec.geojson.geometry.coordinates;
      mapRef.current.setView([lat, lon], 17);
    }
  }, [focusedPreviewId, previewSections]);

  // Render Saved Sections
  useEffect(() => {
    const group = sectionsLayerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();

    sections.forEach(sec => {
      const isSelected = selectedSectionId === sec.id;
      const helperName = sec.assigned_helper_name || 'Nicht zugewiesen';

      if (sec.type === 'line' && sec.geojson?.geometry?.type === 'LineString') {
        const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);

        if (isSelected) {
          L.polyline(coords, {
            color: '#FFFFFF',
            weight: 12,
            opacity: 0.85
          }).addTo(group);
        }

        const polyline = L.polyline(coords, {
          color: sec.color,
          weight: isSelected ? 8 : 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(group);

        polyline.on('click', () => onSelectSection(sec.id));

        polyline.bindTooltip(
          `<div style="font-family: Outfit, sans-serif; font-size:12px;">
            <strong>${sec.label}</strong><br/>
            <span>Strecke: <b>${sec.lengthMeters} m</b></span><br/>
            <span>Helfer: <b style="color:${sec.assigned_helper_name ? '#10B981' : '#F59E0B'}">${helperName}</b></span>
          </div>`,
          { sticky: true }
        );

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '220px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong style="font-size:14px; color:#0F172A;">${sec.label}</strong>
              <span style="background:${sec.color}22; color:${sec.color}; font-weight:700; padding:2px 8px; border-radius:12px; font-size:12px;">${sec.lengthMeters} m</span>
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Straße: ${sec.street_name}</div>
          </div>
          <div style="margin-bottom: 10px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Helfer zuweisen:</label>
            <select id="popup-helper-select-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px; background:#F8FAFC;">
              <option value="">-- Nicht zugewiesen --</option>
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${h.name}</option>`).join('')}
            </select>
          </div>
          ${sec.notes ? `<div style="font-size:11px; background:#F1F5F9; padding:5px; border-radius:4px; margin-bottom:8px;"><b>Notiz:</b> ${sec.notes}</div>` : ''}
          <div style="display:flex; justify-content:flex-end;">
            <button id="popup-delete-btn-${sec.id}" style="background:#FEE2E2; color:#DC2626; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">Abschnitt löschen</button>
          </div>
        `;

        polyline.bindPopup(popupDiv);

        polyline.on('popupopen', () => {
          const select = document.getElementById(`popup-helper-select-${sec.id}`) as HTMLSelectElement;
          if (select) {
            select.onchange = (e) => {
              const val = (e.target as HTMLSelectElement).value;
              const found = helpers.find(h => h.id === val);
              onUpdateSectionHelper(sec.id, val || null, found ? found.name : null);
            };
          }
          const delBtn = document.getElementById(`popup-delete-btn-${sec.id}`);
          if (delBtn) {
            delBtn.onclick = () => {
              if (confirm(`Abschnitt "${sec.label}" wirklich löschen?`)) {
                onDeleteSection(sec.id);
                map.closePopup();
              }
            };
          }
        });
      } else if (sec.type === 'point' && sec.geojson?.geometry?.type === 'Point') {
        const [lon, lat] = sec.geojson.geometry.coordinates;

        const icon = L.divIcon({
          className: 'custom-point-marker',
          html: `<div style="background:${sec.color}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${sec.color}; border:2px solid ${isSelected ? '#FFFFFF' : '#0F172A'}; font-size:14px;">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lon], { icon }).addTo(group);
        marker.on('click', () => onSelectSection(sec.id));

        marker.bindTooltip(`<strong>${sec.label}</strong> (Punkt)<br/>Helfer: <b>${helperName}</b>`, { sticky: true });

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '200px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <strong style="font-size:14px; color:#0F172A;">${sec.label}</strong>
            <div style="font-size:11px; color:#64748B;">Einzelner Punkt</div>
          </div>
          <div style="margin-bottom: 8px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Helfer zuweisen:</label>
            <select id="popup-pt-helper-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px;">
              <option value="">-- Nicht zugewiesen --</option>
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${h.name}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex; justify-content:flex-end;">
            <button id="popup-pt-del-${sec.id}" style="background:#FEE2E2; color:#DC2626; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Löschen</button>
          </div>
        `;

        marker.bindPopup(popupDiv);

        marker.on('popupopen', () => {
          const select = document.getElementById(`popup-pt-helper-${sec.id}`) as HTMLSelectElement;
          if (select) {
            select.onchange = (e) => {
              const val = (e.target as HTMLSelectElement).value;
              const found = helpers.find(h => h.id === val);
              onUpdateSectionHelper(sec.id, val || null, found ? found.name : null);
            };
          }
          const delBtn = document.getElementById(`popup-pt-del-${sec.id}`);
          if (delBtn) {
            delBtn.onclick = () => {
              onDeleteSection(sec.id);
              map.closePopup();
            };
          }
        });
      }
    });
  }, [sections, selectedSectionId, helpers, onSelectSection, onUpdateSectionHelper, onDeleteSection]);

  // Zoom to selected section
  useEffect(() => {
    if (!selectedSectionId || !mapRef.current) return;
    const sec = sections.find(s => s.id === selectedSectionId);
    if (!sec) return;

    if (sec.type === 'line' && sec.geojson.geometry.type === 'LineString') {
      const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
      const bounds = L.latLngBounds(coords);
      mapRef.current.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
    } else if (sec.type === 'point' && sec.geojson.geometry.type === 'Point') {
      const [lon, lat] = sec.geojson.geometry.coordinates;
      mapRef.current.flyTo([lat, lon], 18);
    }
  }, [selectedSectionId, sections]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Layer Switcher & Settings Button (Top Right) */}
      <div
        className="no-print"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-card)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: 4,
          boxShadow: 'var(--shadow-md)'
        }}
      >
        <button
          onClick={() => onMapTileThemeChange('dark')}
          title="Dunkle Karte"
          style={{
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            border: 'none',
            background: mapTileTheme === 'dark' || mapTileTheme === 'mapbox_dark' ? 'var(--accent-gold)' : 'transparent',
            color: mapTileTheme === 'dark' || mapTileTheme === 'mapbox_dark' ? '#0F172A' : 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          Dunkel
        </button>

        <button
          onClick={() => onMapTileThemeChange('light')}
          title="Helle Karte"
          style={{
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            border: 'none',
            background: mapTileTheme === 'light' || mapTileTheme === 'mapbox_streets' ? 'var(--accent-gold)' : 'transparent',
            color: mapTileTheme === 'light' || mapTileTheme === 'mapbox_streets' ? '#0F172A' : 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          Hell
        </button>

        <button
          onClick={() => onMapTileThemeChange('satellite')}
          title="Satellitenansicht / Luftbild (hochaufgelöst)"
          style={{
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            border: 'none',
            background: mapTileTheme === 'satellite' || mapTileTheme === 'mapbox_satellite' ? 'var(--accent-gold)' : 'transparent',
            color: mapTileTheme === 'satellite' || mapTileTheme === 'mapbox_satellite' ? '#0F172A' : 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          Satellit
        </button>

        <button
          onClick={() => onMapTileThemeChange('osm')}
          title="OpenStreetMap Standard"
          style={{
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            border: 'none',
            background: mapTileTheme === 'osm' ? 'var(--accent-gold)' : 'transparent',
            color: mapTileTheme === 'osm' ? '#0F172A' : 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          OSM
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />

        <button
          onClick={() => setShowSettingsModal(true)}
          title="Karten-API & Mapbox Key konfigurieren"
          style={{
            padding: '5px 8px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 4,
            border: 'none',
            background: mapboxToken ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
            color: mapboxToken ? '#10B981' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <Key size={13} />
          {mapboxToken ? 'Mapbox Aktiv' : 'API Key'}
        </button>
      </div>

      {/* Map API Key Modal */}
      {showSettingsModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: 480,
              maxWidth: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 24,
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                <Key size={18} color="var(--accent-gold)" />
                Karten-API & Mapbox Integration
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Die App funktioniert standardmäßig <b>ohne API-Key</b> (über OpenStreetMap, CartoDB und Esri-Satellit).
              Wenn du einen <b>Mapbox Access Token</b> hast, kannst du ihn hier eintragen, um die originalen Mapbox Streets, Dark und Satellite Vektorkacheln freizuschalten.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-main)', marginBottom: 6 }}>
                Mapbox Access Token (pk.eyJ...):
              </label>
              <input
                type="text"
                placeholder="pk.eyJ1Ijo..."
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  fontSize: 12,
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                Wird dauerhaft im Browser gespeichert. Frei lassen für Standard-Karten.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {mapboxToken && (
                <button
                  onClick={() => {
                    setTokenInput('');
                    onSaveMapboxToken('');
                    setShowSettingsModal(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid #EF4444',
                    color: '#EF4444',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Token löschen
                </button>
              )}
              <button
                onClick={() => {
                  onSaveMapboxToken(tokenInput.trim());
                  setShowSettingsModal(false);
                }}
                style={{
                  background: 'var(--accent-gold)',
                  color: '#0F172A',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Check size={14} />
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Crosshair instruction overlay */}
      {captureMode !== 'none' && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.9)',
            backdropFilter: 'blur(8px)',
            color: '#F8FAFC',
            padding: '10px 20px',
            borderRadius: 30,
            border: '1px solid rgba(245, 158, 11, 0.4)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 14,
            fontWeight: 500
          }}
        >
          <span style={{ fontSize: 18 }}>📍</span>
          {captureMode === 'segment' && segmentPoints.length === 0 && (
            <span>Klicke auf die Straße, um den <b>Startpunkt (A)</b> zu setzen</span>
          )}
          {captureMode === 'segment' && segmentPoints.length === 1 && (
            <span>Klicke nun auf die Straße für den <b>Zielpunkt (B)</b></span>
          )}
          {captureMode === 'point' && (
            <span>Klicke auf die Karte, um den <b>Einzelpunkt (z.B. Brunnen)</b> zu platzieren</span>
          )}
        </div>
      )}
    </div>
  );
};
