import type { Section, Helper } from './api';
import * as turf from '@turf/turf';

export interface AutoAssignmentResult {
  assignments: Array<{
    sectionId: string;
    helperId: string;
    helperName: string;
  }>;
  summary: {
    totalMeters: number;
    helpersUsed: number;
    avgMeters: number;
    minMeters: number;
    maxMeters: number;
  };
}

export interface FairnessRules {
  /** No helper receives more than this value unless a single section is already longer. */
  maxMeters?: number;
  /** Maximum difference between the currently lightest and heaviest helper. */
  maxDifferenceMeters?: number;
}

function lineFeatures(section: Section): GeoJSON.Feature<GeoJSON.LineString>[] {
  const geometry = section.geojson?.geometry;
  if (geometry?.type === 'LineString') return [section.geojson as GeoJSON.Feature<GeoJSON.LineString>];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates.map(coordinates => turf.lineString(coordinates));
  return [];
}

/** True when two section geometries touch at an endpoint or road junction. */
function sectionsConnect(first: Section, second: Section): boolean {
  const firstLines = lineFeatures(first);
  const secondLines = lineFeatures(second);
  if (!firstLines.length || !secondLines.length) return false;
  return firstLines.some(firstLine => {
    const endpoints = [firstLine.geometry.coordinates[0], firstLine.geometry.coordinates.at(-1)!];
    return secondLines.some(secondLine => endpoints.some(endpoint =>
      turf.pointToLineDistance(turf.point(endpoint), secondLine, { units: 'meters' }) <= 12
    ));
  }) || secondLines.some(secondLine => {
    const endpoints = [secondLine.geometry.coordinates[0], secondLine.geometry.coordinates.at(-1)!];
    return firstLines.some(firstLine => endpoints.some(endpoint =>
      turf.pointToLineDistance(turf.point(endpoint), firstLine, { units: 'meters' }) <= 12
    ));
  });
}

/**
 * Automatically and fairly balances section assignments among active helpers.
 * Prefers keeping sections of the same street together for logistical realism.
 */
export function calculateFairAssignment(
  sectionsToAssign: Section[],
  availableHelpers: Helper[]
): AutoAssignmentResult {
  if (sectionsToAssign.length === 0 || availableHelpers.length === 0) {
    return {
      assignments: [],
      summary: { totalMeters: 0, helpersUsed: 0, avgMeters: 0, minMeters: 0, maxMeters: 0 }
    };
  }

  // Helper meter tracking
  const helperTotals = new Map<string, { helper: Helper; meters: number; count: number }>();
  availableHelpers.forEach(h => {
    helperTotals.set(h.id, { helper: h, meters: 0, count: 0 });
  });

  // Group sections by street to preserve spatial continuity
  const streetGroups = new Map<string, Section[]>();
  sectionsToAssign.forEach(s => {
    const list = streetGroups.get(s.street_name) || [];
    list.push(s);
    streetGroups.set(s.street_name, list);
  });

  // Sort streets by total length descending (largest first heuristic)
  const sortedStreets = Array.from(streetGroups.entries()).sort((a, b) => {
    const lenA = a[1].reduce((sum, s) => sum + s.lengthMeters, 0);
    const lenB = b[1].reduce((sum, s) => sum + s.lengthMeters, 0);
    return lenB - lenA;
  });

  const assignments: Array<{ sectionId: string; helperId: string; helperName: string }> = [];

  // Distribute sections
  for (const [, streetSections] of sortedStreets) {
    // If the street is small/medium, try to assign all its sections to the least-burdened helper
    const streetTotalMeters = streetSections.reduce((sum, s) => sum + s.lengthMeters, 0);

    // Find helper with lowest meters
    const getLeastBurdened = () => {
      let minH = availableHelpers[0];
      let minVal = helperTotals.get(minH.id)!.meters;
      for (const h of availableHelpers) {
        const val = helperTotals.get(h.id)!.meters;
        if (val < minVal) {
          minVal = val;
          minH = h;
        }
      }
      return minH;
    };

    if (streetTotalMeters <= 250 || availableHelpers.length <= 2) {
      // Assign whole street to 1 helper
      const targetHelper = getLeastBurdened();
      const rec = helperTotals.get(targetHelper.id)!;

      for (const sec of streetSections) {
        assignments.push({
          sectionId: sec.id,
          helperId: targetHelper.id,
          helperName: targetHelper.name
        });
        rec.meters += sec.lengthMeters;
        rec.count++;
      }
    } else {
      // For longer streets, assign individual sections sequentially to balance load
      for (const sec of streetSections) {
        const targetHelper = getLeastBurdened();
        const rec = helperTotals.get(targetHelper.id)!;

        assignments.push({
          sectionId: sec.id,
          helperId: targetHelper.id,
          helperName: targetHelper.name
        });
        rec.meters += sec.lengthMeters;
        rec.count++;
      }
    }
  }

  // Calculate statistics
  const activeTotals = Array.from(helperTotals.values()).filter(v => v.count > 0);
  const totalMeters = activeTotals.reduce((sum, v) => sum + v.meters, 0);
  const helpersUsed = activeTotals.length;
  const avgMeters = helpersUsed > 0 ? Math.round(totalMeters / helpersUsed) : 0;
  const minMeters = activeTotals.length > 0 ? Math.min(...activeTotals.map(v => v.meters)) : 0;
  const maxMeters = activeTotals.length > 0 ? Math.max(...activeTotals.map(v => v.meters)) : 0;

  return {
    assignments,
    summary: {
      totalMeters,
      helpersUsed,
      avgMeters,
      minMeters,
      maxMeters
    }
  };
}

/**
 * Assigns each section to a nearby Lichternacht station while preventing one
 * station from receiving a disproportionate number of metres.  Helpers
 * without imported station coordinates are deliberately excluded here.
 */
export function calculateNearbyFairAssignment(
  sectionsToAssign: Section[],
  helpers: Helper[]
): AutoAssignmentResult {
  const locatedHelpers = helpers.filter(helper =>
    Number.isFinite(Number(helper.latitude)) && Number.isFinite(Number(helper.longitude))
  );
  if (!locatedHelpers.length) return calculateFairAssignment(sectionsToAssign, helpers);

  const totals = new Map(locatedHelpers.map(helper => [helper.id, { helper, meters: 0, count: 0 }]));
  const totalMeters = sectionsToAssign.reduce((sum, section) => sum + (section.lengthMeters || section.length_meters || 0), 0);
  const targetMeters = totalMeters / locatedHelpers.length;
  const assignments: AutoAssignmentResult['assignments'] = [];

  const getDistance = (section: Section, helper: Helper) => {
    const point = turf.point([Number(helper.longitude), Number(helper.latitude)]);
    if (section.type === 'line' && section.geojson.geometry.type === 'LineString') {
      return turf.pointToLineDistance(point, section.geojson, { units: 'meters' });
    }
    if (section.type === 'line' && section.geojson.geometry.type === 'MultiLineString') {
      return Math.min(...section.geojson.geometry.coordinates.map(coords =>
        turf.pointToLineDistance(point, turf.lineString(coords), { units: 'meters' })
      ));
    }
    if (section.geojson.geometry.type === 'Point') {
      return turf.distance(point, section.geojson, { units: 'kilometers' }) * 1000;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  // When there is one fair package per station, make the *whole* matching
  // globally optimal. The earlier greedy pass could reserve a nearby station
  // too early and leave a later package hundreds of metres away.
  if (sectionsToAssign.length <= locatedHelpers.length) {
    const matchedHelperIndexes = minimumCostMatching(
      sectionsToAssign.map(section => locatedHelpers.map(helper => getDistance(section, helper)))
    );
    matchedHelperIndexes.forEach((helperIndex, sectionIndex) => {
      const helper = locatedHelpers[helperIndex];
      const length = sectionsToAssign[sectionIndex].lengthMeters || sectionsToAssign[sectionIndex].length_meters || 0;
      const record = totals.get(helper.id)!;
      record.meters += length;
      record.count++;
      assignments.push({ sectionId: sectionsToAssign[sectionIndex].id, helperId: helper.id, helperName: helper.name });
    });
    const used = [...totals.values()].filter(record => record.count > 0);
    return {
      assignments,
      summary: {
        totalMeters,
        helpersUsed: used.length,
        avgMeters: used.length ? Math.round(totalMeters / used.length) : 0,
        minMeters: used.length ? Math.round(Math.min(...used.map(record => record.meters))) : 0,
        maxMeters: used.length ? Math.round(Math.max(...used.map(record => record.meters))) : 0
      }
    };
  }

  // Longer sections are allocated first, so balancing remains useful even
  // when a street is cut into differently sized pieces.
  const sorted = [...sectionsToAssign].sort((a, b) =>
    (b.lengthMeters || b.length_meters || 0) - (a.lengthMeters || a.length_meters || 0)
  );

  for (const section of sorted) {
    const length = section.lengthMeters || section.length_meters || 0;
    let winner = locatedHelpers[0];
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const helper of locatedHelpers) {
      const current = totals.get(helper.id)!;
      const distance = getDistance(section, helper);
      // Fairness is a hard constraint, locality breaks ties. With a 40 m
      // target, assigning a second 40 m piece to one station must never win
      // merely because it happens to be a few metres closer.
      const overload = Math.max(0, current.meters + length - targetMeters) * 100;
      const score = distance + overload;
      if (score < bestScore) {
        bestScore = score;
        winner = helper;
      }
    }
    const record = totals.get(winner.id)!;
    record.meters += length;
    record.count++;
    assignments.push({ sectionId: section.id, helperId: winner.id, helperName: winner.name });
  }

  const used = [...totals.values()].filter(record => record.count > 0);
  return {
    assignments,
    summary: {
      totalMeters,
      helpersUsed: used.length,
      avgMeters: used.length ? Math.round(totalMeters / used.length) : 0,
      minMeters: used.length ? Math.round(Math.min(...used.map(record => record.meters))) : 0,
      maxMeters: used.length ? Math.round(Math.max(...used.map(record => record.meters))) : 0
    }
  };
}

/**
 * Assigns the section directly at a station first.  Only after every possible
 * station has received one unique nearby section are the remaining sections
 * balanced across all helpers.  This mirrors the real-world workflow: each
 * participant decorates in front of their own stand before taking on a
 * further section elsewhere.
 */
export function calculateStationFirstAssignment(
  sectionsToAssign: Section[],
  helpers: Helper[],
  existingSections: Section[] = [],
  rules: FairnessRules = {}
): AutoAssignmentResult {
  if (sectionsToAssign.length === 0 || helpers.length === 0) {
    return {
      assignments: [],
      summary: { totalMeters: 0, helpersUsed: 0, avgMeters: 0, minMeters: 0, maxMeters: 0 }
    };
  }

  const lengthOf = (section: Section) => section.lengthMeters || section.length_meters || 0;
  const locatedHelpers = helpers.filter(helper =>
    Number.isFinite(Number(helper.latitude)) && Number.isFinite(Number(helper.longitude))
  );
  const totals = new Map(helpers.map(helper => [helper.id, { helper, meters: 0, count: 0 }]));
  const assignments: AutoAssignmentResult['assignments'] = [];
  const assignedSections = new Set<string>();
  const stationAssigned = new Set<string>();
  const assignedByHelper = new Map(helpers.map(helper => [helper.id, [] as Section[]]));

  // When only the still-open sections are distributed, the already allocated
  // areas are part of the topology as well. Without this seed an open segment
  // could accidentally be appended to a helper somewhere else in the town.
  const targetIds = new Set(sectionsToAssign.map(section => section.id));
  existingSections.forEach(section => {
    if (targetIds.has(section.id) || !section.assigned_helper_id) return;
    const record = totals.get(section.assigned_helper_id);
    const helperSections = assignedByHelper.get(section.assigned_helper_id);
    if (!record || !helperSections) return;
    record.meters += lengthOf(section);
    record.count++;
    helperSections.push(section);
    stationAssigned.add(section.assigned_helper_id);
  });

  const distanceToSection = (section: Section, helper: Helper) => {
    const point = turf.point([Number(helper.longitude), Number(helper.latitude)]);
    if (section.type === 'line' && section.geojson.geometry.type === 'LineString') {
      return turf.pointToLineDistance(point, section.geojson, { units: 'meters' });
    }
    if (section.type === 'line' && section.geojson.geometry.type === 'MultiLineString') {
      return Math.min(...section.geojson.geometry.coordinates.map(coords =>
        turf.pointToLineDistance(point, turf.lineString(coords), { units: 'meters' })
      ));
    }
    if (section.geojson.geometry.type === 'Point') {
      return turf.distance(point, section.geojson, { units: 'kilometers' }) * 1000;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  // Pair the closest station/section combinations first. A section can only
  // be reserved once, so two neighbouring stands never receive the same road.
  const nearbyPairs = locatedHelpers.filter(helper => totals.get(helper.id)!.count === 0).flatMap(helper =>
    sectionsToAssign.map(section => ({ helper, section, distance: distanceToSection(section, helper) }))
  ).sort((a, b) => a.distance - b.distance);

  for (const { helper, section } of nearbyPairs) {
    if (stationAssigned.has(helper.id) || assignedSections.has(section.id)) continue;
    const record = totals.get(helper.id)!;
    record.meters += lengthOf(section);
    record.count++;
    stationAssigned.add(helper.id);
    assignedSections.add(section.id);
    assignedByHelper.get(helper.id)!.push(section);
    assignments.push({ sectionId: section.id, helperId: helper.id, helperName: helper.name });
  }

  // The remaining work is deliberately balanced by metres. Distance is only a
  // tie-breaker, because every station already has its own local section.
  const remainingSections = sectionsToAssign
    .filter(section => !assignedSections.has(section.id))
    .sort((a, b) => lengthOf(b) - lengthOf(a));

  for (const section of remainingSections) {
    const connectedHelpers = helpers.filter(helper =>
      (assignedByHelper.get(helper.id) || []).some(existing => sectionsConnect(existing, section))
    );
    const unusedHelpers = helpers.filter(helper => totals.get(helper.id)!.count === 0);
    // A second, detached area is never assigned to an already active helper.
    // If a road component cannot be continued, an unused helper starts it.
    const baseCandidates = connectedHelpers.length ? connectedHelpers : unusedHelpers;
    const lightestMeters = Math.min(...helpers.map(helper => totals.get(helper.id)!.meters));
    const candidates = baseCandidates.filter(helper => {
      const proposedMeters = totals.get(helper.id)!.meters + lengthOf(section);
      const respectsMaximum = !rules.maxMeters || proposedMeters <= rules.maxMeters || lengthOf(section) > rules.maxMeters;
      const respectsDifference = !rules.maxDifferenceMeters || proposedMeters - lightestMeters <= rules.maxDifferenceMeters;
      return respectsMaximum && respectsDifference;
    }).sort((a, b) => {
      const loadDifference = totals.get(a.id)!.meters - totals.get(b.id)!.meters;
      if (loadDifference !== 0) return loadDifference;
      const aLocated = Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude));
      const bLocated = Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude));
      if (aLocated && bLocated) return distanceToSection(section, a) - distanceToSection(section, b);
      return a.name.localeCompare(b.name, 'de');
    });
    if (!candidates.length) continue;
    const helper = candidates[0];
    const record = totals.get(helper.id)!;
    record.meters += lengthOf(section);
    record.count++;
    assignedByHelper.get(helper.id)!.push(section);
    assignments.push({ sectionId: section.id, helperId: helper.id, helperName: helper.name });
  }

  const used = [...totals.values()].filter(record => record.count > 0);
  const totalMeters = sectionsToAssign.reduce((sum, section) => sum + lengthOf(section), 0);
  return {
    assignments,
    summary: {
      totalMeters,
      helpersUsed: used.length,
      avgMeters: used.length ? Math.round(totalMeters / used.length) : 0,
      minMeters: used.length ? Math.round(Math.min(...used.map(record => record.meters))) : 0,
      maxMeters: used.length ? Math.round(Math.max(...used.map(record => record.meters))) : 0
    }
  };
}

/** Hungarian algorithm: for each row returns the distinct column with the
 * minimum total cost. Here, rows are work packages and columns are stations. */
function minimumCostMatching(costs: number[][]): number[] {
  const rows = costs.length;
  const cols = costs[0]?.length || 0;
  if (!rows || rows > cols) return [];
  const u = Array(rows + 1).fill(0);
  const v = Array(cols + 1).fill(0);
  const p = Array(cols + 1).fill(0);
  const way = Array(cols + 1).fill(0);

  for (let row = 1; row <= rows; row++) {
    p[0] = row;
    let col0 = 0;
    const minv = Array(cols + 1).fill(Infinity);
    const used = Array(cols + 1).fill(false);
    do {
      used[col0] = true;
      const row0 = p[col0];
      let delta = Infinity;
      let col1 = 0;
      for (let col = 1; col <= cols; col++) {
        if (used[col]) continue;
        const current = costs[row0 - 1][col - 1] - u[row0] - v[col];
        if (current < minv[col]) {
          minv[col] = current;
          way[col] = col0;
        }
        if (minv[col] < delta) {
          delta = minv[col];
          col1 = col;
        }
      }
      for (let col = 0; col <= cols; col++) {
        if (used[col]) {
          u[p[col]] += delta;
          v[col] -= delta;
        } else {
          minv[col] -= delta;
        }
      }
      col0 = col1;
    } while (p[col0] !== 0);
    do {
      const col1 = way[col0];
      p[col0] = p[col1];
      col0 = col1;
    } while (col0 !== 0);
  }

  const result = Array(rows).fill(-1);
  for (let col = 1; col <= cols; col++) {
    if (p[col] > 0) result[p[col] - 1] = col - 1;
  }
  return result;
}
