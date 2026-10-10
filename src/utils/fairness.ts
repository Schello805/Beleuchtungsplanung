import type { Section, Helper } from './api';

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
