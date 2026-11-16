let revision: string | null = null;
export function acceptPlanningRevision(value: string) { revision = value; }
export function currentPlanningRevision() { return revision; }

/** Successful local writes advance our revision; foreign changes only advance it
 * once the UI has accepted a refresh, preserving stale-editor conflict checks. */
export async function planningFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const method = init?.method || 'GET';
  const localApi = typeof input === 'string' && input.startsWith('/api/');
  if (localApi && revision && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-Planning-Revision', revision);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    window.dispatchEvent(new CustomEvent('planning-conflict', { detail: body.error }));
    throw new Error(body.error || 'Die Planung wurde inzwischen geändert. Bitte den aktuellen Stand prüfen.');
  }
  const nextRevision = response.headers.get('X-Planning-Revision');
  if (response.ok && nextRevision) revision = nextRevision;
  return response;
}

export function planningEditorOpen() {
  return !!document.querySelector('[data-planning-editor], [role="dialog"], .modal-overlay, .user-modal-backdrop, .leaflet-popup input, .leaflet-popup textarea, .leaflet-popup select')
    || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
}
