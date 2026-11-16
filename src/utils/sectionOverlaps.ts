import type { Section } from './api';

export type SectionOverlap = { first: Section; second: Section; meters: number; differentHelpers: boolean };
type XY = [number, number];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];

/** Geometric warning, not automatic reassignment. Crossings/endpoints do not count.
 * Sides are relative to geometry direction, so reversed lines invert left/right.
 */
export function findSectionOverlaps(sections: Section[]): SectionOverlap[] {
  const parts = (section: Section): number[][][] => section.geojson?.geometry.type === 'LineString' ? [section.geojson.geometry.coordinates]
    : section.geojson?.geometry.type === 'MultiLineString' ? section.geojson.geometry.coordinates : [];
  const lines = sections.filter(section => section.type === 'line' && parts(section).some(line => line.length > 1));
  const results: SectionOverlap[] = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const first = lines[i], second = lines[j];
    const originPoint = parts(first).find(line => line.length > 1)![0];
    const cos = Math.cos(originPoint[1] * Math.PI / 180);
    const project = (p: number[]): XY => [(p[0] - originPoint[0]) * 111320 * cos, (p[1] - originPoint[1]) * 111320];
    const segments = (section: Section) => parts(section).flatMap(line => line.slice(1).map((point, index) => [project(line[index]), project(point)] as [XY, XY]));
    const aa = segments(first), bb = segments(second);
    let overlap = 0;
    for (const [origin, target] of aa) {
      const av = sub(target, origin), length = Math.hypot(...av);
      if (length < .01) continue;
      const dir: XY = [av[0] / length, av[1] / length];
      const intervals: Array<[number, number]> = [];
      for (const [bStart, bEnd] of bb) {
        const bv = sub(bEnd, bStart), bl = Math.hypot(...bv);
        if (bl < .01) continue;
        const alignment = dot(dir, bv) / bl;
        if (Math.abs(alignment) < Math.cos(10 * Math.PI / 180)) continue;
        const left = first.lighting_side || 'both', right = second.lighting_side || 'both';
        if (left !== 'both' && right !== 'both' && (alignment > 0 ? left !== right : left === right)) continue;
        const p = sub(bStart, origin), q = sub(bEnd, origin);
        const start = Math.max(0, Math.min(dot(p, dir), dot(q, dir)));
        const end = Math.min(length, Math.max(dot(p, dir), dot(q, dir)));
        if (end <= start) continue;
        // Check distance only along the shared interval, allowing different segmentation.
        const cross = (r: XY) => dir[0] * r[1] - dir[1] * r[0];
        const at = (t: number) => cross(p) + (cross(q) - cross(p)) * (t - dot(p, dir)) / dot(bv, dir);
        if (Math.max(Math.abs(at(start)), Math.abs(at(end))) > 1.5) continue;
        intervals.push([start, end]);
      }
      intervals.sort((x, y) => x[0] - y[0]);
      let end = 0;
      for (const interval of intervals) { overlap += Math.max(0, interval[1] - Math.max(end, interval[0])); end = Math.max(end, interval[1]); }
    }
    if (overlap >= 3) results.push({ first, second, meters: Math.round(overlap), differentHelpers: !!first.assigned_helper_id && !!second.assigned_helper_id && first.assigned_helper_id !== second.assigned_helper_id });
  }
  return results.sort((a, b) => Number(b.differentHelpers) - Number(a.differentHelpers) || b.meters - a.meters);
}
