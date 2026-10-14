import React, { useState } from 'react';
import { Printer, ArrowLeft, FileText, Grid, Phone, Scissors, QrCode, Clock, MapPin, CheckSquare, Sparkles, Map as MapIcon } from 'lucide-react';
import { type Section, type Helper } from '../utils/api';
import { getSectionEndpoints } from '../utils/sectionEndpoints';

interface PrintViewProps {
  sections: Section[];
  helpers: Helper[];
  candleSpacing?: number;
  candleBuffer?: number;
  publicBaseUrl?: string;
  eventName?: string;
  eventLocation?: string;
  organizerPhone?: string;
  onSavePublicBaseUrl?: (value: string) => Promise<void>;
  onClose: () => void;
}

type MapLine = { section: Section; coordinates: number[][] };

const getMapLines = (sections: Section[]): MapLine[] => sections.flatMap(section => {
  const geometry = section.geojson?.geometry;
  if (!geometry) return [] as MapLine[];
  if (geometry.type === 'LineString') return [{ section, coordinates: geometry.coordinates as number[][] }];
  if (geometry.type === 'MultiLineString') return (geometry.coordinates as number[][][]).map(coordinates => ({ section, coordinates }));
  return [] as MapLine[];
});

const lightingSideText = (section: Section) => section.lighting_side === 'left'
  ? 'nur linke Straßenseite (A → B)'
  : section.lighting_side === 'right'
    ? 'nur rechte Straßenseite (A → B)'
    : 'beide Straßenseiten';

const lightingSvgLines = (section: Section, coordinates: number[][], project: (coordinate: number[]) => number[]) => {
  // Side selection is stated in the legend and section detail. A centre-line
  // marker is intentionally used here, so road junctions stay calm and clear.
  return [coordinates.map(project)];
};

/** Separate operational map: colours remain available here to discuss who
 * covers which parts. The neutral overview below deliberately has no colours. */
const AssignmentOverviewMap: React.FC<{ sections: Section[] }> = ({ sections }) => {
  const lines = getMapLines(sections);
  const points = sections.filter(section => section.geojson?.geometry?.type === 'Point');
  const coordinates = [...lines.flatMap(line => line.coordinates), ...points.map(point => point.geojson.geometry.coordinates as number[])];
  if (!coordinates.length) return <p style={{ color: '#64748B', padding: 32 }}>Für die Zuweisungskarte sind noch keine Abschnitte vorhanden.</p>;
  const zoom = 14, tileSize = 256, worldSize = tileSize * (2 ** zoom);
  const toWorld = ([lon, lat]: number[]) => [((lon + 180) / 360) * worldSize, ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2) * worldSize];
  const worldCoordinates = coordinates.map(toWorld);
  let minX = Math.min(...worldCoordinates.map(point => point[0])); let maxX = Math.max(...worldCoordinates.map(point => point[0]));
  let minY = Math.min(...worldCoordinates.map(point => point[1])); let maxY = Math.max(...worldCoordinates.map(point => point[1]));
  const pad = Math.max(maxX - minX, maxY - minY, 500) * 0.16;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const targetRatio = 1100 / 650, currentRatio = (maxX - minX) / (maxY - minY);
  if (currentRatio < targetRatio) { const extra = ((maxY - minY) * targetRatio - (maxX - minX)) / 2; minX -= extra; maxX += extra; }
  else { const extra = ((maxX - minX) / targetRatio - (maxY - minY)) / 2; minY -= extra; maxY += extra; }
  const printZoom = 1.35, centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const halfWidth = (maxX - minX) / (2 * printZoom), halfHeight = (maxY - minY) / (2 * printZoom);
  minX = centerX - halfWidth; maxX = centerX + halfWidth; minY = centerY - halfHeight; maxY = centerY + halfHeight;
  const project = (coordinate: number[]) => { const [x, y] = toWorld(coordinate); return [((x - minX) / (maxX - minX)) * 1100, ((y - minY) / (maxY - minY)) * 650]; };
  const tiles = Array.from({ length: Math.ceil(maxX / tileSize) - Math.floor(minX / tileSize) + 1 }, (_, xIndex) =>
    Array.from({ length: Math.ceil(maxY / tileSize) - Math.floor(minY / tileSize) + 1 }, (_, yIndex) => ({ x: Math.floor(minX / tileSize) + xIndex, y: Math.floor(minY / tileSize) + yIndex }))
  ).flat();
  return <>
    <svg viewBox="0 0 1100 650" role="img" aria-label="Farbige Zuweisungskarte" style={{ width: '100%', height: 'auto', border: '1px solid #CBD5E1', borderRadius: 10, background: '#F8FAFC' }}>
      <rect width="1100" height="650" fill="#F8FAFC" />
      {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} x={((tile.x * tileSize - minX) / (maxX - minX)) * 1100} y={((tile.y * tileSize - minY) / (maxY - minY)) * 650} width={(tileSize / (maxX - minX)) * 1100} height={(tileSize / (maxY - minY)) * 650} preserveAspectRatio="none" />)}
      {lines.flatMap(({ section, coordinates: lineCoordinates }, index) => lightingSvgLines(section, lineCoordinates, project).map((points, sideIndex) => <polyline key={`${section.id}-${index}-${sideIndex}-halo`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />))}
      {lines.flatMap(({ section, coordinates: lineCoordinates }, index) => lightingSvgLines(section, lineCoordinates, project).map((points, sideIndex) => <polyline key={`${section.id}-${index}-${sideIndex}`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke={section.color || '#F59E0B'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />))}
      {points.map(point => { const [x, y] = project(point.geojson.geometry.coordinates as number[]); return <circle key={point.id} cx={x} cy={y} r="8" fill={point.color || '#F59E0B'} stroke="#FFFFFF" strokeWidth="3" />; })}
      <rect x="12" y="614" width="210" height="24" rx="4" fill="#FFFFFF" opacity=".88" /><text x="22" y="631" fill="#475569" fontSize="12">© OpenStreetMap-Mitwirkende</text>
    </svg>
    <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 11 }}>Farben zeigen die einzelnen zugewiesenen Abschnitte. Für die neutrale Außenkommunikation nutze die Beleuchtungsübersicht.</p>
  </>;
};

const directDistanceMeters = (first: number[], second: number[]) => {
  const earthRadius = 6371000;
  const lat1 = first[1] * Math.PI / 180, lat2 = second[1] * Math.PI / 180;
  const deltaLat = (second[1] - first[1]) * Math.PI / 180;
  const deltaLon = (second[0] - first[0]) * Math.PI / 180;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const buildSuggestedRound = (lines: MapLine[]) => {
  const pending = lines.filter(line => line.coordinates.length > 0).map(line => ({ ...line, coordinates: [...line.coordinates] }));
  if (!pending.length) return { links: [] as Array<{ from: number[]; to: number[] }>, connectorMeters: 0, start: null as number[] | null };
  pending.sort((a, b) => a.section.label.localeCompare(b.section.label, 'de'));
  const first = pending.shift()!;
  const start = first.coordinates[0];
  let current = first.coordinates[first.coordinates.length - 1];
  const links: Array<{ from: number[]; to: number[] }> = [];
  let connectorMeters = 0;
  while (pending.length) {
    let bestIndex = 0, useReverse = false, bestDistance = Number.POSITIVE_INFINITY;
    pending.forEach((candidate, index) => {
      const toStart = directDistanceMeters(current, candidate.coordinates[0]);
      const toEnd = directDistanceMeters(current, candidate.coordinates[candidate.coordinates.length - 1]);
      if (toStart < bestDistance) { bestIndex = index; useReverse = false; bestDistance = toStart; }
      if (toEnd < bestDistance) { bestIndex = index; useReverse = true; bestDistance = toEnd; }
    });
    const next = pending.splice(bestIndex, 1)[0];
    const oriented = useReverse ? [...next.coordinates].reverse() : next.coordinates;
    if (bestDistance > 3) links.push({ from: current, to: oriented[0] });
    connectorMeters += bestDistance;
    current = oriented[oriented.length - 1];
  }
  const returnDistance = directDistanceMeters(current, start);
  if (returnDistance > 3) links.push({ from: current, to: start });
  return { links, connectorMeters: connectorMeters + returnDistance, start };
};

const NeutralOverviewMap: React.FC<{ sections: Section[] }> = ({ sections }) => {
  const lines = getMapLines(sections);
  const points = sections.filter(section => section.geojson?.geometry?.type === 'Point');
  const coordinates = [...lines.flatMap(line => line.coordinates), ...points.map(point => point.geojson.geometry.coordinates as number[])];
  if (!coordinates.length) return <p style={{ color: '#64748B', padding: 32 }}>Für die Gesamtkarte sind noch keine Abschnitte vorhanden.</p>;
  const zoom = 14;
  const tileSize = 256;
  const worldSize = tileSize * (2 ** zoom);
  const toWorld = ([lon, lat]: number[]) => [((lon + 180) / 360) * worldSize, ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2) * worldSize];
  const worldCoordinates = coordinates.map(toWorld);
  let minX = Math.min(...worldCoordinates.map(point => point[0])); let maxX = Math.max(...worldCoordinates.map(point => point[0]));
  let minY = Math.min(...worldCoordinates.map(point => point[1])); let maxY = Math.max(...worldCoordinates.map(point => point[1]));
  const pad = Math.max(maxX - minX, maxY - minY, 500) * 0.16;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const targetRatio = 1100 / 650;
  const currentRatio = (maxX - minX) / (maxY - minY);
  if (currentRatio < targetRatio) { const extra = ((maxY - minY) * targetRatio - (maxX - minX)) / 2; minX -= extra; maxX += extra; }
  else { const extra = ((maxX - minX) / targetRatio - (maxY - minY)) / 2; minY -= extra; maxY += extra; }
  // Deliberately zoom closer to the active planning area for the paper format.
  const printZoom = 1.35;
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const halfWidth = (maxX - minX) / (2 * printZoom), halfHeight = (maxY - minY) / (2 * printZoom);
  minX = centerX - halfWidth; maxX = centerX + halfWidth; minY = centerY - halfHeight; maxY = centerY + halfHeight;
  const project = (coordinate: number[]) => { const [x, y] = toWorld(coordinate); return [((x - minX) / (maxX - minX)) * 1100, ((y - minY) / (maxY - minY)) * 650]; };
  const tiles = Array.from({ length: Math.ceil(maxX / tileSize) - Math.floor(minX / tileSize) + 1 }, (_, xIndex) =>
    Array.from({ length: Math.ceil(maxY / tileSize) - Math.floor(minY / tileSize) + 1 }, (_, yIndex) => ({ x: Math.floor(minX / tileSize) + xIndex, y: Math.floor(minY / tileSize) + yIndex }))
  ).flat();
  const suggestedRound = buildSuggestedRound(lines);
  const walkingMeters = Math.round(sections.reduce((sum, section) => sum + Number(section.length_meters ?? section.lengthMeters ?? 0), 0) + suggestedRound.connectorMeters);
  const walkingMinutes = Math.max(1, Math.round(walkingMeters / 75));

  return <>
    <svg viewBox="0 0 1100 650" role="img" aria-label="Neutrale Beleuchtungsübersicht mit vorgeschlagenem Rundweg" style={{ width: '100%', height: 'auto', border: '1px solid #CBD5E1', borderRadius: 10, background: '#F8FAFC' }}>
      <defs><marker id="round-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="#D97706" /></marker></defs>
      <rect width="1100" height="650" fill="#F8FAFC" />
      {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} x={((tile.x * tileSize - minX) / (maxX - minX)) * 1100} y={((tile.y * tileSize - minY) / (maxY - minY)) * 650} width={(tileSize / (maxX - minX)) * 1100} height={(tileSize / (maxY - minY)) * 650} preserveAspectRatio="none" />)}
      {lines.flatMap(({ section, coordinates: lineCoordinates }, index) => lightingSvgLines(section, lineCoordinates, project).map((points, sideIndex) => <polyline key={`${section.id}-${index}-${sideIndex}`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />))}
      {lines.flatMap(({ section, coordinates: lineCoordinates }, index) => lightingSvgLines(section, lineCoordinates, project).map((points, sideIndex) => <polyline key={`${section.id}-${index}-${sideIndex}-line`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#334155" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />))}
      {suggestedRound.links.map((link, index) => <line key={`round-${index}`} x1={project(link.from)[0]} y1={project(link.from)[1]} x2={project(link.to)[0]} y2={project(link.to)[1]} stroke="#D97706" strokeWidth="3" strokeDasharray="8 7" opacity=".95" markerEnd="url(#round-arrow)" />)}
      {suggestedRound.start && (() => { const [x, y] = project(suggestedRound.start!); return <g><circle cx={x} cy={y} r="12" fill="#15803D" stroke="#FFFFFF" strokeWidth="3" /><text x={x} y={y + 4} fontSize="10" fontWeight="900" fill="#FFFFFF" textAnchor="middle">S</text></g>; })()}
      {points.map(point => { const [x, y] = project(point.geojson.geometry.coordinates as number[]); return <circle key={point.id} cx={x} cy={y} r="8" fill="#334155" stroke="#FFFFFF" strokeWidth="3" />; })}
      <rect x="12" y="614" width="210" height="24" rx="4" fill="#FFFFFF" opacity=".88" /><text x="22" y="631" fill="#475569" fontSize="12">© OpenStreetMap-Mitwirkende</text>
    </svg>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '10px 0 0', color: '#475569', fontSize: 11 }}>
      <span><b style={{ color: '#334155' }}>Dunkle Linien:</b> Beleuchtungsbereiche · <b style={{ color: '#D97706' }}>gestrichelte Pfeile:</b> Rundweg · <b style={{ color: '#15803D' }}>S:</b> Start</span>
      <span style={{ whiteSpace: 'nowrap', fontWeight: 800, color: '#0F172A' }}>ca. {walkingMeters.toLocaleString('de-DE')} m · {walkingMinutes} Min.</span>
    </div>
    <p style={{ margin: '5px 0 0', color: '#64748B', fontSize: 10 }}>Grobe Gehzeit bei etwa 4,5 km/h inklusive aller markierten Abschnitte. Der Rundweg ist ein Orientierungs-Vorschlag; Verbindungen zwischen Bereichen sind näherungsweise dargestellt.</p>
  </>;
};

const endpointCodes = (sections: Section[], section: Section) => {
  const endpoints = getSectionEndpoints(section);
  if (!endpoints || section.geojson.geometry.type === 'Point') return null;
  const lineSections = sections.filter(candidate => candidate.geojson?.geometry?.type !== 'Point');
  const index = lineSections.findIndex(candidate => candidate.id === section.id);
  const suffix = lineSections.length > 1 ? String(index + 1) : '';
  return { start: `A${suffix}`, end: `B${suffix}`, endpoints };
};

const HelperAreaMap: React.FC<{ sections: Section[]; color?: string; height: number }> = ({ sections, color = '#D97706', height }) => {
  const geometries = sections.flatMap(section => {
    const geometry = section.geojson?.geometry;
    if (!geometry) return [] as Array<{ section: Section; type: string; coordinates: number[][] }>;
    if (geometry.type === 'LineString') return [{ section, type: geometry.type, coordinates: geometry.coordinates as number[][] }];
    if (geometry.type === 'MultiLineString') return (geometry.coordinates as number[][][]).map(coordinates => ({ section, type: geometry.type, coordinates }));
    if (geometry.type === 'Point') return [{ section, type: geometry.type, coordinates: [geometry.coordinates as number[]] }];
    return [] as Array<{ section: Section; type: string; coordinates: number[][] }>;
  });
  const allCoordinates = geometries.flatMap(geometry => geometry.coordinates);
  if (!allCoordinates.length) return <div style={{ height, display: 'grid', placeItems: 'center', color: '#64748B', border: '1px solid #CBD5E1', borderRadius: 7 }}>Karte nicht verfügbar</div>;
  // Compact 2:1 map format, but close enough that the coloured own section
  // and its immediate neighbouring streets can be recognised at a glance.
  const zoom = 18, tileSize = 256, worldSize = tileSize * (2 ** zoom), width = height * 2;
  const toWorld = ([lon, lat]: number[]) => [((lon + 180) / 360) * worldSize, ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2) * worldSize];
  const worlds = allCoordinates.map(toWorld);
  const centerX = worlds.reduce((sum, point) => sum + point[0], 0) / worlds.length;
  const centerY = worlds.reduce((sum, point) => sum + point[1], 0) / worlds.length;
  const project = (coordinate: number[]) => { const [x, y] = toWorld(coordinate); return [width / 2 + x - centerX, height / 2 + y - centerY]; };
  const centerTileX = Math.floor(centerX / tileSize), centerTileY = Math.floor(centerY / tileSize);
  const tiles = [-2, -1, 0, 1, 2].flatMap(dx => [-1, 0, 1].map(dy => ({ x: centerTileX + dx, y: centerTileY + dy })));
  const endpointMarkers = sections.flatMap(section => {
    const codes = endpointCodes(sections, section);
    if (!codes) return [];
    return [
      { coordinate: codes.endpoints.start, label: codes.start, kind: 'start' },
      { coordinate: codes.endpoints.end, label: codes.end, kind: 'end' }
    ];
  });
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kartenausschnitt des zugewiesenen Bereichs" style={{ width: '100%', height: 'auto', aspectRatio: '2 / 1', display: 'block', borderRadius: 7, border: '1px solid #CBD5E1', background: '#F8FAFC' }}>
    {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} x={width / 2 + tile.x * tileSize - centerX} y={height / 2 + tile.y * tileSize - centerY} width={tileSize} height={tileSize} />)}
    {geometries.filter(geometry => geometry.type !== 'Point').flatMap((geometry, index) => lightingSvgLines(geometry.section, geometry.coordinates, project).map((points, sideIndex) => <polyline key={`outline-${index}-${sideIndex}`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />))}
    {geometries.filter(geometry => geometry.type !== 'Point').flatMap((geometry, index) => lightingSvgLines(geometry.section, geometry.coordinates, project).map((points, sideIndex) => <polyline key={`line-${index}-${sideIndex}`} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />))}
    {geometries.filter(geometry => geometry.type === 'Point').map((geometry, index) => { const [x, y] = project(geometry.coordinates[0]); return <circle key={`point-${index}`} cx={x} cy={y} r="8" fill={color} stroke="#FFFFFF" strokeWidth="3" />; })}
    {endpointMarkers.map((marker, index) => {
      const [x, y] = project(marker.coordinate);
      const fill = marker.kind === 'start' ? '#15803D' : '#B91C1C';
      return <g key={`${marker.label}-${index}`}>
        <circle cx={x} cy={y} r="11" fill="#FFFFFF" stroke={fill} strokeWidth="3" />
        <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill={fill}>{marker.label}</text>
      </g>;
    })}
    <rect x="8" y={height - 25} width="330" height="18" rx="3" fill="#FFFFFF" opacity=".92" /><text x="14" y={height - 12} fontSize="10" fill="#475569">Farbige Linie(n): dein Bereich · A: Start · B: Ende</text>
  </svg>;
};

export const PrintView: React.FC<PrintViewProps> = ({
  sections,
  helpers,
  candleSpacing = 2.0,
  candleBuffer = 10,
  publicBaseUrl = '',
  eventName = 'Lichternacht Bechhofen',
  eventLocation = 'Bechhofen a.d. Heide (PLZ 91572)',
  organizerPhone = '',
  onSavePublicBaseUrl,
  onClose
}) => {
  const [printLayout, setPrintLayout] = useState<'table' | 'assignment-map' | 'overview-map' | 'cards' | 'sheets'>('sheets');
  const [publicUrlInput, setPublicUrlInput] = useState(publicBaseUrl);
  const [meetingTime, setMeetingTime] = useState<string>('17:30 Uhr Materialausgabe • 18:15 Uhr Entzünden');

  const totalMeters = sections.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
  const unassignedSections = sections.filter(s => !s.assigned_helper_id);

  // Group sections by assigned helper
  const helperGroups = helpers
    .map(helper => {
      const assigned = sections.filter(s => s.assigned_helper_id === helper.id);
      const meters = assigned.reduce((sum, s) => sum + (s.length_meters ?? (s as any).lengthMeters ?? 0), 0);
      const candles = assigned.reduce((sum, s) => {
        const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
        if (s.type === 'point') return sum + 20;
        return sum + (len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0);
      }, 0);
      return {
        helper,
        sections: assigned,
        meters,
        candles
      };
    })
    .filter(g => g.sections.length > 0)
    .sort((a, b) => a.helper.name.localeCompare(b.helper.name, 'de'));

  const totalCandlesBase = sections.reduce((sum, s) => {
    const len = s.length_meters ?? (s as any).lengthMeters ?? 0;
    if (s.type === 'point') return sum + 20;
    return sum + (len > 0 ? Math.max(1, Math.round(len / candleSpacing)) : 0);
  }, 0);
  const totalCandlesWithBuffer = Math.round(totalCandlesBase * (1 + candleBuffer / 100));

  const currentDate = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // Helper to construct maps link for QR code
  const getMapsUrlForGroup = (groupSections: Section[]) => {
    const firstSec = groupSections[0];
    if (!firstSec) return 'https://www.google.com/maps/search/Bechhofen';

    if (firstSec.geojson?.geometry?.type === 'LineString') {
      const coords = firstSec.geojson.geometry.coordinates;
      if (coords && coords.length > 0) {
        const lon = coords[0][0];
        const lat = coords[0][1];
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      }
    } else if (firstSec.geojson?.geometry?.type === 'Point') {
      const coords = firstSec.geojson.geometry.coordinates;
      return `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[0]}`;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Bechhofen ' + (firstSec.street_name || 'Marktplatz'))}`;
  };

  const getFirstCoordinate = (groupSections: Section[]): [number, number] | null => {
    const geometry = groupSections[0]?.geojson?.geometry;
    if (!geometry) return null;
    if (geometry.type === 'LineString') return geometry.coordinates[0] as [number, number];
    if (geometry.type === 'MultiLineString') return geometry.coordinates[0]?.[0] as [number, number] || null;
    if (geometry.type === 'Point') return geometry.coordinates as [number, number];
    return null;
  };

  const getPublicHelperUrl = (token?: string | null) => {
    const base = (publicBaseUrl || window.location.origin).replace(/\/$/, '');
    return token ? `${base}/helfer/${encodeURIComponent(token)}` : base;
  };

  const getMapImageUrl = (groupSections: Section[]) => {
    const coordinate = getFirstCoordinate(groupSections);
    if (!coordinate) return '';
    const [lon, lat] = coordinate;
    const zoom = 16;
    const tileX = Math.floor(((lon + 180) / 360) * (2 ** zoom));
    const tileY = Math.floor(((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2) * (2 ** zoom));
    return `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
  };

  return (
    <div
      className="print-view-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#FFFFFF',
        color: '#0F172A',
        overflowY: 'auto',
        fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif"
      }}
    >
      <style>{`
        @media print {
          @page {
            margin: 10mm;
            size: A4 portrait;
          }
          body {
            background: #FFFFFF !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body, #root, .planner-shell {
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          .print-view-root {
            position: static !important;
            inset: auto !important;
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .no-print {
            display: none !important;
          }
          .print-card {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .helper-info-sheet {
            break-after: page !important;
            page-break-after: always !important;
          }
          .helper-info-sheet:last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }
        }
      `}</style>

      {/* TOP ACTION BAR (Hidden during printing) */}
      <div
        className="no-print"
        style={{
          position: 'sticky',
          top: 0,
          background: '#0F172A',
          color: '#FFFFFF',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          zIndex: 100,
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#FFFFFF',
              padding: '6px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600
            }}
          >
            <ArrowLeft size={16} />
            Zurück zur Karte
          </button>

          {/* Layout Mode Switcher */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', padding: 3, borderRadius: 6, gap: 4 }}>
            <button
              onClick={() => setPrintLayout('cards')}
              style={{
                padding: '5px 12px',
                borderRadius: 4,
                border: 'none',
                background: printLayout === 'cards' ? '#F59E0B' : 'transparent',
                color: printLayout === 'cards' ? '#0F172A' : '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <Scissors size={14} />
              Abreiß-Kärtchen (mit QR-Code)
            </button>

            <button
              onClick={() => setPrintLayout('sheets')}
              style={{
                padding: '5px 12px',
                borderRadius: 4,
                border: 'none',
                background: printLayout === 'sheets' ? '#F59E0B' : 'transparent',
                color: printLayout === 'sheets' ? '#0F172A' : '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <Grid size={14} />
              Helfer-Info (A5)
            </button>

            <button
              onClick={() => setPrintLayout('assignment-map')}
              style={{
                padding: '5px 12px', borderRadius: 4, border: 'none',
                background: printLayout === 'assignment-map' ? '#F59E0B' : 'transparent',
                color: printLayout === 'assignment-map' ? '#0F172A' : '#FFFFFF', fontWeight: 700, fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5
              }}
            >
              <MapIcon size={14} /> Zuweisungskarte
            </button>

            <button
              onClick={() => setPrintLayout('overview-map')}
              style={{
                padding: '5px 12px', borderRadius: 4, border: 'none',
                background: printLayout === 'overview-map' ? '#F59E0B' : 'transparent',
                color: printLayout === 'overview-map' ? '#0F172A' : '#FFFFFF', fontWeight: 700, fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5
              }}
            >
              <MapIcon size={14} /> Beleuchtungsübersicht
            </button>

            <button
              onClick={() => setPrintLayout('table')}
              style={{
                padding: '5px 12px',
                borderRadius: 4,
                border: 'none',
                background: printLayout === 'table' ? '#F59E0B' : 'transparent',
                color: printLayout === 'table' ? '#0F172A' : '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <FileText size={14} />
              Gesamtübersicht (Tabelle)
            </button>
          </div>
        </div>

        {/* Action Buttons & Config Inputs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {organizerPhone && <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: 6 }}>
            <Phone size={13} color="#F59E0B" />
            <span style={{ color: '#FFFFFF', fontSize: 11 }}>{organizerPhone}</span>
          </div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: 6 }}>
            <MapPin size={13} color="#38BDF8" />
            <input
              type="url"
              value={publicUrlInput}
              onChange={e => setPublicUrlInput(e.target.value)}
              onBlur={() => onSavePublicBaseUrl?.(publicUrlInput.trim())}
              placeholder="https://plan.lichternacht.de"
              title="Öffentliche Basis-URL für QR-Codes und spätere E-Mails"
              style={{ background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: 11, outline: 'none', width: 210 }}
            />
          </div>

          <button
            onClick={() => window.print()}
            style={{
              background: '#F59E0B',
              color: '#0F172A',
              border: 'none',
              padding: '8px 18px',
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 8px rgba(245,158,11,0.4)'
            }}
          >
            <Printer size={16} />
            Jetzt drucken / PDF erstellen
          </button>
        </div>
      </div>

      {/* PRINT CONTENT CONTAINER */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>
        {/* DOCUMENT HEADER */}
        <div style={{ borderBottom: '3px solid #0F172A', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0F172A', margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                {eventName}
              </h1>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#D97706', marginTop: 4 }}>
                {printLayout === 'table'
                  ? 'Offizieller Strecken- & Helfer-Einsatzplan'
                  : printLayout === 'assignment-map'
                  ? 'Gesamtkarte der Helfer-Zuweisungen'
                  : printLayout === 'overview-map'
                  ? 'Beleuchtungsübersicht mit Rundweg'
                  : printLayout === 'cards'
                  ? 'Kompakte Helfer-Informationen mit Karte & QR-Code'
                  : 'Persönliche Helfer-Informationen (A5)'}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
              <div>Stand: <b>{currentDate}</b></div>
              <div>Gemeinde Bechhofen a.d. Heide</div>
              {eventLocation && <div style={{ color: '#475569', fontWeight: 600, marginTop: 2 }}>{eventLocation}</div>}
              {organizerPhone && <div style={{ color: '#0F172A', fontWeight: 600, marginTop: 2 }}>📞 {organizerPhone}</div>}
            </div>
          </div>

          {/* Quick Summary Box */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              marginTop: 14,
              background: '#F8FAFC',
              padding: 10,
              borderRadius: 8,
              border: '1px solid #E2E8F0'
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Gesamtstrecke</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{totalMeters.toLocaleString('de-DE')} m</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Eingeteilte Helfer</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{helperGroups.length} Personen</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Gesamtabschnitte</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{sections.length} Abschnitte</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#D97706', textTransform: 'uppercase', fontWeight: 700 }}>Lichter-Bedarf</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#D97706' }}>{totalCandlesWithBuffer.toLocaleString('de-DE')} Stk.</div>
              <div style={{ fontSize: 9, color: '#64748B' }}>inkl. {candleBuffer}% Puffer</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Offen / Frei</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: unassignedSections.length > 0 ? '#DC2626' : '#16A34A' }}>
                {unassignedSections.length}
              </div>
            </div>
          </div>
        </div>

        {/* LAYOUT: PRINTABLE COLOUR ASSIGNMENT MAP */}
        {printLayout === 'assignment-map' && (
          <div className="assignment-map-page" style={{ pageBreakAfter: 'always' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', letterSpacing: '0.04em' }}>Wer übernimmt welchen Abschnitt?</h2>
              <span style={{ fontSize: 11, color: '#64748B' }}>Für den Ausdruck idealerweise „Querformat“ wählen</span>
            </div>
            <AssignmentOverviewMap sections={sections} />
          </div>
        )}

        {/* LAYOUT: NEUTRAL PRINTABLE LIGHTING MAP */}
        {printLayout === 'overview-map' && (
          <div className="overview-map-page" style={{ pageBreakAfter: 'always' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', letterSpacing: '0.04em' }}>Welche Bereiche werden beleuchtet?</h2>
              <span style={{ fontSize: 11, color: '#64748B' }}>Für den Ausdruck idealerweise „Querformat“ wählen</span>
            </div>
            <NeutralOverviewMap sections={sections} />
          </div>
        )}

        {/* LAYOUT 1: TABLE OVERVIEW */}
        {printLayout === 'table' && (
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', marginBottom: 10, letterSpacing: '0.04em' }}>
              Einteilung nach Helfern:
            </h2>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 24 }}>
              <thead>
                <tr style={{ background: '#0F172A', color: '#FFFFFF', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', width: '22%' }}>Helfer-Name</th>
                  <th style={{ padding: '8px 10px', width: '10%', textAlign: 'right' }}>Strecke</th>
                  <th style={{ padding: '8px 10px', width: '12%', textAlign: 'right' }}>Lichter</th>
                  <th style={{ padding: '8px 10px', width: '38%' }}>Zugeteilte Straßen & Abschnitte</th>
                  <th style={{ padding: '8px 10px', width: '18%', textAlign: 'center' }}>Ausgabe / Quittung</th>
                </tr>
              </thead>
              <tbody>
                {helperGroups.map((group, idx) => (
                  <tr
                    key={group.helper.id}
                    style={{
                      borderBottom: '1px solid #CBD5E1',
                      background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <td style={{ padding: '8px 10px', fontWeight: 700, verticalAlign: 'top', color: '#0F172A' }}>
                      <div style={{ fontSize: 13 }}>{group.helper.name}</div>
                      {group.helper.phone && (
                        <div style={{ fontSize: 10, color: '#64748B', fontWeight: 400 }}>Tel: {group.helper.phone}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#D97706', verticalAlign: 'top' }}>
                      {group.meters} m
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#059669', verticalAlign: 'top' }}>
                      ~{group.candles} Stk.
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {group.sections.map(s => (
                          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>● <b>{s.label}</b> ({s.street_name} · {lightingSideText(s)})</span>
                            <span style={{ color: '#64748B' }}>{Math.round(s.length_meters ?? (s as any).lengthMeters ?? 0)} m</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'top', textAlign: 'center' }}>
                      <div style={{ borderBottom: '1px dashed #94A3B8', height: 16, width: '90%', margin: '0 auto 3px' }} />
                      <div style={{ fontSize: 9, color: '#64748B' }}>[ ] Erhalten: ____ Stk.</div>
                    </td>
                  </tr>
                ))}

                {helperGroups.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748B' }}>
                      Noch keine Helfer zugewiesen. Nutze die 1-Klick Auto-Zuweisung!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* LAYOUT 2: ABREISS-KÄRTCHEN (MIT QR-CODE & SCHNITTMARKEN) */}
        {printLayout === 'cards' && (
          <div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }} className="no-print">
              💡 <b>Tipp:</b> Kompakte A6-Informationen zum Ausschneiden – mit Karten-Ausschnitt und persönlichem QR-Code.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 16
              }}
            >
              {helperGroups.map(group => {
                const publicUrl = getPublicHelperUrl(group.helper.public_token);
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&margin=2&data=${encodeURIComponent(publicUrl)}`;

                return (
                  <div
                    key={group.helper.id}
                    className="print-card"
                    style={{
                      border: '2px dashed #94A3B8',
                      borderRadius: 8,
                      padding: 14,
                      background: '#FFFFFF',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      position: 'relative'
                    }}
                  >
                    {/* Cut line decoration */}
                    <div
                      style={{
                        position: 'absolute',
                        top: -10,
                        right: 14,
                        background: '#FFFFFF',
                        padding: '0 4px',
                        fontSize: 10,
                        color: '#64748B',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                    >
                      <Scissors size={12} />
                      <span>Hier schneiden</span>
                    </div>

                    <div>
                      {/* Card Header */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          borderBottom: '2px solid #0F172A',
                          paddingBottom: 8,
                          marginBottom: 8
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {eventName} • Helfer-Pass
                          </div>
                          <div style={{ fontSize: 17, fontWeight: 900, color: '#0F172A', lineHeight: 1.2 }}>
                            {group.helper.name}
                          </div>
                          {group.helper.phone && (
                            <div style={{ fontSize: 10, color: '#64748B' }}>Helfer-Tel: {group.helper.phone}</div>
                          )}
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: '#D97706' }}>
                            {group.meters} m
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: '#059669',
                              background: '#ECFDF5',
                              padding: '1px 6px',
                              borderRadius: 4,
                              marginTop: 2
                            }}
                          >
                            Dein Bereich
                          </div>
                        </div>
                      </div>

                      {/* Map, section and QR information */}
                      <div style={{ marginBottom: 8 }}><HelperAreaMap sections={group.sections} color={group.helper.color} height={170} /></div>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                        {/* Sections List */}
                        <div style={{ flex: 1, fontSize: 11 }}>
                          <div style={{ fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                            📍 Zugewiesene Abschnitte:
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {group.sections.map(sec => {
                              const sLen = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
                              const codes = endpointCodes(group.sections, sec);
                              return (
                                <div
                                  key={sec.id}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '3px 6px',
                                    background: '#F8FAFC',
                                    borderRadius: 4,
                                    border: '1px solid #E2E8F0'
                                  }}
                                >
                                  <div>
                                    <b>{sec.label}</b>
                                    <div style={{ fontSize: 9, color: '#64748B' }}>{sec.street_name}</div>
                                    <div style={{ fontSize: 9, color: '#475569', fontWeight: 700 }}>{lightingSideText(sec)}</div>
                                    {codes && <div style={{ fontSize: 9, fontWeight: 800, color: '#475569', marginTop: 1 }}>Von {codes.start} bis {codes.end}</div>}
                                  </div>
                                  <div style={{ textAlign: 'right', fontWeight: 700, color: '#475569' }}>
                                    {sLen} m
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* QR-Code Box */}
                        <div
                          style={{
                            width: 86,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#F8FAFC',
                            padding: 4,
                            borderRadius: 6,
                            border: '1px solid #E2E8F0'
                          }}
                        >
                          <img
                            src={qrUrl}
                            alt="QR-Code zur Helfer-Information"
                            style={{ width: 72, height: 72, borderRadius: 4 }}
                            onError={(e) => {
                              // If offline, hide broken image
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <span style={{ fontSize: 8, fontWeight: 700, color: '#64748B', textAlign: 'center', marginTop: 2 }}>
                            QR-Code zur Info-Seite
                          </span>
                          <span style={{ fontSize: 7, color: '#475569', textAlign: 'center', overflowWrap: 'anywhere', lineHeight: 1.1 }}>{publicUrl}</span>
                        </div>
                      </div>
                    </div>

                    {/* Card footer: concise obligation and coordination reminder */}
                    <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 6, marginTop: 4, fontSize: 10, color: '#475569' }}>
                      <div><b>Kerzenbeleuchtung ist verpflichtend.</b> Bitte Lichter und Material selbst besorgen.</div>
                      <div style={{ fontSize: 9, color: '#64748B', borderTop: '1px dotted #CBD5E1', paddingTop: 4, marginTop: 4 }}>Mit angrenzenden Mitwirkenden abstimmen, damit die Beleuchtung durchgängig bleibt.</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* LAYOUT 3: AUSFÜHRLICHE LAUFZETTEL (A5 FORMAT) */}
        {printLayout === 'sheets' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {helperGroups.map(group => {
                const publicUrl = getPublicHelperUrl(group.helper.public_token);
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&margin=2&data=${encodeURIComponent(publicUrl)}`;

                return (
                  <div
                    key={group.helper.id}
                    className="print-card helper-info-sheet"
                    style={{
                      border: '2px solid #0F172A',
                      borderRadius: 10,
                      padding: 20,
                      background: '#FFFFFF',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid',
                      minHeight: '185mm',
                      pageBreakAfter: 'always'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0F172A', paddingBottom: 10, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#D97706', textTransform: 'uppercase' }}>
                          {eventName} • Dein Bereich
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#0F172A' }}>
                          {group.helper.name}
                        </div>
                        {group.helper.phone && <div style={{ fontSize: 11, color: '#64748B' }}>Helfer-Kontakt: {group.helper.phone}</div>}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#D97706' }}>
                          {group.meters} Meter
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#059669', background: '#ECFDF5', padding: '2px 8px', borderRadius: 4, marginTop: 2 }}>
                          Persönliche Helfer-Information
                        </div>
                      </div>
                    </div>

                    {/* Information only – no material issue or confirmation */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: 10, borderRadius: 6, marginBottom: 14, fontSize: 11 }}>
                      <div>
                        <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>🕯️ Kerzenbeleuchtung:</div>
                        <div>• Die Beleuchtung deines ausgewiesenen Bereichs ist verpflichtend.</div>
                        <div>• Deinen Bereich findest du auf diesem Plan sowie über den QR-Code.</div>
                        <div>• Lichter und benötigtes Material bitte selbst besorgen.</div>
                        <div>• Stimme dich mit angrenzenden Mitwirkenden ab, damit die Kerzenbeleuchtung durchgängig bleibt.</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 142px', gap: 14, marginBottom: 14, alignItems: 'start' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Kartenausschnitt deines Bereichs</div>
                        <HelperAreaMap sections={group.sections} color={group.helper.color} height={320} />
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 5, lineHeight: 1.4 }}><b>A</b> markiert den Start und <b>B</b> das Ende. Folge der farbigen Linie genau von A nach B.</div>
                      </div>
                      <div style={{ border: '1px solid #CBD5E1', borderRadius: 7, padding: 8, textAlign: 'center', background: '#F8FAFC' }}>
                        <img src={qrUrl} alt="QR-Code zur Helfer-Information" style={{ width: 124, height: 124 }} />
                        <div style={{ fontSize: 9, fontWeight: 800, marginTop: 4 }}>QR-Code zur Info-Seite</div>
                        <div style={{ fontSize: 8, color: '#475569', overflowWrap: 'anywhere', marginTop: 4 }}>{publicUrl}</div>
                      </div>
                    </div>

                    {/* Detailed Sections List */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
                        Dein Streckenbereich:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {group.sections.map((sec, sIdx) => {
                          const sLen = Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0);
                          const codes = endpointCodes(group.sections, sec);
                          return (
                            <div
                              key={sec.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                borderRadius: 6
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 800, fontSize: 13 }}>#{sIdx + 1} {sec.label}</span>
                                <span style={{ color: '#64748B', fontSize: 12, marginLeft: 8 }}>({sec.street_name})</span>
                                <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, marginTop: 2 }}>Beleuchtung: {lightingSideText(sec)}</div>
                                {codes && <div style={{ fontSize: 11, color: '#334155', fontWeight: 700, marginTop: 3 }}>Von Punkt {codes.start} bis Punkt {codes.end} entlang der farbigen Linie.</div>}
                                {sec.notes && <div style={{ fontSize: 10, color: '#D97706' }}>Hinweis: {sec.notes}</div>}
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontWeight: 800, fontSize: 13, color: '#0F172A' }}>{sLen} m</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid #CBD5E1', paddingTop: 10, fontSize: 11, color: '#475569' }}>
                      Wir zählen auf eine zuverlässige Umsetzung. Diese Information dient zur Orientierung; eine Rückmeldung oder Unterschrift ist nicht erforderlich.
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* UNASSIGNED SECTIONS WARNING (IF ANY) */}
        {unassignedSections.length > 0 && (
          <div style={{ pageBreakInside: 'avoid', marginTop: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 800, color: '#DC2626', marginBottom: 6, textTransform: 'uppercase' }}>
              ⚠️ Noch offene / unbesetzte Abschnitte ({unassignedSections.length}):
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#FEE2E2', color: '#991B1B', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Abschnitt</th>
                  <th style={{ padding: '6px 8px' }}>Straße</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Länge</th>
                  <th style={{ padding: '6px 8px' }}>Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {unassignedSections.map(sec => (
                  <tr key={sec.id} style={{ borderBottom: '1px solid #FECACA' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{sec.label}</td>
                    <td style={{ padding: '6px 8px' }}>{sec.street_name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{Math.round(sec.length_meters ?? (sec as any).lengthMeters ?? 0)} m</td>
                    <td style={{ padding: '6px 8px', color: '#64748B' }}>{sec.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FOOTER */}
        <div
          style={{
            marginTop: 30,
            paddingTop: 10,
            borderTop: '1px solid #E2E8F0',
            fontSize: 10,
            color: '#94A3B8',
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          <div>Lichternacht Streckenplaner • Gemeinde Bechhofen</div>
          <div>Stand: {currentDate}</div>
        </div>
      </div>
    </div>
  );
};
