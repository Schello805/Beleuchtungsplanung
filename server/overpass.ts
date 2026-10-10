import * as turf from '@turf/turf';
import fs from 'node:fs';
import path from 'node:path';

// Bechhofen (PLZ 91572) Bounding Box: [minLat, minLon, maxLat, maxLon]
const BECHHOFEN_BBOX = '49.1241,10.4857,49.2170,10.6304';

// Multiple Overpass endpoints for 100% high availability & failover
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

interface OsmWay {
  id: number;
  geometry: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local pre-compiled Bechhofen street dataset
let localStreetsCache: Record<string, OsmWay[]> = {};

function loadLocalStreets(): Record<string, OsmWay[]> {
  if (Object.keys(localStreetsCache).length > 0) {
    return localStreetsCache;
  }

  const possiblePaths = [
    path.resolve(process.cwd(), 'data', 'bechhofen_streets_osm.json'),
    path.resolve(process.cwd(), 'public', 'data', 'bechhofen_streets_osm.json'),
    path.resolve(__dirname, '..', 'data', 'bechhofen_streets_osm.json'),
    path.resolve(__dirname, '..', 'public', 'data', 'bechhofen_streets_osm.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        localStreetsCache = JSON.parse(raw);
        console.log(`[Overpass] Successfully loaded ${Object.keys(localStreetsCache).length} local Bechhofen streets from ${p}`);
        return localStreetsCache;
      }
    } catch (e) {
      console.warn(`[Overpass] Failed reading local street dataset at ${p}:`, e);
    }
  }

  return localStreetsCache;
}

// Preload on startup
loadLocalStreets();

/**
 * Normalizes street names for ultra-tolerant matching:
 * Handles 'ß' vs 'ss', 'Str.' vs 'Straße', whitespace, casing, hyphens.
 */
export function normalizeStreetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/str\./g, 'straße')
    .replace(/straße\b/g, 'str')
    .replace(/strasse\b/g, 'str')
    .replace(/ß|ss/g, '#')
    .replace(/[^a-z0-9#]/g, '');
}

/**
 * Generates exact spelling variants for Overpass queries without slow regexes:
 * e.g., 'Schlossstraße' -> ['Schlossstraße', 'Schloßstraße', 'Schlossstrasse', ...]
 */
export function generateNameVariants(input: string): string[] {
  const trimmed = input.trim();
  const queue = [trimmed];
  const visited = new Set([trimmed]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const withBeta = curr.replace(/ss/gi, 'ß');
    if (!visited.has(withBeta)) {
      visited.add(withBeta);
      queue.push(withBeta);
    }
    const withSS = curr.replace(/ß/gi, 'ss');
    if (!visited.has(withSS)) {
      visited.add(withSS);
      queue.push(withSS);
    }
    const withStrasse = curr.replace(/str\./gi, 'straße');
    if (!visited.has(withStrasse)) {
      visited.add(withStrasse);
      queue.push(withStrasse);
    }
  }

  const finalSet = new Set<string>();
  for (const item of visited) {
    finalSet.add(item);
    const cap = item.charAt(0).toUpperCase() + item.slice(1);
    finalSet.add(cap);
  }
  return Array.from(finalSet);
}

/**
 * Creates a regex pattern for backwards-compatibility.
 */
export function buildSsToleranceRegex(input: string): string {
  return input.trim().replace(/ß|ss/gi, '(ß|ss)');
}

/**
 * Fetches data from Overpass via POST (required by modern Overpass servers to avoid 406/504 errors).
 */
async function queryOverpass(query: string): Promise<any> {
  let lastError: any = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LichternachtStreckenplaner/1.0 (GIS-App Bechhofen)'
        },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      } else {
        lastError = new Error(`Endpoint ${endpoint} returned HTTP ${res.status}`);
      }
    } catch (err: any) {
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
  const local = loadLocalStreets();
  const localKeys = Object.keys(local);
  if (localKeys.length > 0) {
    return localKeys.sort((a, b) => a.localeCompare(b, 'de'));
  }

  const query = `[out:json][timeout:25][bbox:${BECHHOFEN_BBOX}];way["highway"]["name"];out tags;`;

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

    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  } catch (err) {
    console.error('Failed to prefetch street names:', err);
    return [
      'Ansbacher Straße', 'Dinkelsbühler Straße', 'Feuchtwanger Straße',
      'Gunzenhausener Straße', 'Kirchstraße', 'Marktplatz', 'Kirchenallee',
      'Am Plärrer', 'Schloßstraße', 'Goethestraße', 'Schillerstraße', 'Krummweiherweg'
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
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = branches.map((branch) => {
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
 * Searches for a street by name with ultra-tolerant "ß" / "ss" / "str." matching.
 * Checks local Bechhofen database first for 0ms response, with live Overpass failover.
 */
export async function getStreetGeometry(streetName: string): Promise<{
  streetName: string;
  features: GeoJSON.Feature<GeoJSON.LineString>[];
  totalLengthMeters: number;
}> {
  const local = loadLocalStreets();
  const normalizedTarget = normalizeStreetName(streetName);

  // 1. Try local exact match
  if (local[streetName] && local[streetName].length > 0) {
    const features = stitchWaysToLines(local[streetName]);
    const totalLengthMeters = features.reduce((sum, f) => sum + Math.round(turf.length(f, { units: 'kilometers' }) * 1000), 0);
    return { streetName, features, totalLengthMeters };
  }

  // 2. Try normalized match in local dataset
  for (const [key, ways] of Object.entries(local)) {
    if (normalizeStreetName(key) === normalizedTarget && ways.length > 0) {
      const features = stitchWaysToLines(ways);
      const totalLengthMeters = features.reduce((sum, f) => sum + Math.round(turf.length(f, { units: 'kilometers' }) * 1000), 0);
      return { streetName: key, features, totalLengthMeters };
    }
  }

  // 3. Fallback to Overpass API query with variants & global bbox
  const variants = generateNameVariants(streetName);
  const query = `[out:json][timeout:25][bbox:${BECHHOFEN_BBOX}];
(
${variants.map(v => `  way["highway"]["name"="${v}"];`).join('\n')}
);
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

  const matchedName = ways[0]?.tags?.name || streetName;

  // Cache to local memory
  localStreetsCache[matchedName] = ways;

  const features = stitchWaysToLines(ways);
  let totalLengthMeters = 0;
  for (const f of features) {
    totalLengthMeters += Math.round(turf.length(f, { units: 'kilometers' }) * 1000);
  }

  return {
    streetName: matchedName,
    features,
    totalLengthMeters
  };
}
