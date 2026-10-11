import React, { useEffect, useState } from 'react';
import { Printer, ArrowLeft, FileText, Grid, Phone, Scissors, QrCode, Clock, MapPin, CheckSquare, Sparkles, Map as MapIcon } from 'lucide-react';
import { api, type Section, type Helper } from '../utils/api';

interface PrintViewProps {
  sections: Section[];
  helpers: Helper[];
  candleSpacing?: number;
  candleBuffer?: number;
  publicBaseUrl?: string;
  onSavePublicBaseUrl?: (value: string) => Promise<void>;
  onClose: () => void;
}

const AssignmentOverviewMap: React.FC<{ sections: Section[]; helpers: Helper[] }> = ({ sections }) => {
  const lines = sections.flatMap(section => {
    const geometry = section.geojson?.geometry;
    if (!geometry) return [] as Array<{ section: Section; coordinates: number[][] }>;
    if (geometry.type === 'LineString') return [{ section, coordinates: geometry.coordinates as number[][] }];
    if (geometry.type === 'MultiLineString') return (geometry.coordinates as number[][][]).map(coordinates => ({ section, coordinates }));
    return [] as Array<{ section: Section; coordinates: number[][] }>;
  });
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

  return <>
    <svg viewBox="0 0 1100 650" role="img" aria-label="Gesamtkarte der zu beleuchtenden Straßen" style={{ width: '100%', height: 'auto', border: '1px solid #CBD5E1', borderRadius: 10, background: '#F8FAFC' }}>
      <rect width="1100" height="650" fill="#F8FAFC" />
      {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} x={((tile.x * tileSize - minX) / (maxX - minX)) * 1100} y={((tile.y * tileSize - minY) / (maxY - minY)) * 650} width={(tileSize / (maxX - minX)) * 1100} height={(tileSize / (maxY - minY)) * 650} preserveAspectRatio="none" />)}
      {lines.map(({ section, coordinates: lineCoordinates }, index) => <polyline key={`${section.id}-${index}`} points={lineCoordinates.map(project).map(point => point.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />)}
      {lines.map(({ section, coordinates: lineCoordinates }, index) => <polyline key={`${section.id}-${index}-line`} points={lineCoordinates.map(project).map(point => point.join(',')).join(' ')} fill="none" stroke={section.color || '#F59E0B'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />)}
      {points.map(point => { const [x, y] = project(point.geojson.geometry.coordinates as number[]); return <circle key={point.id} cx={x} cy={y} r="8" fill={point.color || '#F59E0B'} stroke="#FFFFFF" strokeWidth="3" />; })}
      <rect x="12" y="614" width="210" height="24" rx="4" fill="#FFFFFF" opacity=".88" /><text x="22" y="631" fill="#475569" fontSize="12">© OpenStreetMap-Mitwirkende</text>
    </svg>
    <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 11 }}>Farbig markiert sind die Straßenabschnitte, die zur Lichternacht beleuchtet werden.</p>
  </>;
};

const HelperAreaMap: React.FC<{ sections: Section[]; color?: string; height: number }> = ({ sections, color = '#D97706', height }) => {
  const geometries = sections.flatMap(section => {
    const geometry = section.geojson?.geometry;
    if (!geometry) return [] as Array<{ type: string; coordinates: number[][] }>;
    if (geometry.type === 'LineString') return [{ type: geometry.type, coordinates: geometry.coordinates as number[][] }];
    if (geometry.type === 'MultiLineString') return (geometry.coordinates as number[][][]).map(coordinates => ({ type: geometry.type, coordinates }));
    if (geometry.type === 'Point') return [{ type: geometry.type, coordinates: [geometry.coordinates as number[]] }];
    return [] as Array<{ type: string; coordinates: number[][] }>;
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
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kartenausschnitt des zugewiesenen Bereichs" style={{ width: '100%', height: 'auto', aspectRatio: '2 / 1', display: 'block', borderRadius: 7, border: '1px solid #CBD5E1', background: '#F8FAFC' }}>
    {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} x={width / 2 + tile.x * tileSize - centerX} y={height / 2 + tile.y * tileSize - centerY} width={tileSize} height={tileSize} />)}
    {geometries.filter(geometry => geometry.type !== 'Point').map((geometry, index) => <polyline key={`outline-${index}`} points={geometry.coordinates.map(project).map(point => point.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />)}
    {geometries.filter(geometry => geometry.type !== 'Point').map((geometry, index) => <polyline key={`line-${index}`} points={geometry.coordinates.map(project).map(point => point.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />)}
    {geometries.filter(geometry => geometry.type === 'Point').map((geometry, index) => { const [x, y] = project(geometry.coordinates[0]); return <circle key={`point-${index}`} cx={x} cy={y} r="8" fill={color} stroke="#FFFFFF" strokeWidth="3" />; })}
    <rect x="8" y={height - 25} width="185" height="18" rx="3" fill="#FFFFFF" opacity=".9" /><text x="14" y={height - 12} fontSize="10" fill="#475569">Dein Bereich ist farbig markiert</text>
  </svg>;
};

export const PrintView: React.FC<PrintViewProps> = ({
  sections,
  helpers,
  candleSpacing = 2.0,
  candleBuffer = 10,
  publicBaseUrl = '',
  onSavePublicBaseUrl,
  onClose
}) => {
  const [printLayout, setPrintLayout] = useState<'table' | 'overview-map' | 'cards' | 'sheets'>('sheets');
  const [publicUrlInput, setPublicUrlInput] = useState(publicBaseUrl);
  const [showDeliveryAdmin, setShowDeliveryAdmin] = useState(false);
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', from: '' });
  const [smtpSaved, setSmtpSaved] = useState(false);

  useEffect(() => {
    if (!showDeliveryAdmin) return;
    api.getSettings().then(settings => setSmtp({
      host: settings.smtp_host || '', port: settings.smtp_port || '587',
      user: settings.smtp_user || '', from: settings.smtp_from || ''
    }));
  }, [showDeliveryAdmin]);

  const saveDeliverySettings = async () => {
    await Promise.all([
      api.setSetting('smtp_host', smtp.host.trim()), api.setSetting('smtp_port', smtp.port.trim()),
      api.setSetting('smtp_user', smtp.user.trim()), api.setSetting('smtp_from', smtp.from.trim()),
      onSavePublicBaseUrl?.(publicUrlInput.trim())
    ]);
    setSmtpSaved(true);
    window.setTimeout(() => setSmtpSaved(false), 2200);
  };
  const [orgaPhone, setOrgaPhone] = useState<string>('09855 / 12345 (Einsatzleitung)');
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
          .no-print {
            display: none !important;
          }
          .print-card {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
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
              onClick={() => setPrintLayout('overview-map')}
              style={{
                padding: '5px 12px', borderRadius: 4, border: 'none',
                background: printLayout === 'overview-map' ? '#F59E0B' : 'transparent',
                color: printLayout === 'overview-map' ? '#0F172A' : '#FFFFFF', fontWeight: 700, fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5
              }}
            >
              <MapIcon size={14} /> Gesamtkarte
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: 6 }}>
            <Phone size={13} color="#F59E0B" />
            <input
              type="text"
              value={orgaPhone}
              onChange={e => setOrgaPhone(e.target.value)}
              placeholder="Orga-Telefonnummer..."
              title="Wird auf allen Kärtchen als Notfallkontakt aufgedruckt"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 11,
                outline: 'none',
                width: 170
              }}
            />
          </div>
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
            onClick={() => setShowDeliveryAdmin(value => !value)}
            style={{ background: 'rgba(56,189,248,.16)', color: '#E0F2FE', border: '1px solid rgba(56,189,248,.45)', padding: '8px 12px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            Versand & SMTP
          </button>
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

      {showDeliveryAdmin && (
        <div className="no-print" style={{ maxWidth: 960, margin: '14px auto 0', padding: 16, border: '1px solid #38BDF8', borderRadius: 8, background: '#EFF6FF', color: '#0F172A' }}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>Versand & öffentliche Links</div>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>Die Basis-URL landet als lesbare Adresse und QR-Code auf jedem Helferblatt. SMTP wird für den späteren Mailversand vorbereitet.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {([
              ['SMTP-Host', 'host', 'mail.example.de'], ['Port', 'port', '587'],
              ['SMTP-Benutzer', 'user', 'benutzer'], ['Absender', 'from', 'lichternacht@example.de']
            ] as const).map(([label, key, placeholder]) => <label key={key} style={{ fontSize: 11, fontWeight: 700 }}>{label}<input value={smtp[key]} onChange={e => setSmtp({ ...smtp, [key]: e.target.value })} placeholder={placeholder} style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 4, padding: '7px 8px', border: '1px solid #93C5FD', borderRadius: 5 }} /></label>)}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>Das SMTP-Passwort wird absichtlich nicht im Frontend gespeichert. Beim Serverbetrieb wird es als Umgebungsvariable <code>SMTP_PASSWORD</code> gesetzt. Der Versand wird verfügbar, sobald E-Mail-Adressen in der Helferliste vorliegen.</div>
          <button onClick={saveDeliverySettings} style={{ marginTop: 12, background: '#0284C7', color: '#fff', border: 'none', borderRadius: 5, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>{smtpSaved ? 'Gespeichert ✓' : 'Einstellungen speichern'}</button>
        </div>
      )}

      {/* PRINT CONTENT CONTAINER */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>
        {/* DOCUMENT HEADER */}
        <div style={{ borderBottom: '3px solid #0F172A', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0F172A', margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                Lichternacht Bechhofen (91572)
              </h1>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#D97706', marginTop: 4 }}>
                {printLayout === 'table'
                  ? 'Offizieller Strecken- & Helfer-Einsatzplan'
                  : printLayout === 'overview-map'
                  ? 'Gesamtkarte der Helfer-Zuweisungen'
                  : printLayout === 'cards'
                  ? 'Kompakte Helfer-Informationen mit Karte & QR-Code'
                  : 'Persönliche Helfer-Informationen (A5)'}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
              <div>Stand: <b>{currentDate}</b></div>
              <div>Gemeinde Bechhofen a.d. Heide</div>
              {orgaPhone && <div style={{ color: '#0F172A', fontWeight: 600, marginTop: 2 }}>📞 {orgaPhone}</div>}
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

        {/* LAYOUT: PRINTABLE ASSIGNMENT MAP */}
        {printLayout === 'overview-map' && (
          <div className="overview-map-page" style={{ pageBreakAfter: 'always' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', letterSpacing: '0.04em' }}>Wer übernimmt welchen Abschnitt?</h2>
              <span style={{ fontSize: 11, color: '#64748B' }}>Für den Ausdruck idealerweise „Querformat“ wählen</span>
            </div>
            <AssignmentOverviewMap sections={sections} helpers={helpers} />
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
                            <span>● <b>{s.label}</b> ({s.street_name})</span>
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
                            Lichternacht Bechhofen • Helfer-Pass
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

                    {/* Card footer: pure information, no confirmation fields */}
                    <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 6, marginTop: 4, fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 5 }}><b>Bitte selbst mitbringen:</b> Lichter und benötigtes Material für deinen Bereich.</div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: '#64748B', borderTop: '1px dotted #CBD5E1', paddingTop: 4, marginTop: 4 }}>
                        <span>📞 Orga: <b>{orgaPhone || '09855 / 12345'}</b></span>
                        <span>Gemeinde Bechhofen</span>
                      </div>
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
                    className="print-card"
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
                          Lichternacht Bechhofen • Dein Bereich
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
                        <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>🕒 Für die Lichternacht:</div>
                        <div>• Bitte deinen Bereich rechtzeitig vorbereiten.</div>
                        <div>• Lichter und benötigtes Material bitte selbst besorgen.</div>
                        <div>• Den genauen Ablauf stimmt die Orga separat mit dir ab.</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 142px', gap: 14, marginBottom: 14, alignItems: 'start' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Kartenausschnitt deines Bereichs</div>
                        <HelperAreaMap sections={group.sections} color={group.helper.color} height={320} />
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
                      Diese Information dient nur zur Orientierung. Eine Rückmeldung oder Unterschrift ist nicht erforderlich.
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
