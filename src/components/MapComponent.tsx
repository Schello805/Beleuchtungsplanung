import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import type { Section, Helper } from '../utils/api';
import type { GeneratedSection } from '../utils/geo';
import { Settings, ChevronLeft, ChevronRight, X, UserCheck } from 'lucide-react';

interface MapComponentProps {
  sections: Section[];
  previewSections: GeneratedSection[];
  helpers: Helper[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onUpdateSectionLightingSide: (sectionId: string, lightingSide: 'both' | 'left' | 'right') => void;
  onUpdateSectionNotes: (sectionId: string, notes: string) => void;
  onMergeSections: (firstId: string, secondId: string) => void;
  onDeleteSection: (sectionId: string) => void;
  extensionSectionId?: string | null;
  onStartExtension?: (sectionId: string) => void;
  onExtensionTarget?: (lat: number, lon: number) => void;
  onCancelExtension?: () => void;
  splitSectionId?: string | null;
  onStartSplit?: (sectionId: string) => void;
  onSplitTarget?: (lat: number, lon: number) => void;
  onCancelSplit?: () => void;
  // Stamp props (Direktes Zuweisen per Klick auf der Karte)
  activeStampHelperId?: string | null;
  onSelectStampHelper?: (id: string | null) => void;
  onStartAreaAssignment?: () => void;
  onCompleteAreaAssignment?: (side: 'left' | 'right' | 'both') => void;
  onCancelAreaAssignment?: () => void;
  autoAdvanceStamp?: boolean;
  onToggleAutoAdvanceStamp?: (val: boolean) => void;
  onOpenAutoAssign?: () => void;
  // Preview interaction props
  onRemovePreviewSection?: (id: string) => void;
  focusedPreviewId?: string | null;
  onFocusPreviewSection?: (id: string | null) => void;
  // Interactive capture props
  captureMode: 'none' | 'segment' | 'custom_path' | 'point' | 'assign_area';
  segmentPoints: [number, number][];
  onMapClick: (lat: number, lon: number) => void;
  mapTileTheme: string;
  onMapTileThemeChange: (theme: string) => void;
  mapboxToken: string;
}

function toLeafletLineCoordinates(feature: any): L.LatLngExpression[] | L.LatLngExpression[][] {
  const lines = feature.geometry.type === 'MultiLineString'
    ? feature.geometry.coordinates
    : [feature.geometry.coordinates];
  const converted = lines.map((line: number[][]) => line.map(([lon, lat]) => [lat, lon] as [number, number]));
  return feature.geometry.type === 'MultiLineString' ? converted : converted[0];
}

const lightingSideLabel = (side?: Section['lighting_side']) => side === 'left'
  ? 'Straßenseite A (links in Richtung A → B)'
  : side === 'right'
    ? 'Straßenseite B (rechts in Richtung A → B)'
    : 'Beide Straßenseiten (Altbestand)';

function toLightingDisplayLines(section: Pick<Section, 'geojson' | 'lighting_side'>): L.LatLngExpression[][] {
  const geometry = section.geojson?.geometry;
  if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) return [];
  const sourceLines = geometry.type === 'MultiLineString'
    ? geometry.coordinates as number[][][]
    : [geometry.coordinates as number[][]];
  const side = section.lighting_side || 'both';
  // Turf joins the offset segments geometrically at bends. This is much more
  // stable than moving each vertex manually (which caused loops at junctions).
  const offsets = side === 'both' ? [-1.8, 1.8] : side === 'left' ? [-1.8] : [1.8];
  return offsets.flatMap(offset => sourceLines.map(line => {
    try {
      const shifted = turf.lineOffset(turf.lineString(line), offset, { units: 'meters' }).geometry.coordinates as number[][];
      return shifted.map(([lon, lat]) => [lat, lon] as [number, number]);
    } catch {
      return line.map(([lon, lat]) => [lat, lon] as [number, number]);
    }
  }));
}

export const MapComponent: React.FC<MapComponentProps> = ({
  sections,
  previewSections,
  helpers,
  selectedSectionId,
  onSelectSection,
  onUpdateSectionHelper,
  onUpdateSectionLightingSide,
  onUpdateSectionNotes,
  onMergeSections,
  onDeleteSection,
  extensionSectionId,
  onStartExtension,
  onExtensionTarget,
  onCancelExtension,
  splitSectionId,
  onStartSplit,
  onSplitTarget,
  onCancelSplit,
  activeStampHelperId,
  onSelectStampHelper,
  onStartAreaAssignment,
  onCompleteAreaAssignment,
  onCancelAreaAssignment,
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
  mapboxToken
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const sectionsLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const previewLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const captureLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const helperLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // The selected helper is a map focus, not an assignment tool.
  const [internalStampHelperId, setInternalStampHelperId] = useState<string | null>(null);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [areaAssignmentSide, setAreaAssignmentSide] = useState<'left' | 'right' | 'both'>('both');

  const activeHelperId = activeStampHelperId !== undefined ? activeStampHelperId : internalStampHelperId;

  const setStampHelper = (id: string | null) => {
    if (onSelectStampHelper) onSelectStampHelper(id);
    setInternalStampHelperId(id);
    const firstAssigned = id ? sections.find(section => section.assigned_helper_id === id) : undefined;
    onSelectSection(firstAssigned?.id || null);
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

  // Selecting a helper from either the finder or the sidebar immediately
  // reveals their first section; all of their sections receive a white outline.
  useEffect(() => {
    if (!activeHelperId) return;
    const firstAssigned = sections.find(section => section.assigned_helper_id === activeHelperId);
    if (firstAssigned && firstAssigned.id !== selectedSectionId) onSelectSection(firstAssigned.id);
  }, [activeHelperId, sections, selectedSectionId, onSelectSection]);

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
      if (splitSectionId) {
        onSplitTarget?.(e.latlng.lat, e.latlng.lng);
      } else if (extensionSectionId) {
        onExtensionTarget?.(e.latlng.lat, e.latlng.lng);
      } else if (captureMode !== 'none') {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [captureMode, extensionSectionId, splitSectionId, onMapClick, onExtensionTarget, onSplitTarget]);

  // Cursor style
  useEffect(() => {
    if (!mapContainerRef.current) return;
    mapContainerRef.current.style.cursor = captureMode !== 'none' || extensionSectionId || splitSectionId ? 'crosshair' : 'grab';
  }, [captureMode, extensionSectionId, splitSectionId]);

  // Render Interactive Capture Points
  useEffect(() => {
    const group = captureLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    const isTraceCapture = captureMode === 'custom_path' || captureMode === 'assign_area';
    const traceColor = captureMode === 'assign_area' ? '#10B981' : '#A855F7';
    if (isTraceCapture && segmentPoints.length > 1) {
      L.polyline(segmentPoints, {
        color: traceColor,
        weight: 5,
        opacity: 0.9,
        dashArray: '8, 6',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(group);
    }

    if (segmentPoints.length > 0) {
      const start = segmentPoints[0];
      const startIcon = L.divIcon({
        className: 'custom-step-marker',
        html: `<div style="background:#10B981; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 0 10px #10B981; border:2px solid white;">A</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker([start[0], start[1]], { icon: startIcon })
        .bindTooltip(isTraceCapture ? 'Punkt 1' : 'Startpunkt (A)', { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(group);
    }

    if (isTraceCapture) {
      segmentPoints.slice(1).forEach((point, index) => {
        const number = index + 2;
        const icon = L.divIcon({
          className: 'custom-step-marker',
          html: `<div style="background:${traceColor}; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 0 10px ${traceColor}; border:2px solid white; font-size:11px;">${number}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        L.marker([point[0], point[1]], { icon })
          .bindTooltip(`Punkt ${number}`, { permanent: true, direction: 'top', offset: [0, -9] })
          .addTo(group);
      });
    } else if (segmentPoints.length > 1) {
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
  }, [segmentPoints, captureMode]);

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
    previewSections.forEach(sec => {
      const isFocused = focusedPreviewId === sec.id;

      if (sec.type === 'line' && sec.geojson.geometry.type === 'LineString') {
        const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
        const displayLines = toLightingDisplayLines(sec as Pick<Section, 'geojson' | 'lighting_side'>);

        // Highlight halo if focused
        if (isFocused) {
          displayLines.forEach(displayLine => L.polyline(displayLine, {
            color: '#FFFFFF',
            weight: 12,
            opacity: 0.9
          }).addTo(group));
        }

        const polylines = displayLines.map(displayLine => L.polyline(displayLine, {
            color: sec.color,
            weight: isFocused ? 9 : 7,
            opacity: 0.95,
            dashArray: '8, 6',
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(group));
        const polyline = polylines[0];
        if (!polyline) return;

        // A / B labels sit on the offset line itself.  This makes the side
        // choice unambiguous before the organiser saves the preview.
        const sideLetter = sec.lighting_side === 'left' ? 'A' : sec.lighting_side === 'right' ? 'B' : null;
        if (sideLetter) {
          const center = polyline.getCenter();
          L.marker(center, {
            interactive: false,
            icon: L.divIcon({
              className: 'preview-side-label',
              html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${sec.color};border:2px solid #FFFFFF;color:#FFFFFF;font:800 12px/1 Outfit,Arial,sans-serif;box-shadow:0 1px 5px rgba(15,23,42,.45);">${sideLetter}</span>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11]
            })
          }).addTo(group);
        }

        polylines.forEach(line => line.on('click', () => {
          onFocusPreviewSection?.(sec.id);
        }));

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

    // Deliberately do not fit bounds here. Searching or changing a preview must
    // never override the organiser's manually chosen position and zoom.
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

    const helperLoad = new Map(helpers.map(helper => {
      const assigned = sections.filter(section => section.assigned_helper_id === helper.id);
      return [helper.id, {
        sectionCount: assigned.length,
        meters: Math.round(assigned.reduce((total, section) => total + section.lengthMeters, 0))
      }];
    }));
    const helperOptionText = (helper: Helper) => {
      const load = helperLoad.get(helper.id) || { sectionCount: 0, meters: 0 };
      return `${helper.name} (${load.sectionCount} Abschnitt${load.sectionCount === 1 ? '' : 'e'} · ${load.meters} m)`;
    };

    sections.forEach(sec => {
      const isSelected = selectedSectionId === sec.id;
      const assignedHelper = helpers.find(h => h.id === sec.assigned_helper_id);
      const isAssigned = !!sec.assigned_helper_id;
      const helperName = assignedHelper?.name || sec.assigned_helper_name || 'Nicht zugewiesen';
      const lineColor = assignedHelper?.color || sec.color || '#F59E0B';

      const handleSectionClick = (e: L.LeafletMouseEvent, element: L.Polyline | L.Marker) => {
        onSelectSection(sec.id);
        return false;
      };

      if (sec.type === 'line' && ['LineString', 'MultiLineString'].includes(sec.geojson?.geometry?.type)) {
        const coords = toLeafletLineCoordinates(sec.geojson);
        const displayLines = toLightingDisplayLines(sec);

        const isFocusedHelperSection = Boolean(activeHelperId && sec.assigned_helper_id === activeHelperId);
        if (isSelected || isFocusedHelperSection) {
          displayLines.forEach(displayLine => L.polyline(displayLine, {
              color: isSelected ? '#FDE047' : '#FFFFFF',
              weight: isSelected ? 15 : 11,
              opacity: 0.92,
              dashArray: isSelected ? '14 10' : undefined,
              className: isSelected ? 'section-highlight-pulse' : undefined
            }).addTo(group));
        }

        const polylines = displayLines.map(displayLine => L.polyline(displayLine, {
            color: lineColor,
            weight: isSelected ? 8 : 6,
            opacity: 0.95,
            dashArray: isAssigned ? undefined : '8, 8', // Strichliert = unzugewiesen!
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(group));
        const polyline = polylines[0] || L.polyline(coords).addTo(group);

        polylines.forEach(line => line.on('click', (e) => {
          const stamped = handleSectionClick(e, polyline);
          if (stamped) return;
        }));

        polyline.bindTooltip(
          `<div style="font-family: Outfit, sans-serif; font-size:12px;">
            <strong style="font-size:13px;">${sec.label}</strong><br/>
            <span>Strecke: <b>${sec.lengthMeters} m</b></span><br/>
            <span>${lightingSideLabel(sec.lighting_side)}</span><br/>
            <div style="margin-top:3px;">
              ${isAssigned 
                ? `<span style="background:#10B98122; color:#10B981; font-weight:700; padding:2px 6px; border-radius:4px; font-size:11px;">✓ ${helperName}</span>` 
                : `<span style="background:#F59E0B22; color:#D97706; font-weight:700; padding:2px 6px; border-radius:4px; font-size:11px;">⚠️ FREI (Klick zum Zuweisen)</span>`
              }
            </div>
          </div>`,
          { sticky: true }
        );

        // Find available helpers without assignments for quick 1-click pills
        const freeHelpers = helpers.filter(h => !sections.some(s => s.assigned_helper_id === h.id));
        const quickPills = (freeHelpers.length > 0 ? freeHelpers : helpers).slice(0, 4);
        const mergeCandidates = sec.geojson.geometry.type === 'LineString'
          ? sections.filter(candidate => {
              if (candidate.id === sec.id || candidate.type !== 'line' || candidate.street_name !== sec.street_name || candidate.lighting_side !== sec.lighting_side || candidate.geojson.geometry.type !== 'LineString') return false;
              const firstEndpoints = [sec.geojson.geometry.coordinates[0], sec.geojson.geometry.coordinates.at(-1)!];
              const secondEndpoints = [candidate.geojson.geometry.coordinates[0], candidate.geojson.geometry.coordinates.at(-1)!];
              return Math.min(...firstEndpoints.flatMap(first => secondEndpoints.map(second => turf.distance(turf.point(first), turf.point(second), { units: 'meters' })))) <= 25;
            })
          : [];

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
            <div style="font-size:11px; color:#475569; margin-top:2px;">🕯 ${lightingSideLabel(sec.lighting_side)}</div>
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
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${helperOptionText(h)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom: 10px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Notiz für Orga / Helfer:</label>
            <textarea id="popup-notes-${sec.id}" rows="2" style="width:100%; box-sizing:border-box; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px; resize:vertical;">${sec.notes || ''}</textarea>
            <button id="popup-save-notes-${sec.id}" style="margin-top:4px; width:100%; background:#E0F2FE; color:#0369A1; border:none; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:700;">Notiz speichern</button>
          </div>
          ${mergeCandidates.length ? `
          <div style="margin-bottom: 10px; padding:6px; background:#FFF7ED; border:1px solid #FED7AA; border-radius:6px;">
            <label style="font-size:11px; font-weight:700; color:#9A3412; display:block; margin-bottom:3px;">Angrenzenden Abschnitt zusammenführen:</label>
            <select id="popup-merge-select-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #FDBA74; font-size:12px; background:#FFFFFF;">
              <option value="">-- Abschnitt wählen --</option>
              ${mergeCandidates.map(candidate => `<option value="${candidate.id}">${candidate.label} · ${candidate.lengthMeters} m</option>`).join('')}
            </select>
            <button id="popup-merge-btn-${sec.id}" style="margin-top:4px; width:100%; background:#F97316; color:#FFFFFF; border:none; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:700;">Zusammenführen</button>
          </div>` : ''}
          <div style="margin-bottom: 10px;">
            <label style="font-size:11px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Beleuchtung:</label>
            <select id="popup-lighting-side-${sec.id}" style="width:100%; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; font-size:12px; background:#F8FAFC;">
              <option value="left" ${sec.lighting_side === 'left' ? 'selected' : ''}>Straßenseite A (links, A → B)</option>
              <option value="right" ${sec.lighting_side === 'right' ? 'selected' : ''}>Straßenseite B (rechts, A → B)</option>
              ${(sec.lighting_side || 'both') === 'both' ? '<option value="both" selected>Beide Straßenseiten (Altbestand)</option>' : ''}
            </select>
            <div style="font-size:10px; color:#64748B; margin-top:3px;">Jede Seite ist ein eigener Abschnitt und kann einem anderen Helfer zugewiesen werden.</div>
          </div>
          ${sec.notes ? `<div style="font-size:11px; background:#F1F5F9; padding:5px; border-radius:4px; margin-bottom:8px;"><b>Notiz:</b> ${sec.notes}</div>` : ''}
          <div style="display:flex; justify-content:space-between; align-items:center;">
            ${isAssigned ? `
              <button id="popup-unassign-btn-${sec.id}" style="background:#FEF3C7; color:#92400E; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">
                Zuweisung lösen
              </button>
            ` : '<span></span>'}
            <div style="display:flex; gap:5px;">
              <button id="popup-split-btn-${sec.id}" style="background:#FEF3C7; color:#92400E; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:700;">Hier teilen</button>
              <button id="popup-extend-btn-${sec.id}" style="background:#EDE9FE; color:#6D28D9; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:700;">Verlängern</button>
              <button id="popup-delete-btn-${sec.id}" style="background:#FEE2E2; color:#DC2626; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">Abschnitt löschen</button>
            </div>
          </div>
        `;

        polyline.bindPopup(popupDiv);

        polyline.on('popupopen', () => {
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

          const lightingSideSelect = document.getElementById(`popup-lighting-side-${sec.id}`) as HTMLSelectElement;
          if (lightingSideSelect) {
            lightingSideSelect.onchange = (e) => {
              onUpdateSectionLightingSide(sec.id, (e.target as HTMLSelectElement).value as 'both' | 'left' | 'right');
              map.closePopup();
            };
          }

          const splitButton = document.getElementById(`popup-split-btn-${sec.id}`);
          if (splitButton) {
            splitButton.onclick = () => {
              onStartSplit?.(sec.id);
              map.closePopup();
            };
          }

          const notesButton = document.getElementById(`popup-save-notes-${sec.id}`);
          const notesInput = document.getElementById(`popup-notes-${sec.id}`) as HTMLTextAreaElement;
          if (notesButton && notesInput) {
            notesButton.onclick = () => {
              onUpdateSectionNotes(sec.id, notesInput.value.trim());
              map.closePopup();
            };
          }

          const mergeButton = document.getElementById(`popup-merge-btn-${sec.id}`);
          const mergeSelect = document.getElementById(`popup-merge-select-${sec.id}`) as HTMLSelectElement;
          if (mergeButton && mergeSelect) {
            mergeButton.onclick = () => {
              if (!mergeSelect.value) return;
              if (confirm('Die beiden angrenzenden Abschnitte zusammenführen? Bei unterschiedlichen Helfern wird die Zuweisung zur Sicherheit geöffnet.')) {
                onMergeSections(sec.id, mergeSelect.value);
                map.closePopup();
              }
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
          const extendBtn = document.getElementById(`popup-extend-btn-${sec.id}`);
          if (extendBtn) {
            extendBtn.onclick = () => {
              onStartExtension?.(sec.id);
              map.closePopup();
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
              ${helpers.map(h => `<option value="${h.id}" ${h.id === sec.assigned_helper_id ? 'selected' : ''}>${helperOptionText(h)}</option>`).join('')}
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
  }, [sections, selectedSectionId, helpers, activeHelperId, onSelectSection, onUpdateSectionHelper, onDeleteSection, onStartExtension, onStartSplit]);

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
        className="no-print map-layer-menu"
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

      </div>

      {/* Floating helper finder (Top Center) */}
      {captureMode === 'none' && helpers.length > 0 && (
        <div
          className="no-print glass-panel helper-finder"
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
            <UserCheck size={16} />
            <span>Helfer-Finder</span>
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
                onClick={onStartAreaAssignment}
                title="Bereich auf der Karte nachzeichnen und fest zuordnen"
                style={{
                  border: '1px solid rgba(16, 185, 129, 0.7)',
                  borderRadius: 16,
                  padding: '5px 9px',
                  background: 'rgba(16, 185, 129, 0.16)',
                  color: '#6EE7B7',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Bereich zeichnen
              </button>

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
                -- Helfer suchen / anzeigen --
              </option>
              {helpers.map(h => {
                const assigned = sections.filter(s => s.assigned_helper_id === h.id);
                const count = assigned.length;
                const meters = Math.round(assigned.reduce((total, section) => total + section.lengthMeters, 0));
                return (
                  <option key={h.id} value={h.id} style={{ background: '#0F172A', color: '#FFFFFF' }}>
                    {h.name} ({count} Abschnitt{count === 1 ? '' : 'e'} · {meters} m)
                  </option>
                );
              })}
            </select>
          )}

          {/* Clear helper focus */}
          {activeHelperId && (
            <button
              type="button"
              onClick={() => setStampHelper(null)}
              title="Helfer-Auswahl schließen"
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

        </div>
      )}

      {/* Crosshair instruction overlay */}
      {(captureMode !== 'none' || extensionSectionId || splitSectionId) && (
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
          {captureMode === 'custom_path' && (
            <span>Klicke nacheinander auf den <b>Verlauf des Sonderwegs</b> · {segmentPoints.length} Punkt{segmentPoints.length === 1 ? '' : 'e'} gesetzt</span>
          )}
          {captureMode === 'assign_area' && (
            <>
              <span>Zeichne den <b>festen Bereich</b> entlang der Straße nach · {segmentPoints.length} Punkt{segmentPoints.length === 1 ? '' : 'e'} gesetzt</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {([
                  ['left', 'Seite A'],
                  ['both', 'beide'],
                  ['right', 'Seite B']
                ] as const).map(([side, label]) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setAreaAssignmentSide(side)}
                    style={{
                      border: areaAssignmentSide === side ? '1px solid #FBBF24' : '1px solid rgba(255,255,255,.3)',
                      borderRadius: 12,
                      padding: '3px 7px',
                      background: areaAssignmentSide === side ? 'rgba(245,158,11,.22)' : 'transparent',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >{label}</button>
                ))}
              </div>
              <button
                type="button"
                disabled={segmentPoints.length < 2}
                onClick={() => onCompleteAreaAssignment?.(areaAssignmentSide)}
                style={{ border: 'none', borderRadius: 14, padding: '4px 9px', background: segmentPoints.length < 2 ? '#475569' : '#10B981', color: '#fff', fontSize: 11, fontWeight: 800, cursor: segmentPoints.length < 2 ? 'not-allowed' : 'pointer' }}
              >Fest zuordnen</button>
              <button type="button" onClick={onCancelAreaAssignment} style={{ border: '1px solid rgba(255,255,255,.35)', borderRadius: 14, padding: '3px 8px', background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Abbrechen</button>
            </>
          )}
          {captureMode === 'point' && (
            <span>Klicke auf die Karte, um den <b>Einzelpunkt (z.B. Brunnen)</b> zu platzieren</span>
          )}
          {extensionSectionId && (
            <>
              <span>Klicke auf die <b>nächste Station oder den Zielpunkt</b> – der Abschnitt wird dorthin verlängert.</span>
              <button type="button" onClick={onCancelExtension} style={{ border: '1px solid rgba(255,255,255,.35)', borderRadius: 14, padding: '3px 8px', background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Abbrechen</button>
            </>
          )}
          {splitSectionId && (
            <>
              <span>Klicke auf die <b>gewünschte Teilstelle</b> des Abschnitts – der Punkt wird exakt auf die Straßenlinie gesetzt.</span>
              <button type="button" onClick={onCancelSplit} style={{ border: '1px solid rgba(255,255,255,.35)', borderRadius: 14, padding: '3px 8px', background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Abbrechen</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
