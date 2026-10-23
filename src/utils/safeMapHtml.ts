import DOMPurify from 'dompurify';

export function safeMapHtml(parts: TemplateStringsArray, ...values: unknown[]) {
  const html = parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index] ?? '') : ''), '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'] });
}
