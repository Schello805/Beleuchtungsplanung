import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Crosshair, MapPin } from 'lucide-react';
import type { PublicHelperInfo } from '../utils/api';
import { getSectionEndpoints } from '../utils/sectionEndpoints';

interface Props {
  info: PublicHelperInfo;
}

const lightingSideText = (side?: 'both' | 'left' | 'right') => side === 'left'
  ? 'Straßenseite A (links in Richtung A → B)'
  : side === 'right'
    ? 'Straßenseite B (rechts in Richtung A → B)'
    : 'Beide Straßenseiten (Altbestand)';

const endpointIcon = (label: string, color: string) => L.divIcon({
  className: 'public-map-endpoint',
  html: `<span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#FFFFFF;border:3px solid ${color};color:${color};font:900 12px system-ui;box-shadow:0 1px 5px rgba(15,23,42,.45)">${label}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

const sectionLines = (section: PublicHelperInfo['sections'][number]) => {
  const geometry = section.geojson?.geometry;
  if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) return [] as [number, number][][];
  const sourceLines = geometry.type === 'LineString'
    ? [geometry.coordinates as number[][]]
    : geometry.coordinates as number[][][];
  const offsets = section.lighting_side === 'left' ? [-1.8] : section.lighting_side === 'right' ? [1.8] : [-1.8, 1.8];
  return offsets.flatMap(offset => sourceLines.map(line => {
    try {
      return (turf.lineOffset(turf.lineString(line), offset, { units: 'meters' }).geometry.coordinates as number[][])
        .map(([lon, lat]) => [lat, lon] as [number, number]);
    } catch {
      return line.map(([lon, lat]) => [lat, lon] as [number, number]);
    }
  }));
};

const PublicAreaMap: React.FC<{ info: PublicHelperInfo }> = ({ info }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const locationLayerRef = useRef<L.LayerGroup | null>(null);
  const [locationMessage, setLocationMessage] = useState('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = L.map(container, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    mapRef.current = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap-Mitwirkende'
    }).addTo(map);
    const group = L.featureGroup().addTo(map);
    const endpointCount = info.sections.filter(section => section.geojson?.geometry?.type !== 'Point').length;

    info.sections.forEach((section, index) => {
      const suffix = endpointCount > 1 ? String(index + 1) : '';
      const geometry = section.geojson?.geometry;
      if (geometry?.type === 'Point') {
        const [lon, lat] = geometry.coordinates as [number, number];
        L.circleMarker([lat, lon], { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#F59E0B', fillOpacity: 1 })
          .bindTooltip(section.label, { direction: 'top' })
          .addTo(group);
        return;
      }
      sectionLines(section).forEach(line => {
        L.polyline(line, { color: '#FFFFFF', weight: 12, opacity: 0.96, lineCap: 'round', lineJoin: 'round' }).addTo(group);
        L.polyline(line, { color: '#F97316', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' })
          .bindTooltip(`${section.label} · ${Math.round(section.length_meters)} m`, { sticky: true })
          .addTo(group);
      });
      const endpoints = getSectionEndpoints(section);
      if (endpoints) {
        L.marker([endpoints.start[1], endpoints.start[0]], { icon: endpointIcon(`A${suffix}`, '#15803D'), keyboard: false }).addTo(group);
        L.marker([endpoints.end[1], endpoints.end[0]], { icon: endpointIcon(`B${suffix}`, '#B91C1C'), keyboard: false }).addTo(group);
      }
    });

    if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [32, 32], maxZoom: 18 });
    else map.setView([49.174, 10.56], 14);
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      locationLayerRef.current = null;
    };
  }, [info]);

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Dein Browser unterstützt keine Standortbestimmung.');
      return;
    }
    setLocationMessage('Standort wird bestimmt …');
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      const map = mapRef.current;
      if (!map) return;
      locationLayerRef.current?.remove();
      const layer = L.layerGroup().addTo(map);
      L.circle([latitude, longitude], { radius: accuracy, color: '#0284C7', weight: 1, fillColor: '#38BDF8', fillOpacity: 0.16 }).addTo(layer);
      L.circleMarker([latitude, longitude], { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#0284C7', fillOpacity: 1 })
        .bindTooltip('Du bist hier', { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(layer);
      locationLayerRef.current = layer;
      map.setView([latitude, longitude], Math.max(map.getZoom(), 17), { animate: true });
      setLocationMessage(`Dein Standort · Genauigkeit ca. ${Math.round(accuracy)} m`);
    }, error => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Bitte erlaube den Standortzugriff im Browser.'
        : 'Der Standort konnte gerade nicht bestimmt werden.';
      setLocationMessage(message);
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
  };

  return <section className="public-helper-map-panel" aria-label="Interaktive Karte deines Bereichs">
    <div className="public-helper-map-heading"><div><b>Dein Bereich auf der Karte</b><small>Zoomen, verschieben und der orangefarbenen Linie von A nach B folgen.</small></div><button type="button" onClick={locateMe}><Crosshair size={17} /> Mein Standort</button></div>
    <div ref={containerRef} className="public-helper-interactive-map" />
    <div className="public-helper-map-legend"><span><b className="legend-line" /> Dein Bereich</span><span><b className="legend-start">A</b> Start</span><span><b className="legend-end">B</b> Ende</span></div>
    {locationMessage && <p className="public-helper-location-status" role="status">{locationMessage}</p>}
  </section>;
};

export const PublicHelperPage: React.FC<Props> = ({ info }) => {
  const meters = info.sections.reduce((sum, section) => sum + (section.length_meters || 0), 0);

  return (
    <main className="public-helper-page">
      <section className="public-helper-card">
        <p className="auth-kicker">LICHTERNACHT BECHHOFEN</p>
        <h1>Dein Bereich</h1>
        <h2>{info.name}</h2>
        <div className="public-helper-distance">{Math.round(meters)} Meter</div>
        <p className="public-helper-intro">Bitte schmücke die folgenden Straßenabschnitte. Die farbige Linie führt jeweils eindeutig von <b>A (Start)</b> nach <b>B (Ende)</b>. Lichter und benötigtes Material bringst du selbst mit.</p>
        <div className="public-helper-sections">
          {info.sections.map((section, index) => {
            const endpoints = getSectionEndpoints(section);
            const suffix = info.sections.length > 1 ? String(index + 1) : '';
            return <div key={section.id}>
              <MapPin size={16} /><span><strong>{section.label}</strong><small>{section.street_name} · {Math.round(section.length_meters)} m</small>
                <small><b>Beleuchtung:</b> {lightingSideText(section.lighting_side)}</small>
                {endpoints && <small><b>Start A{suffix}</b> → <b>Ende B{suffix}</b> · auf der Karte markiert</small>}
              </span>
            </div>;
          })}
        </div>
        <PublicAreaMap info={info} />
        <p className="public-helper-footnote">Dieser Link zeigt ausschließlich deinen persönlichen Aufgabenbereich.</p>
      </section>
    </main>
  );
};
