import { describe, expect, it } from 'vitest';
import { calculateStationFirstAssignment } from './fairness';
import type { Helper, Section } from './api';

const line = (start: number, end: number) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: [[10.5 + start / 100000, 49.15], [10.5 + end / 100000, 49.15]] }
});

const helper = (id: string): Helper => ({ id, name: id, created_at: '2026-01-01T00:00:00.000Z' });
const section = (id: string, length_meters: number): Section => ({
  id, street_name: 'Testweg', section_index: 1, label: id, length_meters, lengthMeters: length_meters,
  color: '#A855F7', type: 'line', geojson: line(0, length_meters), created_at: '2026-01-01T00:00:00.000Z'
});

describe('calculateStationFirstAssignment', () => {
  it('assigns an indivisible long section instead of blocking the plan', () => {
    const result = calculateStationFirstAssignment([section('bridge-100m', 100)], [helper('A'), helper('B')], [], {
      maxMeters: 50,
      maxDifferenceMeters: 15
    });

    expect(result.assignments).toEqual([{ sectionId: 'bridge-100m', helperId: 'A', helperName: 'A' }]);
  });

  it('uses a connected helper as a fallback when a preference would leave work open', () => {
    const existing = { ...section('first', 50), assigned_helper_id: 'A', assigned_helper_name: 'A' };
    const result = calculateStationFirstAssignment([section('next', 40)], [helper('A'), helper('B')], [existing], {
      maxMeters: 50,
      maxDifferenceMeters: 15
    });

    expect(result.assignments).toEqual([{ sectionId: 'next', helperId: 'A', helperName: 'A' }]);
  });
});
