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
        id: `sec-${Date.now()}-1`,
        sectionIndex: 1,
        label: `${streetName} – Abschnitt 1`,
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
        id: `sec-${Date.now()}-1`,
        sectionIndex: 1,
        label: `${streetName} – Abschnitt 1`,
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
      id: `sec-${Date.now()}-${idx + 1}`,
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
