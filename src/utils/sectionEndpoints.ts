import type { Section } from './api';

export type Coordinate = [number, number];

export interface SectionEndpoints {
  start: Coordinate;
  end: Coordinate;
}

/**
 * Uses the stored, already directionally ordered street geometry. The labels
 * A/B are deliberately bound to these exact geometry endpoints, so printed
 * maps and the helper link always describe the same points.
 */
export function getSectionEndpoints(section: Pick<Section, 'geojson'>): SectionEndpoints | null {
  const geometry = section.geojson?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const coordinate = geometry.coordinates as Coordinate;
    return { start: coordinate, end: coordinate };
  }
  const line = geometry.type === 'LineString'
    ? geometry.coordinates as Coordinate[]
    : geometry.type === 'MultiLineString'
      ? (geometry.coordinates as Coordinate[][]).flat()
      : [];
  if (!line.length) return null;
  return { start: line[0], end: line[line.length - 1] };
}

export function getMapsDirectionsUrl(endpoints: SectionEndpoints): string {
  const [startLon, startLat] = endpoints.start;
  const [endLon, endLat] = endpoints.end;
  return `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLon}&destination=${endLat},${endLon}&travelmode=walking`;
}
