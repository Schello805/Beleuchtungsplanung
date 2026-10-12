import { describe, expect, it } from 'vitest';
import { getMapsDirectionsUrl, getSectionEndpoints } from './sectionEndpoints';

describe('section endpoints', () => {
  const section = {
    geojson: {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[10.5, 49.1], [10.501, 49.101], [10.502, 49.102]] }
    }
  };

  it('uses the exact first and last street coordinates for A and B', () => {
    expect(getSectionEndpoints(section as any)).toEqual({ start: [10.5, 49.1], end: [10.502, 49.102] });
  });

  it('creates a walking map route from A to B', () => {
    const endpoints = getSectionEndpoints(section as any)!;
    expect(getMapsDirectionsUrl(endpoints)).toContain('origin=49.1,10.5');
    expect(getMapsDirectionsUrl(endpoints)).toContain('destination=49.102,10.502');
  });
});
