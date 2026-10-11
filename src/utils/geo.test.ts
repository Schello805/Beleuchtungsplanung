import { describe, expect, it } from 'vitest';
import { rechunkSectionsByTargetLength } from './geo';

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
