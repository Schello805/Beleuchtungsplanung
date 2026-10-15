import { describe, expect, it } from 'vitest';
import { createFairWorkPackages, rechunkSectionsByTargetLength, splitSectionAtPoint } from './geo';

describe('rechunkSectionsByTargetLength', () => {
  it('rejoins short neighbouring fragments before enforcing the 40–110 m bounds', () => {
    const line = (start: number, end: number) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[10.5 + start / 100000, 49.15], [10.5 + end / 100000, 49.15]] }
    });
    const input = [
      { id: 'a', street_name: 'Teststraße', section_index: 1, type: 'line', geojson: line(0, 90), length_meters: 10 },
      { id: 'b', street_name: 'Teststraße', section_index: 2, type: 'line', geojson: line(90, 180), length_meters: 10 },
      { id: 'c', street_name: 'Teststraße', section_index: 3, type: 'line', geojson: line(180, 630), length_meters: 50 }
    ];

    const result = rechunkSectionsByTargetLength(input, 40, 40);
    const lengths = result.map(section => section.length_meters);
    expect(lengths.every(length => length >= 40)).toBe(true);
    expect(lengths.every(length => length <= 110)).toBe(true);
  });
});

describe('createFairWorkPackages', () => {
  it('never combines separate streets into one MultiLineString work package', () => {
    const line = (lon: number) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[lon, 49.15], [lon + 0.001, 49.15]] }
    });
    const packages = createFairWorkPackages([
      { id: 'a', street_name: 'Nordstraße', type: 'line', geojson: line(10.5), length_meters: 80 },
      { id: 'b', street_name: 'Südstraße', type: 'line', geojson: line(10.53), length_meters: 80 }
    ], 2);

    expect(packages).toHaveLength(2);
    expect(packages.every(item => item.geojson.geometry.type === 'LineString')).toBe(true);
  });
});

describe('splitSectionAtPoint', () => {
  it('snaps a selected map point to the line and keeps the side assignment on both parts', () => {
    const result = splitSectionAtPoint({
      id: 'side-a', street_name: 'Teststraße', section_index: 1, label: 'Teststraße · Seite A',
      type: 'line', lighting_side: 'left', assigned_helper_id: 'station-1', assigned_helper_name: 'Station 1',
      color: '#A855F7', length_meters: 100,
      geojson: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[10.5, 49.15], [10.501, 49.15]] } }
    }, [10.5005, 49.1501]);

    expect(result).not.toBeNull();
    expect(result?.[0].lighting_side).toBe('left');
    expect(result?.[1].lighting_side).toBe('left');
    expect(result?.[0].assigned_helper_id).toBe('station-1');
    expect(result?.[1].assigned_helper_id).toBe('station-1');
    expect((result?.[0].length_meters || 0) + (result?.[1].length_meters || 0)).toBeGreaterThan(60);
  });
});
