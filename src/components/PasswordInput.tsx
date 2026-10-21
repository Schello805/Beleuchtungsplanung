import React, { useState } from 'react';

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
    <input {...props} type={visible ? 'text' : 'password'} style={{ ...props.style, flex: 1, minWidth: 0 }} />
    <button type="button" aria-pressed={visible} aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'} onClick={() => setVisible(value => !value)} style={{ padding: '10px 8px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', fontSize: 11 }}>
      {visible ? 'Verbergen' : 'Anzeigen'}
    </button>
  </div>;
}
