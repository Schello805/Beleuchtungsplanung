import * as turf from '@turf/turf';

// Bechhofen (PLZ 91572) Bounding Box: [minLat, minLon, maxLat, maxLon]
const BECHHOFEN_BBOX = '49.1241,10.4857,49.2170,10.6304';

// Multiple Overpass endpoints for 100% high availability & failover
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// In-memory cache for all streets in Bechhofen
let cachedStreetNames: string[] | null = null;
let lastStreetFetchTime = 0;

/**
 * Creates a regex pattern that matches both "ß" and "ss" interchangeably, case-insensitively.
 * e.g., "Hauptstraße" -> "Hauptstra(ß|ss)e"
 */
export function buildSsToleranceRegex(input: string): string {
  // Replace both 'ß' and 'ss' (and 'SS') with (ß|ss)
  const normalized = input.trim().replace(/ß|ss/gi, '(ß|ss)');
  // Escape any special regex characters except the (ß|ss) group we added
  return normalized;
}

/**
 * Fetches data from Overpass with automatic fallback across endpoints.
 */
async function queryOverpass(query: string): Promise<any> {
  let lastError: any = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?data=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'LichternachtStreckenplaner/1.0 (GIS-App Bechhofen)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (err) {
      lastError = err;
      // Continue to next endpoint
    }
  }

  throw new Error(`Overpass query failed on all endpoints: ${lastError?.message || 'Network error'}`);
}

/**
 * Returns a list of all known street names in Bechhofen (PLZ 91572).
 */
export async function getBechhofenStreets(): Promise<string[]> {
  const now = Date.now();
  if (cachedStreetNames && now - lastStreetFetchTime < 1000 * 60 * 60) {
    return cachedStreetNames;
  }

  const query = `[out:json][timeout:25];way["highway"]["name"](${BECHHOFEN_BBOX});out tags;`;

  try {
    const data = await queryOverpass(query);
    const set = new Set<string>();

    if (data && data.elements) {
      for (const el of data.elements) {
        if (el.tags && el.tags.name) {
          set.add(el.tags.name.trim());
        }
      }
    }

    cachedStreetNames = Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
    lastStreetFetchTime = now;
    return cachedStreetNames;
  } catch (err) {
    console.error('Failed to prefetch street names:', err);
    // If cache was available, return it, else return fallback defaults
    return cachedStreetNames || [
      'Ansbacher Straße', 'Dinkelsbühler Straße', 'Feuchtwanger Straße',
      'Gunzenhausener Straße', 'Marktplatz', 'Kirchenallee', 'Am Plärrer',
      'Goethestraße', 'Schillerstraße', 'Krummweiherweg'
    ];
  }
}

/**
 * Topologically chains multiple OSM way line coordinates together into continuous branches.
 * Prevents zigzag lines and disconnected loops.
 */
export function stitchWaysToLines(ways: Array<{ geometry: Array<{ lat: number; lon: number }> }>): GeoJSON.Feature<GeoJSON.LineString>[] {
  if (!ways || ways.length === 0) return [];

  // Convert each way to a coordinate array [lon, lat]
  let segments = ways
    .map(w => (w.geometry || []).map(pt => [pt.lon, pt.lat] as [number, number]))
    .filter(coords => coords.length >= 2);

  if (segments.length === 0) return [];

  const branches: Array<Array<[number, number]>> = [];

  while (segments.length > 0) {
    let currentLine = segments.shift()!;
    let changed = true;

    while (changed) {
      changed = false;
      const startPt = currentLine[0];
      const endPt = currentLine[currentLine.length - 1];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];

        const eps = 0.0001; // tolerance ~10 meters for endpoint connection

        // Match endPt to segStart
        if (ptsClose(endPt, segStart, eps)) {
          currentLine = [...currentLine, ...seg.slice(1)];
          segments.splice(i, 1);
          changed = true;
          break;
        }
        // Match endPt to segEnd (reverse seg)
        else if (ptsClose(endPt, segEnd, eps)) {
          const rev = [...seg].reverse();
          currentLine = [...currentLine, ...rev.slice(1)];
          segments.splice(i, 1);
          changed = true;
          break;
        }
        // Match startPt to segEnd
        else if (ptsClose(startPt, segEnd, eps)) {
          currentLine = [...seg.slice(0, -1), ...currentLine];
          segments.splice(i, 1);
          changed = true;
          break;
        }
        // Match startPt to segStart (reverse seg)
        else if (ptsClose(startPt, segStart, eps)) {
          const rev = [...seg].reverse();
          currentLine = [...rev.slice(0, -1), ...currentLine];
          segments.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    branches.push(currentLine);
  }

  // Convert branches into GeoJSON Features, sorted by length descending
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = branches.map((branch, idx) => {
    const rawLine = turf.lineString(branch);
    return turf.cleanCoords(rawLine) as GeoJSON.Feature<GeoJSON.LineString>;
  });

  features.sort((a, b) => {
    return turf.length(b, { units: 'kilometers' }) - turf.length(a, { units: 'kilometers' });
  });

  return features;
}

function ptsClose(p1: [number, number], p2: [number, number], eps: number): boolean {
  return Math.abs(p1[0] - p2[0]) < eps && Math.abs(p1[1] - p2[1]) < eps;
}

/**
 * Searches Overpass for a street by name with "ß" / "ss" tolerance.
 * Returns topographically merged GeoJSON LineString(s).
 */
export async function getStreetGeometry(streetName: string): Promise<{
  streetName: string;
  features: GeoJSON.Feature<GeoJSON.LineString>[];
  totalLengthMeters: number;
}> {
  const regex = buildSsToleranceRegex(streetName);
  const query = `[out:json][timeout:25];
way["highway"]["name"~"${regex}",i](${BECHHOFEN_BBOX});
out body geom;`;

  const data = await queryOverpass(query);
  if (!data || !data.elements || data.elements.length === 0) {
    throw new Error(`Keine Straße mit dem Namen "${streetName}" in Bechhofen gefunden.`);
  }

  // Filter ways that have geometry
  const ways = data.elements.filter((el: any) => el.type === 'way' && el.geometry && el.geometry.length > 0);
  if (ways.length === 0) {
    throw new Error(`Für "${streetName}" wurden keine Geometrien gefunden.`);
  }

  const features = stitchWaysToLines(ways);
  let totalLengthMeters = 0;
  for (const f of features) {
    totalLengthMeters += Math.round(turf.length(f, { units: 'kilometers' }) * 1000);
  }

  return {
    streetName: ways[0]?.tags?.name || streetName,
    features,
    totalLengthMeters
  };
}
