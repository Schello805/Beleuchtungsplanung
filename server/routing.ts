import * as turf from '@turf/turf';

const OSRM_FOOT_ENDPOINTS = [
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  'https://router.project-osrm.org/route/v1/foot'
];

export interface RoutingResult {
  distanceMeters: number;
  geometry: GeoJSON.LineString;
  durationSeconds: number;
}

/**
 * Calculates pedestrian/foot routing between start and end coordinates.
 * Coordinates are formatted as [lon, lat].
 */
export async function getFootRoute(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number
): Promise<RoutingResult> {
  let lastError: any = null;

  for (const endpoint of OSRM_FOOT_ENDPOINTS) {
    try {
      const url = `${endpoint}/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson&steps=false`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'LichternachtStreckenplaner/1.0 (GIS-App Bechhofen)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          return {
            distanceMeters: Math.round(route.distance),
            geometry: route.geometry,
            durationSeconds: Math.round(route.duration)
          };
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback: If OSRM is offline, fallback to straight geodesic line with warning
  console.warn('OSRM routing offline, generating direct geodesic path as fallback:', lastError);
  const directLine = turf.lineString([
    [startLon, startLat],
    [endLon, endLat]
  ]);
  const len = Math.round(turf.length(directLine, { units: 'kilometers' }) * 1000);

  return {
    distanceMeters: len,
    geometry: directLine.geometry,
    durationSeconds: Math.round(len / 1.2) // walking speed approx 1.2 m/s
  };
}
