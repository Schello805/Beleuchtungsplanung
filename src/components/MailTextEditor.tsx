import React, { useRef } from 'react';
import { formatMailText } from '../utils/mailFormatting';

export function MailTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const apply = (tag: string) => {
    const field = input.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    onChange(`${value.slice(0, start)}[${tag}]${value.slice(start, end)}[/${tag}]${value.slice(end)}`);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + 3, end + 3); });
  };
  return <div>
    <div role="toolbar" aria-label="Text formatieren" style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
      {(['b', 'i', 'u'] as const).map(tag => <button key={tag} type="button" title={{ b: 'Fett', i: 'Kursiv', u: 'Unterstrichen' }[tag]} onMouseDown={event => event.preventDefault()} onClick={() => apply(tag)} style={{ padding: '6px 12px', borderRadius: 5, border: '1px solid var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: tag === 'b' ? 800 : 400, fontStyle: tag === 'i' ? 'italic' : 'normal', textDecoration: tag === 'u' ? 'underline' : 'none' }}>
        {{ b: 'Fett', i: 'Kursiv', u: 'Unterstrichen' }[tag]}
      </button>)}
    </div>
    <textarea ref={input} aria-label="E-Mail-Nachricht" rows={9} value={value} onChange={event => onChange(event.target.value)} />
    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Text markieren und Format wählen. Die Markierungen [b], [i] und [u] werden beim Versand formatiert.</p>
    <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }}>Formatierungsvorschau</summary><div style={{ background: '#FFFFFF', color: '#1F2937', padding: 16, fontWeight: 400, lineHeight: 1.6, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: formatMailText(value) }} /></details>
  </div>;
}
