import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Section, Helper } from '../utils/api';
import type { GeneratedSection } from '../utils/geo';
import { Settings, Key, Check, Globe, Paintbrush, ChevronLeft, ChevronRight, X, Sparkles, UserCheck, Zap } from 'lucide-react';

interface MapComponentProps {
  sections: Section[];
  previewSections: GeneratedSection[];
  helpers: Helper[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onDeleteSection: (sectionId: string) => void;
  // Stamp props (Direktes Zuweisen per Klick auf der Karte)
  activeStampHelperId?: string | null;
  onSelectStampHelper?: (id: string | null) => void;
  autoAdvanceStamp?: boolean;
  onToggleAutoAdvanceStamp?: (val: boolean) => void;
  onOpenAutoAssign?: () => void;
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

function toLeafletLineCoordinates(feature: any): L.LatLngExpression[] | L.LatLngExpression[][] {
  const lines = feature.geometry.type === 'MultiLineString'
    ? feature.geometry.coordinates
    : [feature.geometry.coordinates];
  const converted = lines.map((line: number[][]) => line.map(([lon, lat]) => [lat, lon] as [number, number]));
  return feature.geometry.type === 'MultiLineString' ? converted : converted[0];
}

function flattenLeafletLineCoordinates(coords: L.LatLngExpression[] | L.LatLngExpression[][]): L.LatLngExpression[] {
  return Array.isArray(coords[0]) && Array.isArray((coords[0] as any)[0]) ? (coords as L.LatLngExpression[][]).flat() : coords as L.LatLngExpression[];
}

export const MapComponent: React.FC<MapComponentProps> = ({
  sections,
  previewSections,
  helpers,
  selectedSectionId,
  onSelectSection,
  onUpdateSectionHelper,
  onDeleteSection,
  activeStampHelperId,
  onSelectStampHelper,
  autoAdvanceStamp,
  onToggleAutoAdvanceStamp,
  onOpenAutoAssign,
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
  const helperLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Stamp state (Direktes Zuweisen per Klick)
  const [internalStampHelperId, setInternalStampHelperId] = useState<string | null>(null);
  const [internalAutoAdvance, setInternalAutoAdvance] = useState<boolean>(true);
  const [stampFeedbackToast, setStampFeedbackToast] = useState<string | null>(null);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);

  const activeHelperId = activeStampHelperId !== undefined ? activeStampHelperId : internalStampHelperId;
  const isAutoAdvance = autoAdvanceStamp !== undefined ? autoAdvanceStamp : internalAutoAdvance;

  const setStampHelper = (id: string | null) => {
    if (onSelectStampHelper) onSelectStampHelper(id);
    setInternalStampHelperId(id);
  };

  const setAutoAdvance = (val: boolean) => {
    if (onToggleAutoAdvanceStamp) onToggleAutoAdvanceStamp(val);
    setInternalAutoAdvance(val);
  };

  const handlePrevHelper = () => {
    if (helpers.length === 0) return;
    const idx = helpers.findIndex(h => h.id === activeHelperId);
    if (idx > 0) {
      setStampHelper(helpers[idx - 1].id);
    } else {
      setStampHelper(helpers[helpers.length - 1].id);
    }
  };

  const handleNextHelper = () => {
    if (helpers.length === 0) return;
    const idx = helpers.findIndex(h => h.id === activeHelperId);
    if (idx !== -1 && idx < helpers.length - 1) {
      setStampHelper(helpers[idx + 1].id);
    } else {
      setStampHelper(helpers[0].id);
    }
  };

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
    helperLayerGroupRef.current = L.layerGroup().addTo(map);

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

  // Imported Lichternacht stations stay visible as small blue markers. They
  // make proximity-based proposals understandable without replacing manual work.
  useEffect(() => {
    const group = helperLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();
    helpers
      .filter(helper => Number.isFinite(Number(helper.latitude)) && Number.isFinite(Number(helper.longitude)))
      .forEach(helper => {
        const icon = L.divIcon({
          className: 'lichternacht-station-marker',
          html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#38BDF8;border:2px solid white;box-shadow:0 1px 5px rgba(15,23,42,.55);"><span style="display:block;transform:rotate(45deg);text-align:center;line-height:18px;font-size:11px;">★</span></div>`,
          iconSize: [22, 22], iconAnchor: [11, 22]
        });
        L.marker([Number(helper.latitude), Number(helper.longitude)], { icon })
          .bindTooltip(`<strong>${helper.name}</strong>${helper.address ? `<br/>${helper.address}` : ''}<br/><span style="color:#0284C7">Lichternacht-Station</span>`, { direction: 'top' })
          .addTo(group);
      });
  }, [helpers]);

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
      const assignedHelper = helpers.find(h => h.id === sec.assigned_helper_id);
      const isAssigned = !!sec.assigned_helper_id;
      const helperName = assignedHelper?.name || sec.assigned_helper_name || 'Nicht zugewiesen';
      const lineColor = assignedHelper?.color || sec.color || '#F59E0B';

      // Function to handle stamping when clicking section
      const handleSectionClick = (e: L.LeafletMouseEvent, element: L.Polyline | L.Marker) => {
        onSelectSection(sec.id);

        if (activeHelperId) {
          const targetHelper = helpers.find(h => h.id === activeHelperId);
          if (targetHelper) {
            onUpdateSectionHelper(sec.id, targetHelper.id, targetHelper.name);
            setStampFeedbackToast(`✓ "${sec.label}" zugewiesen an ${targetHelper.name}`);
            setTimeout(() => setStampFeedbackToast(null), 2400);

            if (isAutoAdvance) {
              const currentIdx = helpers.findIndex(h => h.id === activeHelperId);
              if (currentIdx !== -1 && currentIdx < helpers.length - 1) {
                setStampHelper(helpers[currentIdx + 1].id);
              } else if (helpers.length > 0) {
                setStampHelper(helpers[0].id);
              }
            }
            if (e && (e as any).originalEvent) {
              L.DomEvent.stopPropagation(e as any);
            }
            element.closePopup();
            return true;
          }
        }
        return false;
      };

      if (sec.type === 'line' && ['LineString', 'MultiLineString'].includes(sec.geojson?.geometry?.type)) {
        const coords = toLeafletLineCoordinates(sec.geojson);

        if (isSelected) {
          L.polyline(coords, {
            color: '#FFFFFF',
            weight: 12,
            opacity: 0.85
          }).addTo(group);
        }

        const polyline = L.polyline(coords, {
          color: lineColor,
          weight: isSelected ? 8 : 6,
          opacity: 0.95,
          dashArray: isAssigned ? undefined : '8, 8', // Strichliert = unzugewiesen!
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(group);

        polyline.on('click', (e) => {
          const stamped = handleSectionClick(e, polyline);
          if (stamped) return;
        });

        polyline.bindTooltip(
          `<div style="font-family: Outfit, sans-serif; font-size:12px;">
            <strong style="font-size:13px;">${sec.label}</strong><br/>
            <span>Strecke: <b>${sec.lengthMeters} m</b></span><br/>
            <div style="margin-top:3px;">
              ${isAssigned 
                ? `<span style="background:#10B98122; color:#10B981; font-weight:700; padding:2px 6px; border-radius:4px; font-size:11px;">✓ ${helperName}</span>` 
                : `<span style="background:#F59E0B22; color:#D97706; font-weight:700; padding:2px 6px; border-radius:4px; font-size:11px;">⚠️ FREI (Klick zum Zuweisen)</span>`
              }
            </div>
            ${activeHelperId ? `<div style="font-size:10px; color:#2563EB; margin-top:4px; font-weight:700;">🖌️ Klick stempelt aktiven Helfer!</div>` : ''}
          </div>`,
          { sticky: true }
        );

        // Find available helpers without assignments for quick 1-click pills
        const freeHelpers = helpers.filter(h => !sections.some(s => s.assigned_helper_id === h.id));
        const quickPills = (freeHelpers.length > 0 ? freeHelpers : helpers).slice(0, 4);

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '230px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong style="font-size:14px; color:#0F172A;">${sec.label}</strong>
              <span style="background:${lineColor}22; color:${lineColor}; font-weight:700; padding:2px 8px; border-radius:12px; font-size:12px;">${sec.lengthMeters} m</span>
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Straße: ${sec.street_name}</div>
            <div style="font-size:11px; margin-top:2px;">Status: ${isAssigned ? `<b style="color:#10B981;">✓ ${helperName}</b>` : `<b style="color:#D97706;">⚠️ Unzugewiesen</b>`}</div>
          </div>

          ${quickPills.length > 0 ? `
          <div style="margin-bottom: 8px; background:#F8FAFC; padding:6px; border-radius:6px; border:1px solid #E2E8F0;">
            <div style="font-size:10px; font-weight:700; color:#475569; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">⚡ Schnell-Zuweisung (1 Klick):</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
              ${quickPills.map(qh => `
                <button type="button" class="quick-assign-btn-${sec.id}" data-hid="${qh.id}" data-hname="${qh.name}"
                  style="background:#FFFFFF; border:1px solid #CBD5E1; color:#1E293B; border-radius:4px; padding:3px 6px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px;">
                  <span style="width:6px; height:6px; border-radius:50%; background:${qh.color || '#3B82F6'}; display:inline-block;"></span>
                  ${qh.name}
                </button>
              `).join('')}
            </div>
          </div>
          ` : ''}

          <div style="margin-bottom: 10px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Helfer wählen:</label>
            <select id="popup-helper-select-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px; background:#F8FAFC;">
              <option value="">-- Nicht zugewiesen --</option>
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${h.name}</option>`).join('')}
            </select>
          </div>
          ${sec.notes ? `<div style="font-size:11px; background:#F1F5F9; padding:5px; border-radius:4px; margin-bottom:8px;"><b>Notiz:</b> ${sec.notes}</div>` : ''}
          <div style="display:flex; justify-content:space-between; align-items:center;">
            ${isAssigned ? `
              <button id="popup-unassign-btn-${sec.id}" style="background:#FEF3C7; color:#92400E; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">
                Zuweisung lösen
              </button>
            ` : '<span></span>'}
            <button id="popup-delete-btn-${sec.id}" style="background:#FEE2E2; color:#DC2626; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">Abschnitt löschen</button>
          </div>
        `;

        polyline.bindPopup(popupDiv);

        polyline.on('popupopen', () => {
          if (activeHelperId) {
            polyline.closePopup();
            return;
          }

          // Quick assign buttons
          const quickBtns = document.querySelectorAll(`.quick-assign-btn-${sec.id}`);
          quickBtns.forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
              const hid = btn.getAttribute('data-hid');
              const hname = btn.getAttribute('data-hname');
              if (hid && hname) {
                onUpdateSectionHelper(sec.id, hid, hname);
                map.closePopup();
              }
            };
          });

          // Unassign button
          const unassignBtn = document.getElementById(`popup-unassign-btn-${sec.id}`);
          if (unassignBtn) {
            unassignBtn.onclick = () => {
              onUpdateSectionHelper(sec.id, null, null);
              map.closePopup();
            };
          }

          // Select dropdown
          const select = document.getElementById(`popup-helper-select-${sec.id}`) as HTMLSelectElement;
          if (select) {
            select.onchange = (e) => {
              const val = (e.target as HTMLSelectElement).value;
              const found = helpers.find(h => h.id === val);
              onUpdateSectionHelper(sec.id, val || null, found ? found.name : null);
              map.closePopup();
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
          html: `<div style="background:${lineColor}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${lineColor}; border:2px solid ${isSelected ? '#FFFFFF' : '#0F172A'}; font-size:14px;">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lon], { icon }).addTo(group);
        marker.on('click', (e) => {
          const stamped = handleSectionClick(e, marker);
          if (stamped) return;
        });

        marker.bindTooltip(`<strong>${sec.label}</strong> (Punkt)<br/>Helfer: <b>${helperName}</b>`, { sticky: true });

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '200px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <strong style="font-size:14px; color:#0F172A;">${sec.label}</strong>
            <div style="font-size:11px; color:#64748B;">Einzelner Punkt</div>
            <div style="font-size:11px; margin-top:2px;">Status: ${isAssigned ? `<b style="color:#10B981;">✓ ${helperName}</b>` : `<b style="color:#D97706;">⚠️ Unzugewiesen</b>`}</div>
          </div>
          <div style="margin-bottom: 8px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Helfer zuweisen:</label>
            <select id="popup-pt-helper-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px;">
              <option value="">-- Nicht zugewiesen --</option>
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${h.name}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            ${isAssigned ? `
              <button id="popup-pt-unassign-${sec.id}" style="background:#FEF3C7; color:#92400E; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">
                Lösen
              </button>
            ` : '<span></span>'}
            <button id="popup-pt-del-${sec.id}" style="background:#FEE2E2; color:#DC2626; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Löschen</button>
          </div>
        `;

        marker.bindPopup(popupDiv);

        marker.on('popupopen', () => {
          if (activeHelperId) {
            marker.closePopup();
            return;
          }
          const unassignBtn = document.getElementById(`popup-pt-unassign-${sec.id}`);
          if (unassignBtn) {
            unassignBtn.onclick = () => {
              onUpdateSectionHelper(sec.id, null, null);
              map.closePopup();
            };
          }
          const select = document.getElementById(`popup-pt-helper-${sec.id}`) as HTMLSelectElement;
          if (select) {
            select.onchange = (e) => {
              const val = (e.target as HTMLSelectElement).value;
              const found = helpers.find(h => h.id === val);
              onUpdateSectionHelper(sec.id, val || null, found ? found.name : null);
              map.closePopup();
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
  }, [sections, selectedSectionId, helpers, activeHelperId, isAutoAdvance, onSelectSection, onUpdateSectionHelper, onDeleteSection]);

  // Zoom to selected section
  useEffect(() => {
    if (!selectedSectionId || !mapRef.current) return;
    const sec = sections.find(s => s.id === selectedSectionId);
    if (!sec) return;

    if (sec.type === 'line' && ['LineString', 'MultiLineString'].includes(sec.geojson.geometry.type)) {
      const bounds = L.latLngBounds(flattenLeafletLineCoordinates(toLeafletLineCoordinates(sec.geojson)));
      mapRef.current.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
    } else if (sec.type === 'point' && sec.geojson.geometry.type === 'Point') {
      const [lon, lat] = sec.geojson.geometry.coordinates;
      mapRef.current.flyTo([lat, lon], 18);
    }
  }, [selectedSectionId, sections]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Map controls stay compact until they are explicitly needed. */}
      <button
        className="no-print map-controls-toggle"
        onClick={() => setShowLayerMenu(open => !open)}
        title="Kartenansicht und API-Einstellungen"
      >
        <Settings size={15} /> Karte
      </button>
      <div
        className="no-print"
        style={{
          position: 'absolute',
          top: 54,
          right: 16,
          zIndex: 1000,
          display: showLayerMenu ? 'flex' : 'none',
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

      {/* Floating Stempel-Modus Toolbar (Top Center) */}
      {captureMode === 'none' && helpers.length > 0 && (
        <div
          className="no-print glass-panel"
          style={{
            position: 'absolute',
            top: 16,
            left: 382,
            transform: 'none',
            // Keep a permanent clear zone on the right for account and map controls.
            maxWidth: 'calc(100% - 590px)',
            flexWrap: 'wrap',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px',
            borderRadius: 30,
            background: activeHelperId ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.75)',
            border: activeHelperId ? '2px solid var(--accent-gold)' : '1px solid var(--border-subtle)',
            boxShadow: activeHelperId ? '0 0 20px rgba(245, 158, 11, 0.35), 0 8px 24px rgba(0,0,0,0.5)' : 'var(--shadow-md)',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease'
          }}
        >
          {/* Status Icon */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: activeHelperId ? 'var(--accent-gold)' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: 12
            }}
          >
            <Paintbrush size={16} />
            <span>Stempel-Modus</span>
          </div>

          {/* Helper Selector / Cycle */}
          {activeHelperId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={handlePrevHelper}
                title="Vorheriger Helfer"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '50%',
                  width: 26,
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <ChevronLeft size={16} />
              </button>

              {/* Active Helper Pill */}
              {(() => {
                const cur = helpers.find(h => h.id === activeHelperId);
                const assignedSecs = sections.filter(s => s.assigned_helper_id === activeHelperId);
                const totalM = assignedSecs.reduce((sum, s) => sum + s.lengthMeters, 0);
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(255, 255, 255, 0.1)',
                      padding: '4px 10px',
                      borderRadius: 20
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: cur?.color || '#3B82F6',
                        boxShadow: `0 0 8px ${cur?.color || '#3B82F6'}`
                      }}
                    />
                    <span style={{ fontWeight: 800, fontSize: 13, color: '#FFFFFF' }}>
                      {cur?.name || 'Unbekannt'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontWeight: 700 }}>
                      ({totalM} m / {assignedSecs.length})
                    </span>
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={handleNextHelper}
                title="Nächster Helfer"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '50%',
                  width: 26,
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <select
              value=""
              onChange={e => setStampHelper(e.target.value || null)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#F8FAFC',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 16,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="" style={{ background: '#0F172A', color: '#94A3B8' }}>
                -- Helfer wählen zum Stempeln --
              </option>
              {helpers.map(h => {
                const count = sections.filter(s => s.assigned_helper_id === h.id).length;
                return (
                  <option key={h.id} value={h.id} style={{ background: '#0F172A', color: '#FFFFFF' }}>
                    {h.name} {count > 0 ? `(${count} Abschnitte)` : '(noch frei)'}
                  </option>
                );
              })}
            </select>
          )}

          {/* Auto-Advance Toggle */}
          {activeHelperId && (
            <label
              title="Nach jedem Klick auf einen Abschnitt automatisch zum nächsten Helfer weiterspringen"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: isAutoAdvance ? 'var(--accent-gold)' : '#94A3B8',
                cursor: 'pointer',
                fontWeight: 600,
                borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
                paddingLeft: 10
              }}
            >
              <input
                type="checkbox"
                checked={isAutoAdvance}
                onChange={e => setAutoAdvance(e.target.checked)}
                style={{ accentColor: 'var(--accent-gold)', cursor: 'pointer' }}
              />
              ⚡ Auto-Weiter
            </label>
          )}

          {/* Exit Stamp Mode Button */}
          {activeHelperId && (
            <button
              type="button"
              onClick={() => setStampHelper(null)}
              title="Stempel-Modus beenden"
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: 'none',
                color: '#EF4444',
                borderRadius: '50%',
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                marginLeft: 4
              }}
            >
              <X size={14} />
            </button>
          )}

          {/* Quick 1-Click Auto-Assign Button */}
          {onOpenAutoAssign && (
            <button
              type="button"
              onClick={onOpenAutoAssign}
              title="1-Klick Auto-Verteilung: Alle Abschnitte automatisch an freie Helfer vergeben"
              style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.25))',
                border: '1px solid rgba(245, 158, 11, 0.5)',
                color: '#F59E0B',
                borderRadius: 16,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                marginLeft: 4,
                boxShadow: '0 0 10px rgba(245, 158, 11, 0.2)'
              }}
            >
              <Zap size={13} />
              Auto-Verteilen
            </button>
          )}
        </div>
      )}

      {/* Floating Stamping Toast Feedback */}
      {stampFeedbackToast && (
        <div
          style={{
            position: 'absolute',
            top: 76,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #10B981, #059669)',
            color: '#FFFFFF',
            padding: '8px 18px',
            borderRadius: 24,
            fontWeight: 700,
            fontSize: 13,
            boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'none'
          }}
        >
          <UserCheck size={16} />
          <span>{stampFeedbackToast}</span>
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
