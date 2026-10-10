import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Section, Helper } from '../utils/api';
import type { GeneratedSection } from '../utils/geo';

interface MapComponentProps {
  sections: Section[];
  previewSections: GeneratedSection[];
  helpers: Helper[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateSectionHelper: (sectionId: string, helperId: string | null, helperName: string | null) => void;
  onDeleteSection: (sectionId: string) => void;
  // Interactive capture props
  captureMode: 'none' | 'segment' | 'point';
  segmentPoints: [number, number][]; // [[lat, lon], ...]
  onMapClick: (lat: number, lon: number) => void;
  mapTileTheme: 'dark' | 'light' | 'osm';
}

const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors'
  }
};

export const MapComponent: React.FC<MapComponentProps> = ({
  sections,
  previewSections,
  helpers,
  selectedSectionId,
  onSelectSection,
  onUpdateSectionHelper,
  onDeleteSection,
  captureMode,
  segmentPoints,
  onMapClick,
  mapTileTheme
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const sectionsLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const previewLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const captureLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Bechhofen coordinates: Lat 49.17056, Lon 10.56494
    const map = L.map(mapContainerRef.current, {
      center: [49.17056, 10.56494],
      zoom: 15,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const tileCfg = TILE_LAYERS[mapTileTheme];
    const tileLayer = L.tileLayer(tileCfg.url, {
      attribution: tileCfg.attribution,
      maxZoom: 19
    }).addTo(map);

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

  // Update Tile Layer when mapTileTheme changes
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    const tileCfg = TILE_LAYERS[mapTileTheme];
    tileLayerRef.current.setUrl(tileCfg.url);
  }, [mapTileTheme]);

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

  // Cursor style depending on capture mode
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (captureMode !== 'none') {
      mapContainerRef.current.style.cursor = 'crosshair';
    } else {
      mapContainerRef.current.style.cursor = 'grab';
    }
  }, [captureMode]);

  // Render Interactive Capture Points (Start/End markers)
  useEffect(() => {
    const group = captureLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (segmentPoints.length > 0) {
      // Point 1: Start
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
      // Point 2: End
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
      if (sec.type === 'line' && sec.geojson.geometry.type === 'LineString') {
        const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
        coords.forEach(pt => bounds.extend(pt));

        const polyline = L.polyline(coords, {
          color: sec.color,
          weight: 7,
          opacity: 0.95,
          dashArray: '8, 6',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(group);

        polyline.bindTooltip(
          `<strong>${sec.label}</strong> (Vorschau)<br/>Länge: <strong>${sec.lengthMeters} m</strong>`,
          { sticky: true }
        );
      } else if (sec.type === 'point' && sec.geojson.geometry.type === 'Point') {
        const [lon, lat] = sec.geojson.geometry.coordinates;
        bounds.extend([lat, lon]);

        const icon = L.divIcon({
          className: 'custom-point-marker',
          html: `<div style="background:${sec.color}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px ${sec.color}; border:2px solid #fff;">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        L.marker([lat, lon], { icon }).addTo(group).bindTooltip(`<strong>${sec.label}</strong> (Punkt-Vorschau)`);
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    }
  }, [previewSections]);

  // Render Saved Sections
  useEffect(() => {
    const group = sectionsLayerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();

    sections.forEach(sec => {
      const isSelected = selectedSectionId === sec.id;
      const helperName = sec.assigned_helper_name || 'Nicht zugewiesen';

      if (sec.type === 'line' && sec.geojson && sec.geojson.geometry && sec.geojson.geometry.type === 'LineString') {
        const coords = sec.geojson.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);

        // Background line for glow/selection
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

        polyline.on('click', () => {
          onSelectSection(sec.id);
        });

        // Hover tooltip
        polyline.bindTooltip(
          `<div style="font-family: Outfit, sans-serif; font-size:12px;">
            <strong>${sec.label}</strong><br/>
            <span>Strecke: <b>${sec.lengthMeters} m</b></span><br/>
            <span>Helfer: <b style="color:${sec.assigned_helper_name ? '#10B981' : '#F59E0B'}">${helperName}</b></span>
          </div>`,
          { sticky: true }
        );

        // Interactive Popup
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
      } else if (sec.type === 'point' && sec.geojson && sec.geojson.geometry && sec.geojson.geometry.type === 'Point') {
        const [lon, lat] = sec.geojson.geometry.coordinates;

        const icon = L.divIcon({
          className: 'custom-point-marker',
          html: `<div style="background:${sec.color}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${sec.color}; border:2px solid ${isSelected ? '#FFFFFF' : '#0F172A'}; font-size:14px;">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lon], { icon }).addTo(group);
        marker.on('click', () => onSelectSection(sec.id));

        marker.bindTooltip(
          `<strong>${sec.label}</strong> (Punkt)<br/>Helfer: <b>${helperName}</b>`,
          { sticky: true }
        );

        const popupDiv = document.createElement('div');
        popupDiv.style.fontFamily = 'Outfit, sans-serif';
        popupDiv.style.minWidth = '200px';
        popupDiv.innerHTML = `
          <div style="margin-bottom: 8px;">
            <strong style="font-size:14px; color:#0F172A;">${sec.label}</strong>
            <div style="font-size:11px; color:#64748B;">Einzelner Punkt (z.B. Brunnen)</div>
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

  // Zoom to selected section when requested
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

      {/* Crosshair instruction overlay during capture mode */}
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
