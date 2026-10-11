import { describe, it, expect } from 'vitest';
import { parseLichternachtStations, parsePastedHelperText, parseSheetHelpers } from './helperImportParser';

describe('helperImportParser', () => {
  describe('parsePastedHelperText', () => {
    it('should parse simple name list', () => {
      const text = `
        Anna Schmidt
        Michael Weber
        Thomas Müller
      `;
      const result = parsePastedHelperText(text);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'Anna Schmidt', phone: '' });
      expect(result[1]).toEqual({ name: 'Michael Weber', phone: '' });
      expect(result[2]).toEqual({ name: 'Thomas Müller', phone: '' });
    });

    it('should ignore numbering, bullets and headers', () => {
      const text = `
        Name
        1. Lisa Meier
        - Stefan Huber
        * Peter Meier
        • Hans Wurst
      `;
      const result = parsePastedHelperText(text);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ name: 'Lisa Meier', phone: '' });
      expect(result[1]).toEqual({ name: 'Stefan Huber', phone: '' });
      expect(result[2]).toEqual({ name: 'Peter Meier', phone: '' });
      expect(result[3]).toEqual({ name: 'Hans Wurst', phone: '' });
    });

    it('should parse names with trailing phones', () => {
      const text = `
        Stefan Huber - 0160/998877
        Peter Meier (0151 223344)
        Thomas Müller, 09822 1234
        Anna Schmidt 01711234567
      `;
      const result = parsePastedHelperText(text);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ name: 'Stefan Huber', phone: '0160/998877' });
      expect(result[1]).toEqual({ name: 'Peter Meier', phone: '0151 223344' });
      expect(result[2]).toEqual({ name: 'Thomas Müller', phone: '09822 1234' });
      expect(result[3]).toEqual({ name: 'Anna Schmidt', phone: '01711234567' });
    });

    it('should parse tab-separated lines', () => {
      const text = `
Anna Schmidt\t0171 1234567
Michael\tWeber\t0160 9876543
      `;
      const result = parsePastedHelperText(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Anna Schmidt', phone: '0171 1234567' });
      expect(result[1]).toEqual({ name: 'Michael Weber', phone: '0160 9876543' });
    });

    it('should deduplicate names (case-insensitive)', () => {
      const text = `
        Anna Schmidt
        ANNA schmidt
        Michael Weber
      `;
      const result = parsePastedHelperText(text);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Anna Schmidt');
    });
  });

  describe('parseSheetHelpers', () => {
    it('should parse sheet with Vorname, Nachname, Telefon headers', () => {
      const sheet = [
        ['Vorname', 'Nachname', 'Telefon'],
        ['Anna', 'Schmidt', '0171 1234567'],
        ['Michael', 'Weber', ''],
        ['', '', ''] // Empty row
      ];
      const result = parseSheetHelpers(sheet);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Anna Schmidt', phone: '0171 1234567' });
      expect(result[1]).toEqual({ name: 'Michael Weber', phone: '' });
    });

    it('should parse sheet with single Name column', () => {
      const sheet = [
        ['Titel', 'Helfer-Name', 'Alter'],
        ['Herr', 'Stefan Huber', '30'],
        ['Frau', 'Lisa Meier', '25']
      ];
      const result = parseSheetHelpers(sheet);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Stefan Huber', phone: '' });
      expect(result[1]).toEqual({ name: 'Lisa Meier', phone: '' });
    });

    it('should fallback to first column and second column for headerless sheet', () => {
      const sheet = [
        ['Peter Meier', '0151 223344'],
        ['Hans Wurst', '0987654321']
      ];
      const result = parseSheetHelpers(sheet);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Peter Meier', phone: '0151 223344' });
      expect(result[1]).toEqual({ name: 'Hans Wurst', phone: '0987654321' });
    });

    it('should ignore placeholders', () => {
      const sheet = [
        ['Name', 'Phone'],
        ['Offen', ''],
        ['Frei', ''],
        ['-', ''],
        ['Anna Schmidt', '1234']
      ];
      const result = parseSheetHelpers(sheet);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Anna Schmidt');
    });
  });

  describe('parseLichternachtStations', () => {
    it('keeps the stable station id and the exact map position', () => {
      const sheet = [
        ['id', 'name', 'address', 'offer', 'lat', 'lng'],
        [12, 'Lichtladen', 'Hauptstraße 12', 'Glühwein', 49.1574, 10.5483],
        [13, 'Bühne', '', '', 49.1575, 10.5484]
      ];
      expect(parseLichternachtStations(sheet)).toEqual([
        { stationId: '12', name: 'Lichtladen', address: 'Hauptstraße 12', latitude: 49.1574, longitude: 10.5483 },
        { stationId: '13', name: 'Bühne', address: '', latitude: 49.1575, longitude: 10.5484 }
      ]);
    });

    it('rejects incomplete rows and duplicate ids', () => {
      const sheet = [
        ['id', 'name', 'address', 'lat', 'lng'],
        [1, 'Gültig', '', 49.1, 10.5],
        [1, 'Doppelt', '', 49.2, 10.6],
        [2, 'Ohne Koordinate', '', '', 10.6]
      ];
      expect(parseLichternachtStations(sheet)).toHaveLength(1);
    });
  });
});
