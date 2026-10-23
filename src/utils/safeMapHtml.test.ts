// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { safeMapHtml } from './safeMapHtml';

it('removes executable imported content while retaining popup controls', () => {
  const note = '</textarea><img src=x onerror="alert(1)"><script>alert(1)</script>';
  const result = safeMapHtml`<textarea>${note}</textarea><button id="save-note">Speichern</button>`;
  expect(result).not.toContain('onerror');
  expect(result).not.toContain('<script');
  expect(result).toContain('id="save-note"');
});

it('removes script URLs from injected links', () => {
  expect(safeMapHtml`<b>${'<a href="javascript:alert(1)">Name</a>'}</b>`).not.toContain('javascript:');
});
