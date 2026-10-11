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
    const mergedLines = stitchConnectedLineSections(lineSections);

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
        const subChunks = chunkLineWithFairness(rawGeo, stName, chunkMeters, minMeters, globalColorIdx);
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
      finalSections.push({
        ...item,
        street_name: stName,
        section_index: idx + 1,
        label: isMulti ? `${stName} – Abschnitt ${idx + 1}` : `${stName} (Gesamt)`,
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
 * Builds one visible work package per helper. A package may contain several
 * disconnected road fragments (MultiLineString), which is important for the
 * short 10–14 m fragments: they remain on the map but are never handed out as
 * a tiny standalone task. With 1,739 m and 42 helpers this produces packages
 * of about 41 m, therefore within the agreed 40–110 m range.
 */
export function createFairWorkPackages(sections: any[], helperCount: number): any[] {
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
  const packageCount = Math.min(helperCount, Math.floor(declaredTotalMeters / 40));
  const targetKm = totalKm / packageCount;
  const packages: Array<{ parts: GeoJSON.Feature<GeoJSON.LineString>[]; streets: Set<string>; km: number }> = [];
  let current = { parts: [] as GeoJSON.Feature<GeoJSON.LineString>[], streets: new Set<string>(), km: 0 };

  const finishCurrent = () => {
    if (current.parts.length) packages.push(current);
    current = { parts: [], streets: new Set<string>(), km: 0 };
  };

  for (const { section, feature } of lines) {
    const lineKm = turf.length(feature, { units: 'kilometers' });
    let offsetKm = 0;
    while (offsetKm < lineKm - 0.0000001) {
      const isLastPackage = packages.length === packageCount - 1;
      const availableKm = isLastPackage ? lineKm - offsetKm : targetKm - current.km;
      const takeKm = Math.min(availableKm, lineKm - offsetKm);
      const part = turf.lineSliceAlong(feature, offsetKm, offsetKm + takeKm, { units: 'kilometers' });
      current.parts.push(part);
      current.streets.add(section.street_name || section.streetName || 'Unbenannt');
      current.km += takeKm;
      offsetKm += takeKm;

      if (!isLastPackage && targetKm - current.km < 0.0000001) finishCurrent();
    }
  }
  finishCurrent();

  return packages.map((work, index) => {
    const names = [...work.streets];
    const geometry = work.parts.length === 1
      ? work.parts[0].geometry
      : { type: 'MultiLineString' as const, coordinates: work.parts.map(part => part.geometry.coordinates) };
    const baseMeters = Math.floor(declaredTotalMeters / packageCount);
    const extraMeters = Math.round(declaredTotalMeters - baseMeters * packageCount);
    const lengthMeters = baseMeters + (index < extraMeters ? 1 : 0);
    return {
      id: `work-package-${Date.now()}-${index + 1}`,
      street_name: names.length === 1 ? names[0] : 'Mehrere Straßen',
      section_index: index + 1,
      label: `Arbeits­paket ${index + 1}${names.length === 1 ? ` – ${names[0]}` : ` (${names.slice(0, 2).join(' + ')}${names.length > 2 ? ' …' : ''})`}`,
      length_meters: lengthMeters,
      lengthMeters,
      color: SECTION_COLORS[index % SECTION_COLORS.length],
      type: 'line' as const,
      geojson: { type: 'Feature' as const, properties: {}, geometry },
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
