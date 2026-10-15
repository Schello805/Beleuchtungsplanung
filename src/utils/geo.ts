import * as turf from '@turf/turf';

// Vibrant, highly distinguishable color palette for map sections
export const SECTION_COLORS = [
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
  '#E11D48', // Rose
  '#14B8A6', // Teal
  '#6366F1', // Indigo
  '#D946EF', // Fuchsia
  '#EAB308', // Yellow
  '#22C55E', // Green
  '#38BDF8', // Sky
  '#A855F7', // Violet
  '#FB7185', // Coral
  '#4ADE80', // Mint
  '#F43F5E', // Crimson
  '#2DD4BF', // Turquoise
];

export interface GeneratedSection {
  id: string;
  streetName?: string;
  sectionIndex: number;
  label: string;
  lengthMeters: number;
  color: string;
  type: 'line' | 'point';
  geojson: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Point>;
  lighting_side?: 'left' | 'right' | 'both';
}

type LightingSideSelection = 'left' | 'right' | 'both';

const sideLabel = (label: string, side: 'left' | 'right') =>
  `${label.replace(/\s*·\s*Seite [AB]$/u, '')} · Seite ${side === 'left' ? 'A' : 'B'}`;

/**
 * Road sides are separate work items from the very first preview.  This is
 * deliberately done before saving, so the organiser can exclude a side while
 * recording the street instead of correcting a combined street afterwards.
 */
export function createSideSections(
  sections: GeneratedSection[],
  selection: LightingSideSelection
): GeneratedSection[] {
  if (selection === 'both') {
    return sections.flatMap(section => section.type !== 'line'
      ? [section]
      : (['left', 'right'] as const).map(side => ({
        ...section,
        id: `${section.id}-${side}`,
        label: sideLabel(section.label, side),
        lighting_side: side,
      }))
    );
  }

  return sections.map(section => section.type !== 'line' ? section : ({
    ...section,
    id: `${section.id}-${selection}`,
    label: sideLabel(section.label, selection),
    lighting_side: selection,
  }));
}

/**
 * Splits around a target length, preferring supplied junction points near that
 * target.  The fallback remains an exact distance split, so every road can be
 * recorded even when OSM has no usable crossing node.
 */
export function chunkLinePreferringJunctions(
  lineFeature: GeoJSON.Feature<GeoJSON.LineString>,
  streetName: string,
  chunkMeters: number,
  minMeters: number,
  junctionPoints: Array<[number, number]> = [],
  colorOffset: number = 0
): GeneratedSection[] {
  const cleaned = turf.cleanCoords(lineFeature) as GeoJSON.Feature<GeoJSON.LineString>;
  const totalKm = turf.length(cleaned, { units: 'kilometers' });
  const totalMeters = Math.round(totalKm * 1000);
  if (totalMeters <= chunkMeters || junctionPoints.length === 0) {
    return chunkLineWithFairness(cleaned, streetName, chunkMeters, minMeters, colorOffset);
  }

  const candidates = junctionPoints
    .map(point => Number(turf.nearestPointOnLine(cleaned, turf.point(point), { units: 'kilometers' }).properties.location))
    .filter(location => Number.isFinite(location) && location * 1000 >= minMeters && (totalKm - location) * 1000 >= minMeters)
    .sort((a, b) => a - b)
    .filter((location, index, all) => index === 0 || Math.abs(location - all[index - 1]) > 0.003);

  if (!candidates.length) return chunkLineWithFairness(cleaned, streetName, chunkMeters, minMeters, colorOffset);

  const boundaries: number[] = [];
  let startKm = 0;
  const targetKm = chunkMeters / 1000;
  const toleranceKm = Math.min(targetKm * 0.45, 0.04);
  while ((totalKm - startKm) * 1000 > chunkMeters + minMeters) {
    const ideal = startKm + targetKm;
    const usable = candidates.filter(candidate =>
      candidate > startKm + minMeters / 1000 &&
      (totalKm - candidate) * 1000 >= minMeters &&
      Math.abs(candidate - ideal) <= toleranceKm
    );
    const boundary = usable.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0] || ideal;
    boundaries.push(boundary);
    startKm = boundary;
  }

  const distances = [0, ...boundaries, totalKm];
  const pieces = distances.slice(0, -1).map((start, index) =>
    turf.lineSliceAlong(cleaned, start, distances[index + 1], { units: 'kilometers' })
  );
  const last = pieces.at(-1);
  if (pieces.length > 1 && last && turf.length(last, { units: 'kilometers' }) * 1000 < minMeters) {
    const before = pieces[pieces.length - 2];
    pieces.splice(-2, 2, turf.lineString([...before.geometry.coordinates, ...last.geometry.coordinates.slice(1)]));
  }

  return pieces.map((geojson, index) => ({
    id: `sec-${Date.now()}-${colorOffset + index + 1}`,
    streetName,
    sectionIndex: index + 1,
    label: `${streetName} – Abschnitt ${index + 1}`,
    lengthMeters: Math.max(1, Math.round(turf.length(geojson, { units: 'kilometers' }) * 1000)),
    color: SECTION_COLORS[(colorOffset + index) % SECTION_COLORS.length],
    type: 'line' as const,
    geojson,
  }));
}

/**
 * Splits a LineString into uniform chunks with the strict fairness rule:
 * If the last chunk is shorter than minMeters, it is appended to the penultimate chunk.
 */
export function chunkLineWithFairness(
  lineFeature: GeoJSON.Feature<GeoJSON.LineString>,
  streetName: string,
  chunkMeters: number,
  minMeters: number,
  colorOffset: number = 0
): GeneratedSection[] {
  const cleaned = turf.cleanCoords(lineFeature) as GeoJSON.Feature<GeoJSON.LineString>;
  const totalLengthMeters = Math.round(turf.length(cleaned, { units: 'kilometers' }) * 1000);

  // If the whole street is shorter than or equal to chunkMeters, it remains 1 section
  if (totalLengthMeters <= chunkMeters) {
    const color = SECTION_COLORS[colorOffset % SECTION_COLORS.length];
    return [
      {
        id: `sec-${Date.now()}-${colorOffset}-1`,
        streetName,
        sectionIndex: 1,
        label: `${streetName} (Gesamt)`,
        lengthMeters: totalLengthMeters,
        color,
        type: 'line',
        geojson: cleaned
      }
    ];
  }

  // Turf lineChunk uses kilometers
  const rawChunkCollection = turf.lineChunk(cleaned, chunkMeters / 1000, { units: 'kilometers' });
  const rawFeatures = [...rawChunkCollection.features];

  if (rawFeatures.length <= 1) {
    const color = SECTION_COLORS[colorOffset % SECTION_COLORS.length];
    return [
      {
        id: `sec-${Date.now()}-${colorOffset}-1`,
        streetName,
        sectionIndex: 1,
        label: `${streetName} (Gesamt)`,
        lengthMeters: totalLengthMeters,
        color,
        type: 'line',
        geojson: cleaned
      }
    ];
  }

  // FAIRNESS CHECK:
  const lastChunk = rawFeatures[rawFeatures.length - 1];
  const lastLengthMeters = Math.round(turf.length(lastChunk, { units: 'kilometers' }) * 1000);

  if (lastLengthMeters < minMeters) {
    // Merge last chunk with penultimate chunk
    const penultChunk = rawFeatures[rawFeatures.length - 2];
    const penultCoords = penultChunk.geometry.coordinates;
    const lastCoords = lastChunk.geometry.coordinates;

    // Concat coords without repeating junction point
    const mergedCoords = [...penultCoords, ...lastCoords.slice(1)];
    penultChunk.geometry.coordinates = mergedCoords;

    // Pop the last short fragment
    rawFeatures.pop();
  }

  // Map to GeneratedSection objects with labels and colors
  return rawFeatures.map((feat, idx) => {
    const len = Math.round(turf.length(feat, { units: 'kilometers' }) * 1000);
    const color = SECTION_COLORS[(colorOffset + idx) % SECTION_COLORS.length];
    return {
      id: `sec-${Date.now()}-${colorOffset + idx + 1}`,
      streetName,
      sectionIndex: idx + 1,
      label: `${streetName} – Abschnitt ${idx + 1}`,
      lengthMeters: len,
      color,
      type: 'line',
      geojson: feat as GeoJSON.Feature<GeoJSON.LineString>
    };
  });
}

/**
 * Creates a single point section (e.g. fountain, station).
 */
export function createPointSection(
  pointFeature: GeoJSON.Feature<GeoJSON.Point>,
  label: string,
  colorOffset: number = 0
): GeneratedSection {
  const color = SECTION_COLORS[colorOffset % SECTION_COLORS.length];
  return {
    id: `sec-${Date.now()}-pt`,
    sectionIndex: 1,
    label: label.trim() || 'Punkt-Station',
    lengthMeters: 0,
    color,
    type: 'point',
    geojson: pointFeature
  };
}

/**
 * Splits a single section into two equal halves.
 */
export function splitSectionInHalf(section: any, colorOffset: number = 0): [any, any] | null {
  if (section.type !== 'line') return null;

  const rawGeo = typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson;
  const totalKm = turf.length(rawGeo, { units: 'kilometers' });
  const totalMeters = Math.round(totalKm * 1000);
  if (totalMeters < 16) return null; // Too small to split meaningfully

  const halfKm = totalKm / 2;
  const part1Geo = turf.lineSliceAlong(rawGeo, 0, halfKm, { units: 'kilometers' });
  const part2Geo = turf.lineSliceAlong(rawGeo, halfKm, totalKm, { units: 'kilometers' });

  const p1Len = Math.round(turf.length(part1Geo, { units: 'kilometers' }) * 1000);
  const p2Len = Math.round(turf.length(part2Geo, { units: 'kilometers' }) * 1000);

  const baseLabel = section.label.replace(/\s*\([a-z0-9]+\)$/i, '');

  const part1 = {
    ...section,
    id: `sec-${Date.now()}-1`,
    label: `${baseLabel} (Teil 1)`,
    length_meters: p1Len,
    lengthMeters: p1Len,
    color: SECTION_COLORS[colorOffset % SECTION_COLORS.length],
    geojson: part1Geo
  };

  const part2 = {
    ...section,
    id: `sec-${Date.now()}-2`,
    label: `${baseLabel} (Teil 2)`,
    length_meters: p2Len,
    lengthMeters: p2Len,
    color: SECTION_COLORS[(colorOffset + 1) % SECTION_COLORS.length],
    geojson: part2Geo,
    assigned_helper_id: null,
    assigned_helper_name: null
  };

  return [part1, part2];
}

/** Splits a LineString at the point selected on the map. The selected point is
 * snapped to the road geometry, so it is safe to click slightly beside it. */
export function splitSectionAtPoint(
  section: any,
  target: [number, number],
  colorOffset: number = 0
): [any, any] | null {
  if (section.type !== 'line') return null;
  const rawGeo = typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson;
  if (rawGeo?.geometry?.type !== 'LineString') return null;

  const totalKm = turf.length(rawGeo, { units: 'kilometers' });
  const nearest = turf.nearestPointOnLine(rawGeo, turf.point(target), { units: 'kilometers' });
  const splitKm = Number(nearest.properties.location);
  const minPartKm = 0.005;
  if (!Number.isFinite(splitKm) || totalKm < minPartKm * 2 || splitKm < minPartKm || totalKm - splitKm < minPartKm) return null;

  const firstGeo = turf.lineSliceAlong(rawGeo, 0, splitKm, { units: 'kilometers' });
  const secondGeo = turf.lineSliceAlong(rawGeo, splitKm, totalKm, { units: 'kilometers' });
  const firstLength = Math.max(1, Math.round(turf.length(firstGeo, { units: 'kilometers' }) * 1000));
  const secondLength = Math.max(1, Math.round(turf.length(secondGeo, { units: 'kilometers' }) * 1000));
  const baseLabel = section.label.replace(/\s*\(Teil [12]\)$/u, '');

  return [
    {
      ...section,
      id: `sec-split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-1`,
      label: `${baseLabel} (Teil 1)`,
      length_meters: firstLength,
      lengthMeters: firstLength,
      color: section.color || SECTION_COLORS[colorOffset % SECTION_COLORS.length],
      geojson: firstGeo,
    },
    {
      ...section,
      id: `sec-split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-2`,
      label: `${baseLabel} (Teil 2)`,
      length_meters: secondLength,
      lengthMeters: secondLength,
      color: section.color || SECTION_COLORS[(colorOffset + 1) % SECTION_COLORS.length],
      geojson: secondGeo,
    },
  ];
}

/**
 * Fairly subdivides a collection of sections so that there are exactly (or at least) `targetCount` sections.
 * Uses Longest-Edge-Bisection: repeatedly splits the longest remaining section in half.
 * This preserves short alleyways and naturally scales down longer stretches to fit all participants!
 */
export function redistributeSectionsToTargetCount(
  sections: any[],
  targetCount: number,
  options?: { autoAssignHelpers?: boolean; helpers?: any[] }
): any[] {
  if (!sections || sections.length === 0) return [];
  if (targetCount <= sections.length) return [...sections];

  // Deep clone items
  let workingList = sections.map(s => ({
    ...s,
    geojson: typeof s.geojson === 'string' ? JSON.parse(s.geojson) : s.geojson,
    length_meters: s.length_meters || s.lengthMeters || 0
  }));

  // Bisect the longest line section until we reach targetCount
  while (workingList.length < targetCount) {
    let longestIdx = -1;
    let maxLen = -1;

    for (let i = 0; i < workingList.length; i++) {
      if (workingList[i].type === 'line' && workingList[i].length_meters > maxLen) {
        maxLen = workingList[i].length_meters;
        longestIdx = i;
      }
    }

    if (longestIdx === -1 || maxLen < 16) {
      // Cannot split further without creating micro-segments < 8m
      break;
    }

    const item = workingList[longestIdx];
    const totalKm = turf.length(item.geojson, { units: 'kilometers' });
    const halfKm = totalKm / 2;

    const p1Geo = turf.lineSliceAlong(item.geojson, 0, halfKm, { units: 'kilometers' });
    const p2Geo = turf.lineSliceAlong(item.geojson, halfKm, totalKm, { units: 'kilometers' });

    const p1Len = Math.round(turf.length(p1Geo, { units: 'kilometers' }) * 1000);
    const p2Len = Math.round(turf.length(p2Geo, { units: 'kilometers' }) * 1000);

    const p1 = {
      ...item,
      id: `sec-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-1`,
      length_meters: p1Len,
      lengthMeters: p1Len,
      geojson: p1Geo
    };

    const p2 = {
      ...item,
      id: `sec-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-2`,
      length_meters: p2Len,
      lengthMeters: p2Len,
      geojson: p2Geo,
      assigned_helper_id: null,
      assigned_helper_name: null
    };

    workingList.splice(longestIdx, 1, p1, p2);
  }

  // Group by street name and re-index & re-label nicely
  const streetGroups = new Map<string, any[]>();
  workingList.forEach(s => {
    const stName = s.street_name || s.streetName || 'Unbenannt';
    const list = streetGroups.get(stName) || [];
    list.push(s);
    streetGroups.set(stName, list);
  });

  const finalSections: any[] = [];
  let globalColorIdx = 0;

  for (const [stName, secs] of streetGroups.entries()) {
    // Sort sections if they belong to the same street
    secs.forEach((sec, idx) => {
      const isMulti = secs.length > 1;
      const label = isMulti ? `${stName} – Abschnitt ${idx + 1}` : `${stName} (Gesamt)`;
      const color = SECTION_COLORS[globalColorIdx % SECTION_COLORS.length];
      globalColorIdx++;

      finalSections.push({
        ...sec,
        street_name: stName,
        section_index: idx + 1,
        label,
        color,
        type: sec.type || 'line',
        geojson: sec.geojson
      });
    });
  }

  // Auto-assign helpers if requested
  if (options?.autoAssignHelpers && options.helpers && options.helpers.length > 0) {
    const helpers = options.helpers;
    finalSections.forEach((sec, idx) => {
      if (idx < helpers.length) {
        sec.assigned_helper_id = helpers[idx].id;
        sec.assigned_helper_name = helpers[idx].name;
      } else {
        sec.assigned_helper_id = null;
        sec.assigned_helper_name = null;
      }
    });
  }

  return finalSections;
}

/**
 * Re-partitions sections with a fixed target chunk length (e.g. 40m, 50m).
 */
export function rechunkSectionsByTargetLength(
  sections: any[],
  chunkMeters: number,
  minMeters: number = 20,
  options?: { autoAssignHelpers?: boolean; helpers?: any[] }
): any[] {
  if (!sections || sections.length === 0) return [];

  const streetGroups = new Map<string, any[]>();
  sections.forEach(s => {
    const stName = s.street_name || s.streetName || 'Unbenannt';
    const list = streetGroups.get(stName) || [];
    list.push(s);
    streetGroups.set(stName, list);
  });

  const finalSections: any[] = [];
  let globalColorIdx = 0;

  for (const [stName, secs] of streetGroups.entries()) {
    // A street may already have been split into tiny preview fragments. Stitch
    // connected fragments back together first; otherwise 10 m pieces can never
    // become a valid 40–110 m work assignment.
    const streetChunks: any[] = [];

    const lineSections = secs.filter(sec => sec.type === 'line');
    const otherSections = secs.filter(sec => sec.type !== 'line');
    // Never join the two physical sides of a street.  Their existing
    // endpoints (which often originate from junction cuts) become preferred
    // break points when the plan is re-partitioned later.
    const linesBySide = new Map<string, any[]>();
    for (const section of lineSections) {
      const side = section.lighting_side || 'both';
      linesBySide.set(side, [...(linesBySide.get(side) || []), section]);
    }

    for (const sideSections of linesBySide.values()) {
      const mergedLines = stitchConnectedLineSections(sideSections);
      const preferredPoints = sideSections.flatMap(section => {
        const coords = (typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson).geometry.coordinates as [number, number][];
        return coords.length > 1 ? [coords[0], coords[coords.length - 1]] : [];
      });
      for (const sec of mergedLines) {
        const source = sec.source;
        const rawGeo = sec.geojson;
        const totalLen = Math.round(turf.length(rawGeo, { units: 'kilometers' }) * 1000);
        if (totalLen <= chunkMeters) {
          streetChunks.push({
            ...source,
            geojson: rawGeo,
            length_meters: totalLen,
            lengthMeters: totalLen,
            assigned_helper_id: null,
            assigned_helper_name: null
          });
        } else {
          const subChunks = chunkLinePreferringJunctions(rawGeo, stName, chunkMeters, minMeters, preferredPoints, globalColorIdx);
          for (const sub of subChunks) {
            streetChunks.push({
              ...source,
              id: sub.id,
              street_name: stName,
              label: sub.label,
              length_meters: sub.lengthMeters,
              lengthMeters: sub.lengthMeters,
              color: sub.color,
              type: 'line',
              geojson: sub.geojson,
              assigned_helper_id: null,
              assigned_helper_name: null
            });
          }
        }
      }
    }

    for (const sec of otherSections) {
      if (sec.type !== 'line') {
        streetChunks.push(sec);
      }
    }

    // Renumber
    streetChunks.forEach((item, idx) => {
      const isMulti = streetChunks.length > 1;
      const color = SECTION_COLORS[globalColorIdx % SECTION_COLORS.length];
      globalColorIdx++;
      const sideSuffix = item.lighting_side === 'left' ? ' · Seite A' : item.lighting_side === 'right' ? ' · Seite B' : '';
      finalSections.push({
        ...item,
        street_name: stName,
        section_index: idx + 1,
        label: `${isMulti ? `${stName} – Abschnitt ${idx + 1}` : `${stName} (Gesamt)`}${sideSuffix}`,
        color
      });
    });
  }

  // Auto-assign helpers if requested
  if (options?.autoAssignHelpers && options.helpers && options.helpers.length > 0) {
    const helpers = options.helpers;
    finalSections.forEach((sec, idx) => {
      if (idx < helpers.length) {
        sec.assigned_helper_id = helpers[idx].id;
        sec.assigned_helper_name = helpers[idx].name;
      } else {
        sec.assigned_helper_id = null;
        sec.assigned_helper_name = null;
      }
    });
  }

  return finalSections;
}

/**
 * Builds contiguous work packages. A package is always one LineString: it may
 * be shorter than the target where a road ends, but it is never assembled from
 * separate streets or distant road fragments.
 */
export function createFairWorkPackages(sections: any[], helperCount: number, minMeters = 40, maxMeters = 110): any[] {
  const lines = sections
    .filter(section => section.type === 'line')
    .flatMap(section => {
      const feature = typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson;
      if (feature?.geometry?.type === 'LineString') return [{ section, feature }];
      if (feature?.geometry?.type === 'MultiLineString') {
        return feature.geometry.coordinates.map((coordinates: number[][]) => ({ section, feature: turf.lineString(coordinates) }));
      }
      return [];
    }) as Array<{ section: any; feature: GeoJSON.Feature<GeoJSON.LineString> }>;

  const totalKm = lines.reduce((sum, item) => sum + turf.length(item.feature, { units: 'kilometers' }), 0);
  if (!lines.length || helperCount < 1 || totalKm <= 0) return [];

  // The captured geometry can differ by a few metres from the confirmed
  // planning lengths (rounding and OSM geometry). Preserve the latter for
  // exports/material calculations instead of silently changing the total.
  const declaredTotalMeters = sections.reduce((sum, section) => sum + Number(section.length_meters ?? section.lengthMeters ?? 0), 0);
  const desiredCount = Math.max(1, Math.min(helperCount, Math.floor(declaredTotalMeters / minMeters)));
  // Every continuous road component needs a package of its own. Long roads
  // are split further, first to respect the 110 m ceiling, then towards the
  // requested helper count while keeping each part at least 40 m long.
  const pieceCounts = lines.map(({ feature }) => Math.max(1, Math.ceil(turf.length(feature, { units: 'kilometers' }) / (maxMeters / 1000))));
  while (pieceCounts.reduce((sum, count) => sum + count, 0) < desiredCount) {
    let bestIndex = -1;
    let bestNextLength = 0;
    lines.forEach(({ feature }, index) => {
      const nextLength = turf.length(feature, { units: 'kilometers' }) / (pieceCounts[index] + 1);
      if (nextLength >= minMeters / 1000 && nextLength > bestNextLength) {
        bestIndex = index;
        bestNextLength = nextLength;
      }
    });
    if (bestIndex === -1) break;
    pieceCounts[bestIndex]++;
  }

  const packages = lines.flatMap(({ section, feature }, sourceIndex) => {
    const pieceCount = pieceCounts[sourceIndex];
    const lineKm = turf.length(feature, { units: 'kilometers' });
    return Array.from({ length: pieceCount }, (_, pieceIndex) => ({
      section,
      feature: turf.lineSliceAlong(feature, (lineKm * pieceIndex) / pieceCount, (lineKm * (pieceIndex + 1)) / pieceCount),
      km: lineKm / pieceCount
    }));
  });

  let remainingDeclaredMeters = declaredTotalMeters;
  let remainingKm = totalKm;
  return packages.map((work, index) => {
    const isLast = index === packages.length - 1;
    const lengthMeters = isLast
      ? Math.round(remainingDeclaredMeters)
      : Math.round((work.km / remainingKm) * remainingDeclaredMeters);
    remainingDeclaredMeters -= lengthMeters;
    remainingKm -= work.km;
    const streetName = work.section.street_name || work.section.streetName || 'Unbenannt';
    return {
      id: `work-package-${Date.now()}-${index + 1}`,
      street_name: streetName,
      section_index: index + 1,
      label: `Arbeits­paket ${index + 1} – ${streetName}`,
      length_meters: lengthMeters,
      lengthMeters,
      color: SECTION_COLORS[index % SECTION_COLORS.length],
      type: 'line' as const,
      geojson: { type: 'Feature' as const, properties: {}, geometry: work.feature.geometry },
      assigned_helper_id: null,
      assigned_helper_name: null,
      created_at: new Date().toISOString()
    };
  });
}

/** Joins ordered or reversed line fragments when they share an endpoint. */
function stitchConnectedLineSections(sections: any[]): Array<{ source: any; geojson: GeoJSON.Feature<GeoJSON.LineString> }> {
  const remaining = sections
    .slice()
    .sort((a, b) => (a.section_index || 0) - (b.section_index || 0))
    .map(section => ({
      source: section,
      coords: (typeof section.geojson === 'string' ? JSON.parse(section.geojson) : section.geojson).geometry.coordinates as number[][]
    }))
    .filter(item => item.coords.length >= 2);
  const result: Array<{ source: any; geojson: GeoJSON.Feature<GeoJSON.LineString> }> = [];
  const closeEnough = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

  while (remaining.length) {
    const first = remaining.shift()!;
    const coords = [...first.coords];
    let joined = true;
    while (joined) {
      joined = false;
      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index].coords;
        const start = coords[0];
        const end = coords[coords.length - 1];
        if (closeEnough(end, candidate[0])) {
          coords.push(...candidate.slice(1));
        } else if (closeEnough(end, candidate[candidate.length - 1])) {
          coords.push(...candidate.slice(0, -1).reverse());
        } else if (closeEnough(start, candidate[candidate.length - 1])) {
          coords.unshift(...candidate.slice(0, -1));
        } else if (closeEnough(start, candidate[0])) {
          coords.unshift(...candidate.slice(1).reverse());
        } else {
          continue;
        }
        remaining.splice(index, 1);
        joined = true;
        break;
      }
    }
    result.push({ source: first.source, geojson: turf.lineString(coords) });
  }
  return result;
}
