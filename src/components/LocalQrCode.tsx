import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function LocalQrCode({ value, size }: { value: string; size: number }) {
  const [image, setImage] = useState('');
  useEffect(() => {
    let active = true;
    setImage('');
    QRCode.toDataURL(value, { width: size * 3, margin: 1 }).then(url => { if (active) setImage(url); });
    return () => { active = false; };
  }, [value, size]);
  return image ? <img src={image} alt="QR-Code zur Helfer-Information" style={{ width: size, height: size }} /> : <span style={{ display: 'inline-block', width: size, height: size }}>QR-Code lädt …</span>;
}
