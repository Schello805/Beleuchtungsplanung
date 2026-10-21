// Only these three formatting tags are supported; all other HTML stays text.
export function formatMailText(value: string): string {
  const escaped = value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return escaped.replace(/\[(\/)?(b|i|u)\]/gi, (_match, closing: string, tag: string) => {
    const htmlTag = { b: 'strong', i: 'em', u: 'u' }[tag.toLowerCase()]!;
    return `<${closing ? '/' : ''}${htmlTag}>`;
  }).replace(/\r?\n/g, '<br>');
}

export const plainMailText = (value: string) => value.replace(/\[\/?(?:b|i|u)\]/gi, '');
