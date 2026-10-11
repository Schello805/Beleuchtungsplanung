/**
 * Helper import parsing utilities for Excel and pasted text
 */

export interface ParsedHelperItem {
  name: string;
  phone: string;
}

export interface ParsedStationItem {
  stationId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** Parses the official `stationen.xlsx` export of the Lichternacht admin. */
export function parseLichternachtStations(rawRows: any[][]): ParsedStationItem[] {
  if (!rawRows.length) return [];
  const header = rawRows[0].map(cell => String(cell || '').trim().toLowerCase());
  const id = header.indexOf('id');
  const name = header.indexOf('name');
  const address = header.indexOf('address');
  const lat = header.indexOf('lat');
  const lng = header.indexOf('lng');
  if ([id, name, lat, lng].some(index => index < 0)) return [];

  const seen = new Set<string>();
  return rawRows.slice(1).flatMap(row => {
    const stationId = String(row[id] ?? '').trim();
    const stationName = String(row[name] ?? '').trim();
    const rawLatitude = row[lat];
    const rawLongitude = row[lng];
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (!stationId || !stationName || seen.has(stationId) || String(rawLatitude ?? '').trim() === '' || String(rawLongitude ?? '').trim() === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return [];
    seen.add(stationId);
    return [{ stationId, name: stationName, address: address >= 0 ? String(row[address] ?? '').trim() : '', latitude, longitude }];
  });
}

/**
 * Parses freeform pasted text (e.g. from WhatsApp, emails, Word or spreadsheets).
 * Handles lines like:
 * - "Anna Schmidt"
 * - "Michael Weber 0171 1234567"
 * - "Thomas Müller, 09822 1234"
 * - "1. Lisa Meier"
 * - "Stefan Huber - 0160/998877"
 * - "Peter Meier (0151 223344)"
 * - Tab-separated text from Excel copy-paste (Name \t Phone or Vorname \t Nachname)
 */
export function parsePastedHelperText(text: string): ParsedHelperItem[] {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result: ParsedHelperItem[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    // Remove list numbering like "1.", "1)", "-", "•", "*", etc.
    let line = rawLine.replace(/^([*\-•]|\d+[.)])\s*/, '').trim();
    if (!line) continue;

    // Skip pure header words
    const lower = line.toLowerCase();
    if (lower === 'name' || lower === 'helfer' || lower === 'vorname nachname' || lower === 'teilnehmer' || lower === 'telefon' || lower.startsWith('name\t')) {
      continue;
    }

    // Check if tab-separated (e.g. copied from Excel/Calc)
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const isPart1Phone = /[\d+]{5,}/.test(parts[1]);
        if (isPart1Phone) {
          const name = parts[0];
          const phone = parts[1];
          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            result.push({ name, phone });
          }
          continue;
        } else if (parts.length >= 3 && /[\d+]{5,}/.test(parts[2])) {
          // Vorname \t Nachname \t Telefon
          const name = `${parts[0]} ${parts[1]}`.trim();
          const phone = parts[2];
          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            result.push({ name, phone });
          }
          continue;
        } else {
          // Two name columns (Vorname \t Nachname)
          const name = `${parts[0]} ${parts[1]}`.trim();
          const phone = parts.slice(2).join(' ').trim();
          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            result.push({ name, phone });
          }
          continue;
        }
      }
    }

    // Try extracting phone number from line
    // e.g. "Name (0171 12345)" or "Name, 0171 12345" or "Name - +49 171..." or "Name: 0171..."
    let name = line;
    let phone = '';

    const phoneRegex = /(?:[,;:|\-\/]\s*|\s*\()(\+?[0-9\s\/\-\(\)]{6,}\)?)/;
    const phoneMatch = line.match(phoneRegex);

    if (phoneMatch) {
      phone = phoneMatch[1].replace(/[()]/g, '').trim();
      name = line.replace(phoneMatch[0], '').trim();
    } else {
      // Check if end of line has a phone number without punctuation: e.g. "Max Mustermann 01711234567"
      const trailingPhoneMatch = line.match(/\s+(\+?[0-9][0-9\s\/\-]{6,}[0-9])$/);
      if (trailingPhoneMatch) {
        phone = trailingPhoneMatch[1].trim();
        name = line.slice(0, trailingPhoneMatch.index).trim();
      }
    }

    // Clean up trailing punctuation on name
    name = name.replace(/[,;:\-]+$/, '').trim();

    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      result.push({ name, phone });
    }
  }

  return result;
}

/**
 * Extracts helpers from raw Excel sheet rows with support for:
 * - Single Name column
 * - Split Vorname / Nachname columns
 * - Headerless spreadsheets (takes column 0 as name, column 1 as phone)
 * - German & English column headers
 */
export function parseSheetHelpers(rawRows: any[][]): ParsedHelperItem[] {
  if (!rawRows || rawRows.length === 0) return [];

  let headerRowIdx = -1;
  let nameCol = -1;
  let vornameCol = -1;
  let nachnameCol = -1;
  let phoneCol = -1;
  let helperCol = -1;

  for (let r = 0; r < Math.min(6, rawRows.length); r++) {
    const row = (rawRows[r] || []).map(c => String(c || '').trim().toLowerCase());

    row.forEach((cell, idx) => {
      if (cell === 'vorname' || cell.includes('vorname') || cell === 'first name') vornameCol = idx;
      else if (cell === 'nachname' || cell.includes('nachname') || cell === 'last name' || cell.includes('familienname')) nachnameCol = idx;
      else if (cell === 'name' || cell === 'helfer-name' || cell === 'helfername' || cell.includes('vollständiger name')) nameCol = idx;
      else if (cell.includes('helfer') || cell.includes('teilnehmer') || cell.includes('mitarbeiter') || cell.includes('person')) helperCol = idx;
      
      if (/\b(telefon|phone|mobil|handy|tel)\b/i.test(cell)) {
        phoneCol = idx;
      }
    });

    if (vornameCol !== -1 || nameCol !== -1 || helperCol !== -1) {
      headerRowIdx = r;
      break;
    }
  }

  const startR = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
  const result: ParsedHelperItem[] = [];
  const seen = new Set<string>();

  for (let r = startR; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    let name = '';
    let phone = '';

    if (vornameCol !== -1 && nachnameCol !== -1) {
      const v = String(row[vornameCol] || '').trim();
      const n = String(row[nachnameCol] || '').trim();
      name = `${v} ${n}`.trim();
    } else if (nameCol !== -1) {
      name = String(row[nameCol] || '').trim();
    } else if (helperCol !== -1) {
      name = String(row[helperCol] || '').trim();
    } else {
      // No header matched -> fallback to col 0
      name = String(row[0] || '').trim();
    }

    if (phoneCol !== -1) {
      phone = String(row[phoneCol] || '').trim();
    } else if (row.length > 1 && (headerRowIdx === -1 || (nameCol === 0 && phoneCol === -1))) {
      // If 2nd column looks like phone
      const candidate = String(row[1] || '').trim();
      if (/[\d+]{5,}/.test(candidate)) {
        phone = candidate;
      }
    }

    const lower = name.toLowerCase();
    if (!name || lower === 'name' || lower === 'helfer' || lower === 'vorname' || lower === 'nachname' || lower === 'nr.' || lower === 'nr') {
      continue;
    }

    // Ignore placeholder values like "offen", "frei", "-", "nicht zugewiesen"
    if (lower === 'offen' || lower === 'frei' || lower === '-' || lower === '—' || lower === 'nicht zugewiesen' || lower === 'unbesetzt') {
      continue;
    }

    if (!seen.has(lower)) {
      seen.add(lower);
      result.push({ name, phone });
    }
  }

  return result;
}
