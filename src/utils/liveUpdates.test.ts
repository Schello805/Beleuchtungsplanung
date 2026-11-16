// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptPlanningRevision, currentPlanningRevision, planningEditorOpen, planningFetch } from './liveUpdates';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
describe('live planning updates', () => {
  it('sends the accepted baseline and advances only after a successful local write', async () => {
    acceptPlanningRevision('old');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'X-Planning-Revision': 'new' } }));
    vi.stubGlobal('fetch', fetcher);
    await planningFetch('/api/helpers/1', { method: 'PUT' });
    expect(fetcher.mock.calls[0][1].headers.get('X-Planning-Revision')).toBe('old');
    expect(currentPlanningRevision()).toBe('new');
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: 'Konflikt' }), { status: 409 }));
    await expect(planningFetch('/api/helpers/1', { method: 'PUT' })).rejects.toThrow('Konflikt');
    expect(currentPlanningRevision()).toBe('new');
  });
  it('protects focused fields, map popup editors and open dialogs', () => {
    expect(planningEditorOpen()).toBe(false);
    document.body.innerHTML = '<input />';
    document.querySelector('input')!.focus();
    expect(planningEditorOpen()).toBe(true);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(planningEditorOpen()).toBe(true);
    document.body.innerHTML = '<div class="leaflet-popup"><textarea></textarea></div>';
    expect(planningEditorOpen()).toBe(true);
  });
});
