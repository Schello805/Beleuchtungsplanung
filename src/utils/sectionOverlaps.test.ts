import { describe, expect, it } from 'vitest';
import type { Section } from './api';
import { findSectionOverlaps } from './sectionOverlaps';

const line = (id: string, coords: number[][], side: Section['lighting_side'] = 'left', helper = id): Section => ({
  id, street_name: 'Teststraße', label: id, section_index: 1, length_meters: 100, color: '#123', type: 'line', lighting_side: side,
  assigned_helper_id: helper, created_at: '', geojson: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(([x, y]) => [10 + x / 73000, 49 + y / 111320]) } },
});
describe('same-side section overlap warnings', () => {
  it('finds partial overlaps belonging to different helpers', () => {
    const result = findSectionOverlaps([line('a', [[0, 0], [100, 0]]), line('b', [[50, 0], [150, 0]])]);
    expect(result).toHaveLength(1);
    expect(result[0].meters).toBeCloseTo(50, -1);
    expect(result[0].differentHelpers).toBe(true);
  });
  it('ignores opposite sides, crossings, endpoint contact and nearby parallel streets', () => {
    const a = line('a', [[0, 0], [100, 0]]);
    for (const b of [line('b', [[0, 0], [100, 0]], 'right'), line('b', [[50, -40], [50, 40]]), line('b', [[100, 0], [200, 0]]), line('b', [[0, 5], [100, 5]])]) expect(findSectionOverlaps([a, b])).toEqual([]);
  });
  it('inverts sides for reversed geometry', () => {
    const a = line('a', [[0, 0], [100, 0]]);
    expect(findSectionOverlaps([a, line('b', [[100, 0], [0, 0]], 'right')])).toHaveLength(1);
    expect(findSectionOverlaps([a, line('b', [[100, 0], [0, 0]], 'left')])).toEqual([]);
  });
  it('handles curves, different segmentation, both sides and same-helper duplicates', () => {
    const result = findSectionOverlaps([line('a', [[0, 0], [50, 0], [50, 50]], 'both', 'same'), line('b', [[0, 0], [25, 0], [50, 0], [50, 50]], 'right', 'same')]);
    expect(result).toHaveLength(1);
    expect(result[0].meters).toBeCloseTo(100, -1);
    expect(result[0].differentHelpers).toBe(false);
  });
  it('tolerates small geometry deviations but ignores overlaps shorter than 3 m', () => {
    const a = line('a', [[0, 0], [100, 0]]);
    expect(findSectionOverlaps([a, line('b', [[0, 1], [100, 1]])])).toHaveLength(1);
    expect(findSectionOverlaps([a, line('b', [[98, 0], [120, 0]])])).toEqual([]);
  });
  it('does not invent connections between separate MultiLineString parts', () => {
    const a = line('a', [[0, 0], [20, 0]]);
    const far = line('far', [[80, 0], [100, 0]]);
    a.geojson.geometry = { type: 'MultiLineString', coordinates: [(a.geojson.geometry as GeoJSON.LineString).coordinates, (far.geojson.geometry as GeoJSON.LineString).coordinates] };
    expect(findSectionOverlaps([a, line('b', [[30, 0], [70, 0]])])).toEqual([]);
    expect(findSectionOverlaps([a, far])).toHaveLength(1);
  });
});
