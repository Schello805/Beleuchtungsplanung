import { describe, expect, it } from 'vitest';
import { formatMailText, plainMailText } from './mailFormatting';

describe('mail formatting', () => {
  it('renders nested basic formatting and preserves placeholders and line breaks', () => {
    expect(formatMailText('[b]Hallo [i]{{name}}[/i][/b]\n[u]Wichtig[/u]')).toBe('<strong>Hallo <em>{{name}}</em></strong><br><u>Wichtig</u>');
  });
  it('escapes arbitrary HTML instead of executing it', () => {
    expect(formatMailText('<img src=x onerror="alert(1)"> & [b]Text[/b]')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; <strong>Text</strong>');
  });
  it('removes formatting markers from the text alternative', () => {
    expect(plainMailText('[b]Hallo[/b] [i]Welt[/i] [u]{{link}}[/u]')).toBe('Hallo Welt {{link}}');
  });
});
