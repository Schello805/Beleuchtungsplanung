import React from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import type { PublicHelperInfo } from '../utils/api';

interface Props {
  info: PublicHelperInfo;
}

const firstCoordinate = (info: PublicHelperInfo): [number, number] | null => {
  const geometry = info.sections[0]?.geojson?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];
  if (geometry.type === 'LineString') return geometry.coordinates[0] as [number, number];
  if (geometry.type === 'MultiLineString') return geometry.coordinates[0]?.[0] as [number, number] || null;
  return null;
};

export const PublicHelperPage: React.FC<Props> = ({ info }) => {
  const meters = info.sections.reduce((sum, section) => sum + (section.length_meters || 0), 0);
  const coordinate = firstCoordinate(info);
  const mapUrl = coordinate ? `https://www.google.com/maps/search/?api=1&query=${coordinate[1]},${coordinate[0]}` : null;

  return (
    <main className="public-helper-page">
      <section className="public-helper-card">
        <p className="auth-kicker">LICHTERNACHT BECHHOFEN</p>
        <h1>Dein Bereich</h1>
        <h2>{info.name}</h2>
        <div className="public-helper-distance">{Math.round(meters)} Meter</div>
        <p className="public-helper-intro">Bitte schmücke die folgenden Straßenabschnitte. Lichter und benötigtes Material bringst du selbst mit.</p>
        <div className="public-helper-sections">
          {info.sections.map(section => <div key={section.id}>
            <MapPin size={16} /><span><strong>{section.label}</strong><small>{section.street_name} · {Math.round(section.length_meters)} m</small></span>
          </div>)}
        </div>
        {mapUrl && <a className="public-helper-map" href={mapUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> In Google Maps öffnen</a>}
        <p className="public-helper-footnote">Dieser Link zeigt ausschließlich deinen persönlichen Aufgabenbereich.</p>
      </section>
    </main>
  );
};
