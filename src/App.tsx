import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Sidebar } from './components/Sidebar';
import { CapturePanel } from './components/CapturePanel';
import { RedistributeModal } from './components/RedistributeModal';
import { AutoAssignModal } from './components/AutoAssignModal';
import { PublicHelperPage } from './components/PublicHelperPage';
import { AdminSettingsModal } from './components/AdminSettingsModal';

const MapComponent = lazy(() => import('./components/MapComponent').then(module => ({ default: module.MapComponent })));
const PrintView = lazy(() => import('./components/PrintView').then(module => ({ default: module.PrintView })));
const ExcelImportModal = lazy(() => import('./components/ExcelImportModal').then(module => ({ default: module.ExcelImportModal })));
import { api, type Section, type Helper, type Street, type AuthUser, type PublicHelperInfo } from './utils/api';
import { splitSectionAtPoint, splitSectionInHalf, type GeneratedSection } from './utils/geo';
import { Check, X, UserRound, ChevronDown, Menu, Wrench } from 'lucide-react';
import * as turf from '@turf/turf';

export const App: React.FC = () => {
  const publicToken = window.location.pathname.match(/^\/helfer\/([A-Za-z0-9_-]{20,})\/?$/)?.[1] || null;
  const [publicHelperInfo, setPublicHelperInfo] = useState<PublicHelperInfo | null>(null);
  const [publicHelperError, setPublicHelperError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'anonymous' | 'authenticated' | 'setup-required'>('loading');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileCaptureOpen, setIsMobileCaptureOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [isAdminSettingsOpen, setIsAdminSettingsOpen] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', displayName: '', password: '', role: 'planner' as AuthUser['role'] });
  const [userManagementError, setUserManagementError] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [streets, setStreets] = useState<Street[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  // Preview & Capture state
  const [previewSections, setPreviewSections] = useState<GeneratedSection[]>([]);
  const [currentStreetInfo, setCurrentStreetInfo] = useState<{
    name: string;
    method: string;
    chunkLength: number;
    minLength: number;
    totalLength: number;
  } | null>(null);

  const [captureMode, setCaptureMode] = useState<'none' | 'segment' | 'custom_path' | 'point'>('none');
  const [segmentPoints, setSegmentPoints] = useState<[number, number][]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [focusedPreviewId, setFocusedPreviewId] = useState<string | null>(null);
  const [extensionSectionId, setExtensionSectionId] = useState<string | null>(null);
  const [splitSectionId, setSplitSectionId] = useState<string | null>(null);

  // Theme & Map Layer (Synced directly with SQLite DB)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mapTileTheme, setMapTileTheme] = useState<string>('dark');
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>('');
  const [eventName, setEventName] = useState<string>('Lichternacht Bechhofen');
  const [eventLocation, setEventLocation] = useState<string>('Bechhofen a.d. Heide (PLZ 91572)');
  const [streetSearchArea, setStreetSearchArea] = useState({ city: 'Bechhofen', postalCode: '91572' });
  const [organizerPhone, setOrganizerPhone] = useState<string>('');
  const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);
  const [isRedistributeOpen, setIsRedistributeOpen] = useState<boolean>(false);
  const [isAutoAssignOpen, setIsAutoAssignOpen] = useState<boolean>(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState<boolean>(false);
  const [excelImportInitialTab, setExcelImportInitialTab] = useState<'helpers' | 'schedule'>('helpers');
  const [excelImportInputMethod, setExcelImportInputMethod] = useState<'file' | 'paste'>('file');

  // Candle & Material Planning state
  const [candleSpacing, setCandleSpacing] = useState<number>(2.0);
  const [candleBuffer, setCandleBuffer] = useState<number>(10);
  const [distributionDefaults, setDistributionDefaults] = useState({ targetChunkLength: 40, minWorkMeters: 35, maxWorkMeters: 50, maxDifferenceMeters: 15, assignmentMode: 'station_first' as 'station_first' | 'meters_only' });

  // Helfer-Finder: zeigt auf der Karte die zugehörigen Abschnitte an.
  const [activeStampHelperId, setActiveStampHelperId] = useState<string | null>(null);
  const [autoAdvanceStamp, setAutoAdvanceStamp] = useState<boolean>(true);

  const handleUpdateCandleConfig = async (spacing: number, buffer: number) => {
    setCandleSpacing(spacing);
    setCandleBuffer(buffer);
    await api.setSetting('candle_spacing', String(spacing));
    await api.setSetting('candle_buffer', String(buffer));
  };

  const handleSavePublicBaseUrl = async (value: string) => {
    setPublicBaseUrl(value);
    await api.setSetting('public_base_url', value);
  };

  const handleMapTileThemeChange = async (newTileTheme: string) => {
    setMapTileTheme(newTileTheme);
    await api.setSetting('map_tile_theme', newTileTheme);
  };

  const handleToggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    await api.setSetting('theme', nextTheme);
  };

  // Database status & multi-PC network access
  const [dbStatus, setDbStatus] = useState<{
    online: boolean;
    networkIps: string[];
    helpersCount: number;
    streetsCount: number;
    sectionsCount: number;
  } | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [lastAutomaticAssignments, setLastAutomaticAssignments] = useState<Array<{ sectionId: string; helperId: string; helperName: string }> | null>(null);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load Initial Data & Settings from SQLite Database
  const loadData = useCallback(async () => {
    try {
      // 1. Check for legacy localStorage data and auto-migrate to SQLite
      const mig = await api.checkAndMigrateLocalStorage();
      if (mig.migrated) {
        setMigrationNotice(`Alte Browser-Daten wurden erfolgreich in die zentrale SQLite-Datenbank übertragen (${mig.importedStreets} Straßen, ${mig.importedSections} Abschnitte)!`);
      }

      // 2. Fetch all data directly from SQLite
      const [h, s, sec, settings, status] = await Promise.all([
        api.getHelpers(),
        api.getStreets(),
        api.getSections(),
        api.getSettings(),
        api.getStatus().catch(() => null)
      ]);

      setHelpers(h);
      setStreets(s);
      setSections(sec);

      if (status) {
        setDbStatus({
          online: true,
          networkIps: (status as any).networkIps || [],
          helpersCount: h.length,
          streetsCount: s.length,
          sectionsCount: sec.length
        });
      } else {
        setDbStatus({
          online: false,
          networkIps: [],
          helpersCount: h.length,
          streetsCount: s.length,
          sectionsCount: sec.length
        });
      }

      if (settings.mapbox_token !== undefined) {
        setMapboxToken(settings.mapbox_token);
      }
      if (settings.public_base_url !== undefined) {
        setPublicBaseUrl(settings.public_base_url);
      }
      if (settings.event_name) setEventName(settings.event_name);
      if (settings.event_location) setEventLocation(settings.event_location);
      setStreetSearchArea({
        city: settings.street_search_city?.trim() || 'Bechhofen',
        postalCode: settings.street_search_postal_code?.trim() || '91572'
      });
      if (settings.organizer_phone !== undefined) setOrganizerPhone(settings.organizer_phone);
      if (settings.map_tile_theme) {
        setMapTileTheme(settings.map_tile_theme);
      }
      if (settings.theme === 'dark' || settings.theme === 'light') {
        setTheme(settings.theme);
      }
      if (settings.candle_spacing) {
        setCandleSpacing(parseFloat(settings.candle_spacing) || 2.0);
      }
      if (settings.candle_buffer) {
        setCandleBuffer(parseInt(settings.candle_buffer, 10) || 10);
      }
      setDistributionDefaults({
        targetChunkLength: parseInt(settings.distribution_default_chunk_length, 10) || 40,
        minWorkMeters: parseInt(settings.distribution_min_work_meters, 10) || 35,
        maxWorkMeters: parseInt(settings.distribution_max_work_meters, 10) || 50,
        maxDifferenceMeters: parseInt(settings.distribution_max_difference_meters, 10) || 15,
        assignmentMode: settings.distribution_assignment_mode === 'meters_only' ? 'meters_only' : 'station_first'
      });
    } catch (err) {
      console.error('Failed to load data from database:', err);
    }
  }, []);

  useEffect(() => {
    api.getSession()
      .then(session => {
        if (session.authenticated && session.user) {
          setCurrentUser(session.user);
          setAuthState('authenticated');
        } else {
          setAuthState(session.setupRequired ? 'setup-required' : 'anonymous');
        }
      })
      .catch(() => setAuthState('anonymous'));
  }, []);

  useEffect(() => {
    if (!publicToken) return;
    api.getPublicHelper(publicToken).then(setPublicHelperInfo).catch(error => {
      setPublicHelperError(error instanceof Error ? error.message : 'Der Helfer-Link ist nicht verfügbar.');
    });
  }, [publicToken]);

  useEffect(() => {
    if (authState === 'authenticated') loadData();
  }, [authState, loadData]);

  // Refresh after returning to the planner. A short polling loop used to replace
  // all map layers every few seconds, even when no planning data had changed.
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const handleFocus = () => {
      loadData();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [authState, loadData]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const user = await api.login(loginEmail, loginPassword);
      setLoginPassword('');
      setCurrentUser(user);
      setAuthState('authenticated');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setAuthState('anonymous');
  };

  const openUserManagement = async () => {
    setUserManagementError(null);
    try {
      setManagedUsers(await api.getUsers());
      setIsUserManagementOpen(true);
    } catch (error) {
      setUserManagementError(error instanceof Error ? error.message : 'Benutzerverwaltung konnte nicht geöffnet werden.');
    }
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setUserManagementError(null);
    try {
      const created = await api.createUser(newUser);
      setManagedUsers(users => [...users, created].sort((a, b) => a.email.localeCompare(b.email)));
      setNewUser({ email: '', displayName: '', password: '', role: 'planner' });
    } catch (error) {
      setUserManagementError(error instanceof Error ? error.message : 'Benutzer konnte nicht angelegt werden.');
    }
  };

  // Map Click Handler for interactive capture
  const handleMapClick = (lat: number, lon: number) => {
    if (captureMode === 'segment') {
      if (segmentPoints.length === 0) {
        setSegmentPoints([[lat, lon]]);
      } else if (segmentPoints.length === 1) {
        setSegmentPoints([segmentPoints[0], [lat, lon]]);
      }
    } else if (captureMode === 'custom_path') {
      // Sonderwege werden bewusst frei auf der Karte gezeichnet. Damit können
      // auch Wege, Brücken oder Platzränder ohne OSM-Straßenname erfasst werden.
      setSegmentPoints(points => [...points, [lat, lon]]);
    } else if (captureMode === 'point') {
      if (typeof (window as any).__onPointMapClick === 'function') {
        (window as any).__onPointMapClick(lat, lon);
      }
    }
  };

  const handleExtendSection = async (targetLat: number, targetLon: number) => {
    const sectionId = extensionSectionId;
    const section = sections.find(item => item.id === sectionId);
    setExtensionSectionId(null);
    if (!sectionId || !section || section.geojson.geometry.type !== 'LineString') {
      alert('Dieser Abschnitt kann nur verlängert werden, wenn er als zusammenhängende Linie vorliegt.');
      return;
    }

    const existingCoordinates = section.geojson.geometry.coordinates;
    if (existingCoordinates.length < 2) return;
    const first = existingCoordinates[0];
    const last = existingCoordinates[existingCoordinates.length - 1];
    const target: [number, number] = [targetLon, targetLat];
    const firstDistance = turf.distance(turf.point(first), turf.point(target), { units: 'kilometers' });
    const lastDistance = turf.distance(turf.point(last), turf.point(target), { units: 'kilometers' });
    const extendAtStart = firstDistance <= lastDistance;
    const endpoint = extendAtStart ? first : last;

    try {
      const route = await api.getFootRoute(endpoint[0], endpoint[1], targetLon, targetLat);
      const routeCoordinates = route.geometry.coordinates as [number, number][];
      const combinedCoordinates = extendAtStart
        ? [...routeCoordinates.slice().reverse().slice(0, -1), ...existingCoordinates]
        : [...existingCoordinates, ...routeCoordinates.slice(1)];
      const geojson = turf.lineString(combinedCoordinates);
      const lengthMeters = Math.max(1, Math.round(turf.length(geojson, { units: 'kilometers' }) * 1000));
      await api.updateSection(sectionId, { geojson, length_meters: lengthMeters });
      setSections(current => current.map(item => item.id === sectionId
        ? { ...item, geojson, length_meters: lengthMeters, lengthMeters }
        : item));
    } catch (error) {
      console.error('Abschnitt verlängern fehlgeschlagen:', error);
      alert('Der Abschnitt konnte nicht verlängert werden. Bitte versuche es erneut.');
    }
  };

  const handleSplitSectionAtPoint = async (targetLat: number, targetLon: number) => {
    const sectionId = splitSectionId;
    const section = sections.find(item => item.id === sectionId);
    setSplitSectionId(null);
    if (!sectionId || !section) return;

    const parts = splitSectionAtPoint(section, [targetLon, targetLat], sections.length);
    if (!parts) {
      alert('Bitte klicke mindestens 5 m von Anfang und Ende des Abschnitts entfernt.');
      return;
    }

    try {
      await api.replaceAllSections(sections.flatMap(item => item.id === sectionId ? parts : [item]));
      setSelectedSectionId(parts[0].id);
      await loadData();
    } catch (error) {
      console.error('Abschnitt an Kartenpunkt teilen fehlgeschlagen:', error);
      alert('Der Abschnitt konnte nicht geteilt werden. Bitte versuche es erneut.');
    }
  };

  // Handle Preview Generated
  const handlePreviewGenerated = (
    newSections: GeneratedSection[],
    streetInfo: { name: string; method: string; chunkLength: number; minLength: number; totalLength: number }
  ) => {
    setPreviewSections(newSections);
    setCurrentStreetInfo(streetInfo);
  };

  // Clear Preview
  const handleClearPreview = () => {
    setPreviewSections([]);
    setCurrentStreetInfo(null);
    setSegmentPoints([]);
    setFocusedPreviewId(null);
  };

  // Remove a single section from preview ("raus-xen")
  const handleRemovePreviewSection = (sectionId: string) => {
    setPreviewSections(prev => {
      const remaining = prev.filter(s => s.id !== sectionId);
      if (remaining.length === 0) {
        setCurrentStreetInfo(null);
      }
      return remaining;
    });
    if (focusedPreviewId === sectionId) {
      setFocusedPreviewId(null);
    }
  };

  // Save Preview to Database
  const handleSavePreview = async () => {
    if (!currentStreetInfo || previewSections.length === 0) return;
    setIsSaving(true);

    try {
      if (currentStreetInfo.method === 'batch') {
        // Group previewSections by their streetName
        const streetMap = new Map<string, GeneratedSection[]>();
        previewSections.forEach(sec => {
          const streetName = (sec as any).streetName || currentStreetInfo.name;
          const list = streetMap.get(streetName) || [];
          list.push(sec);
          streetMap.set(streetName, list);
        });

        const batch: Array<{ street: any; sections: any[] }> = [];
        let sIdx = 0;
        for (const [stName, secs] of streetMap.entries()) {
          const streetId = `st-b-${Date.now()}-${sIdx++}`;
          const streetTotal = secs.reduce((sum, s) => sum + (s.lengthMeters || 0), 0);
          const streetRecord = {
            id: streetId,
            name: stName,
            method: 'batch',
            chunk_length: currentStreetInfo.chunkLength,
            min_length: currentStreetInfo.minLength,
            total_length: streetTotal
          };

          const sectionRecords = secs.map((sec, idx) => ({
            id: sec.id,
            street_id: streetId,
            street_name: stName,
            section_index: idx + 1,
            label: sec.label,
            length_meters: sec.lengthMeters,
            color: sec.color,
            type: sec.type,
            lighting_side: sec.lighting_side || 'both',
            geojson: sec.geojson,
            assigned_helper_id: null,
            assigned_helper_name: null,
            notes: null
          }));

          batch.push({ street: streetRecord, sections: sectionRecords });
        }

        await api.saveBatchStreetsWithSections(batch);
      } else {
        const streetId = `st-${Date.now()}`;
        const streetTotal = previewSections.reduce((sum, s) => sum + (s.lengthMeters || 0), 0);
        const streetRecord = {
          id: streetId,
          name: currentStreetInfo.name,
          method: currentStreetInfo.method,
          chunk_length: currentStreetInfo.chunkLength,
          min_length: currentStreetInfo.minLength,
          total_length: streetTotal
        };

        const sectionRecords = previewSections.map((sec, idx) => ({
          id: sec.id,
          street_id: streetId,
          street_name: sec.streetName || currentStreetInfo.name,
          section_index: idx + 1,
          label: sec.label,
          length_meters: sec.lengthMeters,
          color: sec.color,
          type: sec.type,
          lighting_side: sec.lighting_side || 'both',
          geojson: sec.geojson,
          assigned_helper_id: null,
          assigned_helper_name: null,
          notes: null
        }));

        await api.saveStreetWithSections(streetRecord, sectionRecords);
      }

      // Reset capture and preview
      handleClearPreview();
      setCaptureMode('none');

      // Reload fresh data from SQLite
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Speichern: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Update Section Helper Assignment
  const handleUpdateSectionHelper = async (
    sectionId: string,
    helperId: string | null,
    helperName: string | null
  ) => {
    // A later manual change must never be overwritten by an old auto-plan undo.
    setLastAutomaticAssignments(null);
    // Optimistic UI update
    setSections(prev =>
      prev.map(s =>
        s.id === sectionId
          ? { ...s, assigned_helper_id: helperId, assigned_helper_name: helperName }
          : s
      )
    );

    try {
      await api.updateSection(sectionId, {
        assigned_helper_id: helperId,
        assigned_helper_name: helperName
      });
    } catch (err) {
      console.error('Update section helper error:', err);
      loadData(); // Revert on error
    }
  };

  const handleUpdateSectionLightingSide = async (sectionId: string, lightingSide: 'both' | 'left' | 'right') => {
    setSections(prev => prev.map(section => section.id === sectionId ? { ...section, lighting_side: lightingSide } : section));
    try {
      await api.updateSection(sectionId, { lighting_side: lightingSide });
    } catch (err) {
      console.error('Update section lighting side error:', err);
      loadData();
    }
  };

  const handleUpdateSectionNotes = async (sectionId: string, notes: string) => {
    setSections(prev => prev.map(section => section.id === sectionId ? { ...section, notes } : section));
    try {
      await api.updateSection(sectionId, { notes });
    } catch (err) {
      console.error('Update section notes error:', err);
      loadData();
    }
  };

  const handleMergeSections = async (firstId: string, secondId: string) => {
    const first = sections.find(section => section.id === firstId);
    const second = sections.find(section => section.id === secondId);
    if (!first || !second || first.type !== 'line' || second.type !== 'line' || first.geojson.geometry.type !== 'LineString' || second.geojson.geometry.type !== 'LineString') return;
    const firstCoordinates = first.geojson.geometry.coordinates;
    const secondCoordinates = second.geojson.geometry.coordinates;
    const variants = [
      [firstCoordinates, secondCoordinates],
      [firstCoordinates, [...secondCoordinates].reverse()],
      [[...firstCoordinates].reverse(), secondCoordinates],
      [[...firstCoordinates].reverse(), [...secondCoordinates].reverse()]
    ];
    const best = variants.sort((left, right) => turf.distance(turf.point(left[0].at(-1)!), turf.point(left[1][0]), { units: 'meters' }) - turf.distance(turf.point(right[0].at(-1)!), turf.point(right[1][0]), { units: 'meters' }))[0];
    const gap = turf.distance(turf.point(best[0].at(-1)!), turf.point(best[1][0]), { units: 'meters' });
    if (gap > 25) {
      alert('Zusammenführen ist nur für direkt angrenzende Abschnitte möglich.');
      return;
    }
    const coordinates = [...best[0], ...best[1].slice(1)];
    const geojson = turf.lineString(coordinates);
    const lengthMeters = Math.max(1, Math.round(turf.length(geojson, { units: 'kilometers' }) * 1000));
    const sameAssignment = first.assigned_helper_id === second.assigned_helper_id;
    const inherited = sameAssignment || !second.assigned_helper_id ? first : !first.assigned_helper_id ? second : null;
    const merged: Section = {
      ...first,
      section_index: Math.min(first.section_index, second.section_index),
      label: `${first.street_name} – Abschnitte ${Math.min(first.section_index, second.section_index)}–${Math.max(first.section_index, second.section_index)}`,
      geojson,
      length_meters: lengthMeters,
      lengthMeters,
      assigned_helper_id: inherited?.assigned_helper_id || null,
      assigned_helper_name: inherited?.assigned_helper_name || null,
      lighting_side: first.lighting_side === second.lighting_side ? first.lighting_side : 'both',
      notes: [first.notes, second.notes].filter(Boolean).join(' · ') || null
    };
    try {
      await api.replaceAllSections(sections.filter(section => section.id !== firstId && section.id !== secondId).concat(merged));
      setSelectedSectionId(merged.id);
      await loadData();
    } catch (err) {
      console.error('Merge sections error:', err);
      alert('Die Abschnitte konnten nicht zusammengeführt werden.');
    }
  };

  // Delete Section
  const handleDeleteSection = async (sectionId: string) => {
    try {
      await api.deleteSection(sectionId);
      setSections(prev => prev.filter(s => s.id !== sectionId));
      if (selectedSectionId === sectionId) setSelectedSectionId(null);
    } catch (err) {
      console.error('Delete section error:', err);
    }
  };

  // Fair Redistribution (Subdivide into N sections)
  const handleApplyRedistribute = async (newSections: Section[]) => {
    try {
      await api.replaceAllSections(newSections);
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Speichern der neuen Aufteilung: ${err.message}`);
    }
  };

  // Split single section in half
  const handleSplitSection = async (sectionId: string) => {
    const target = sections.find(s => s.id === sectionId);
    if (!target) return;
    const parts = splitSectionInHalf(target, sections.length);
    if (!parts) {
      alert('Dieser Abschnitt ist zu kurz zum Teilen (unter 16 m).');
      return;
    }
    const updated = sections.flatMap(s => (s.id === sectionId ? parts : [s]));
    try {
      await api.replaceAllSections(updated);
      await loadData();
    } catch (err: any) {
      alert(`Fehler beim Halbieren: ${err.message}`);
    }
  };

  // Helper CRUD
  const handleAddHelper = async (name: string, color?: string, phone?: string, email?: string) => {
    try {
      const created = await api.addHelper(name, color, phone, email);
      setHelpers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'de')));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdateHelper = async (id: string, name: string, color?: string, phone?: string, email?: string) => {
    try {
      await api.updateHelper(id, name, color, phone, email);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteHelper = async (id: string) => {
    try {
      await api.deleteHelper(id);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImportHelpers = async (helperList: Array<{ name: string; phone?: string; email?: string; color?: string }>, mode: 'replace' | 'append' | 'sync') => {
    try {
      const count = await api.importHelpers(helperList, mode);
      await loadData();
      alert(`Erfolgreich ${count} Helfer in die zentrale SQLite-Datenbank importiert!`);
    } catch (err: any) {
      alert(`Fehler beim Importieren: ${err.message}`);
    }
  };

  const handleOpenHelperImport = (method: 'file' | 'paste' = 'file') => {
    setExcelImportInitialTab('helpers');
    setExcelImportInputMethod(method);
    setIsExcelImportOpen(true);
  };

  const handleDeleteAllHelpers = async () => {
    try {
      await api.deleteAllHelpers();
      await loadData();
      alert('Alle Helfer wurden erfolgreich gelöscht. Zugewiesene Abschnitte wurden freigegeben.');
    } catch (err: any) {
      alert(`Fehler beim Löschen aller Helfer: ${err.message}`);
    }
  };

  // Backup & Restore
  const handleExportBackup = async () => {
    try {
      const blob = await api.exportDatabase();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lichternacht_bechhofen_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export fehlgeschlagen: ${err.message}`);
    }
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!confirm('Soll dieses Backup wirklich eingespielt werden? Bestehende Daten werden überschrieben.')) {
        return;
      }
      await api.importDatabase(json);
      await loadData();
      alert('Backup erfolgreich wiederhergestellt!');
    } catch (err: any) {
      alert(`Fehler beim Importieren: ${err.message}`);
    }
  };

  const handleResetDatabase = async () => {
    if (confirm('Achtung: Möchtest du wirklich alle erfassten Straßen, Helfer und Zuweisungen löschen?')) {
      try {
        await api.resetDatabase();
        handleClearPreview();
        await loadData();
        alert('Datenbank wurde zurückgesetzt.');
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  // Batch Helper Assignment (Auto Fairness or Street Batch)
  const handleBatchAssign = async (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => {
    // Optimistic UI update
    const map = new Map(assignments.map(a => [a.sectionId, a]));
    setSections(prev =>
      prev.map(s => {
        const item = map.get(s.id);
        if (item) {
          return { ...s, assigned_helper_id: item.helperId || null, assigned_helper_name: item.helperName || null };
        }
        return s;
      })
    );

    try {
      await api.batchAssignHelpers(assignments);
    } catch (err) {
      console.error('Batch assign error:', err);
      loadData();
    }
  };

  const handleAutomaticAssign = async (assignments: Array<{ sectionId: string; helperId: string; helperName: string }>) => {
    const previous = assignments.map(assignment => {
      const section = sections.find(item => item.id === assignment.sectionId);
      return {
        sectionId: assignment.sectionId,
        helperId: section?.assigned_helper_id || '',
        helperName: section?.assigned_helper_name || ''
      };
    });
    await handleBatchAssign(assignments);
    setLastAutomaticAssignments(previous);
  };

  const handleUndoAutomaticAssign = async () => {
    if (!lastAutomaticAssignments) return;
    await handleBatchAssign(lastAutomaticAssignments);
    setLastAutomaticAssignments(null);
  };

  if (publicToken) {
    if (publicHelperInfo) return <PublicHelperPage info={publicHelperInfo} />;
    return <main className="auth-screen"><section className="auth-card"><p className="auth-kicker">LICHTERNACHT BECHHOFEN</p><h1>Helfer-Information</h1><p>{publicHelperError || 'Dein persönlicher Bereich wird geladen …'}</p></section></main>;
  }

  if (authState !== 'authenticated') {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-mark">✦</div>
          <p className="auth-kicker">LICHTERNACHT BECHHOFEN</p>
          <h1>Streckenplanung</h1>
          {authState === 'loading' ? <p>Prüfe Anmeldung …</p> : authState === 'setup-required' ? <p>Der Zugang ist auf diesem Server noch nicht eingerichtet. Bitte die Administrator-Zugangsdaten in der Server-Konfiguration setzen.</p> : (
            <form onSubmit={handleLogin} className="auth-form">
              <label>E-Mail-Adresse<input type="email" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} autoComplete="username" required /></label>
              <label>Passwort<input type="password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} autoComplete="current-password" required /></label>
              {loginError && <p className="auth-error">{loginError}</p>}
              <button type="submit" disabled={isLoggingIn}>{isLoggingIn ? 'Anmeldung läuft …' : 'Anmelden'}</button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="planner-shell" style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <button
        type="button"
        className="no-print mobile-admin-toggle"
        onClick={() => setIsMobileSidebarOpen(true)}
        aria-label="Planungsmenü öffnen"
      >
        <Menu size={20} /> <span>Planung</span>
      </button>
      <div className="no-print app-user-menu">
        <button className="app-user-toggle" onClick={() => setIsAccountMenuOpen(open => !open)}>
          <UserRound size={15} /><span>{currentUser?.display_name}</span><ChevronDown size={14} />
        </button>
        {isAccountMenuOpen && <div className="app-user-popover">
          <strong>{currentUser?.display_name}</strong><small>{currentUser?.role === 'admin' ? 'Administrator' : currentUser?.role === 'planner' ? 'Planung' : 'Lesen'}</small>
          {currentUser?.role === 'admin' && <>
            <button onClick={() => { setIsAccountMenuOpen(false); setIsAdminSettingsOpen(true); }}>Einstellungen & Anleitung</button>
            <button onClick={() => { setIsAccountMenuOpen(false); openUserManagement(); }}>Benutzer verwalten</button>
          </>}
          <button className="logout" onClick={handleLogout}>Abmelden</button>
        </div>}
      </div>
      {/* SIDEBAR */}
      <Sidebar
        sections={sections}
        helpers={helpers}
        streets={streets}
        selectedSectionId={selectedSectionId}
        onSelectSection={setSelectedSectionId}
        onUpdateSectionHelper={handleUpdateSectionHelper}
        onDeleteSection={handleDeleteSection}
        onAddHelper={handleAddHelper}
        onUpdateHelper={handleUpdateHelper}
        onDeleteHelper={handleDeleteHelper}
        onImportHelpers={handleImportHelpers}
        onOpenPrintView={() => setIsPrintOpen(true)}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onResetDatabase={handleResetDatabase}
        onBatchAssign={handleBatchAssign}
        onOpenRedistributeModal={() => setIsRedistributeOpen(true)}
        onSplitSection={handleSplitSection}
        activeStampHelperId={activeStampHelperId}
        onSelectStampHelper={setActiveStampHelperId}
        onOpenAutoAssign={() => setIsAutoAssignOpen(true)}
        onOpenExcelImport={() => {
          setExcelImportInitialTab('schedule');
          setExcelImportInputMethod('file');
          setIsExcelImportOpen(true);
        }}
        onOpenHelperImport={handleOpenHelperImport}
        onDeleteAllHelpers={handleDeleteAllHelpers}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        candleSpacing={candleSpacing}
        candleBuffer={candleBuffer}
        onUpdateCandleConfig={handleUpdateCandleConfig}
        mobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />
      {isMobileSidebarOpen && <button type="button" className="no-print mobile-sidebar-scrim" aria-label="Planungsmenü schließen" onClick={() => setIsMobileSidebarOpen(false)} />}

      {/* MAP & CAPTURE AREA */}
      <main style={{ flex: 1, position: 'relative', height: '100%' }}>
        <button
          type="button"
          className="no-print mobile-map-tools-toggle"
          onClick={() => setIsMobileCaptureOpen(open => !open)}
          aria-expanded={isMobileCaptureOpen}
        >
          <Wrench size={17} /> {isMobileCaptureOpen ? 'Karte' : 'Werkzeuge'}
        </button>
        {/* Floating Capture Panel */}
        <div
          className={`no-print capture-panel-wrapper${isMobileCaptureOpen ? ' mobile-capture-open' : ''}`}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1000,
            width: 350,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto'
          }}
        >
          <CapturePanel
            streetSearchArea={streetSearchArea}
            onPreviewGenerated={handlePreviewGenerated}
            onClearPreview={handleClearPreview}
            previewSections={previewSections}
            onRemovePreviewSection={handleRemovePreviewSection}
            focusedPreviewId={focusedPreviewId}
            onFocusPreviewSection={setFocusedPreviewId}
            onSavePreview={handleSavePreview}
            isSaving={isSaving}
            captureMode={captureMode}
            setCaptureMode={setCaptureMode}
            segmentPoints={segmentPoints}
            setSegmentPoints={setSegmentPoints}
          />
        </div>

        {/* The former technical database/network badge has been intentionally
            removed from the workspace: planning actions are the priority. */}
        {false && <div
          className="no-print"
          style={{
            position: 'absolute',
            top: 16,
            left: 412,
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '6px 12px',
            boxShadow: 'var(--shadow-card)',
            backdropFilter: 'blur(12px)',
            fontSize: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dbStatus?.online !== false ? '#10B981' : '#EF4444',
                boxShadow: dbStatus?.online !== false ? '0 0 8px #10B981' : '0 0 8px #EF4444'
              }}
            />
            <Database size={14} color="var(--accent-gold)" />
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              SQLite Zentral
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              ({sections.length} Abschnitte | {streets.length} Straßen)
            </span>
          </div>

          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 4px' }} />

          {lastAutomaticAssignments && (
            <button
              onClick={handleUndoAutomaticAssign}
              title="Letzte automatische Zuweisung zurücksetzen"
              style={{ border: '1px solid #F59E0B', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--accent-gold)', borderRadius: 5, padding: '3px 7px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}
            >
              <Undo2 size={13} /> Auto-Zuweisung rückgängig
            </button>
          )}

          {/* Network URL for multi-PC access */}
          {dbStatus?.networkIps && dbStatus.networkIps.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={13} color="#3B82F6" />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Auf anderen PCs:
              </span>
              <code style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, color: '#38BDF8' }}>
                {window.location.origin}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.origin);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
                title="Netzwerk-Link kopieren, um ihn auf anderem PC im Browser zu öffnen"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedUrl ? '#10B981' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  padding: '2px 4px'
                }}
              >
                {copiedUrl ? <Check size={12} /> : <Copy size={12} />}
                {copiedUrl ? 'Kopiert!' : 'Kopieren'}
              </button>
            </div>
          )}
        </div>}

        {/* Migration notice banner */}
        {migrationNotice && (
          <div
            className="no-print"
            style={{
              position: 'absolute',
              top: 56,
              left: 412,
              zIndex: 950,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#065F46',
              border: '1px solid #10B981',
              color: '#ECFDF5',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
          >
            <Check size={14} color="#10B981" />
            <span>{migrationNotice}</span>
            <button
              onClick={() => setMigrationNotice(null)}
              style={{ background: 'transparent', border: 'none', color: '#ECFDF5', cursor: 'pointer', marginLeft: 8 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Interactive Map */}
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Karte wird geladen...</div>}>
          <MapComponent
            sections={sections}
            previewSections={previewSections}
            helpers={helpers}
            selectedSectionId={selectedSectionId}
            onSelectSection={setSelectedSectionId}
            onUpdateSectionHelper={handleUpdateSectionHelper}
            onUpdateSectionLightingSide={handleUpdateSectionLightingSide}
            onUpdateSectionNotes={handleUpdateSectionNotes}
            onMergeSections={handleMergeSections}
            onDeleteSection={handleDeleteSection}
            extensionSectionId={extensionSectionId}
            onStartExtension={(sectionId) => { setSelectedSectionId(sectionId); setSplitSectionId(null); setExtensionSectionId(sectionId); }}
            onExtensionTarget={handleExtendSection}
            onCancelExtension={() => setExtensionSectionId(null)}
            splitSectionId={splitSectionId}
            onStartSplit={(sectionId) => { setSelectedSectionId(sectionId); setExtensionSectionId(null); setSplitSectionId(sectionId); }}
            onSplitTarget={handleSplitSectionAtPoint}
            onCancelSplit={() => setSplitSectionId(null)}
            activeStampHelperId={activeStampHelperId}
            onSelectStampHelper={setActiveStampHelperId}
            autoAdvanceStamp={autoAdvanceStamp}
            onToggleAutoAdvanceStamp={setAutoAdvanceStamp}
            onOpenAutoAssign={() => setIsAutoAssignOpen(true)}
            onRemovePreviewSection={handleRemovePreviewSection}
            focusedPreviewId={focusedPreviewId}
            onFocusPreviewSection={setFocusedPreviewId}
            captureMode={captureMode}
            segmentPoints={segmentPoints}
            onMapClick={handleMapClick}
            mapTileTheme={mapTileTheme}
            onMapTileThemeChange={handleMapTileThemeChange}
            mapboxToken={mapboxToken}
          />
        </Suspense>
      </main>

      {/* PRINT VIEW MODAL OVERLAY */}
      {isPrintOpen && (
        <Suspense fallback={null}>
          <PrintView
            sections={sections}
            helpers={helpers}
            candleSpacing={candleSpacing}
            candleBuffer={candleBuffer}
            publicBaseUrl={publicBaseUrl}
            eventName={eventName}
            eventLocation={eventLocation}
            organizerPhone={organizerPhone}
            onSavePublicBaseUrl={handleSavePublicBaseUrl}
            onClose={() => setIsPrintOpen(false)}
          />
        </Suspense>
      )}

      {/* FAIR REDISTRIBUTION MODAL */}
      <RedistributeModal
        isOpen={isRedistributeOpen}
        onClose={() => setIsRedistributeOpen(false)}
        sections={sections}
        helpers={helpers}
        onApply={handleApplyRedistribute}
        defaults={distributionDefaults}
      />

      {/* 1-CLICK AUTO-ASSIGN MODAL */}
      <AutoAssignModal
        isOpen={isAutoAssignOpen}
        onClose={() => setIsAutoAssignOpen(false)}
        sections={sections}
        helpers={helpers}
        onApply={handleAutomaticAssign}
        defaults={distributionDefaults}
      />

      {/* UNIVERSAL EXCEL IMPORT MODAL */}
      <Suspense fallback={null}>
        <ExcelImportModal
          isOpen={isExcelImportOpen}
          onClose={() => setIsExcelImportOpen(false)}
          initialTab={excelImportInitialTab}
          initialInputMethod={excelImportInputMethod}
          sections={sections}
          helpers={helpers}
          onApplyAssignments={handleBatchAssign}
          onImportHelpers={handleImportHelpers}
          onRefreshData={loadData}
          onDeleteAllHelpers={handleDeleteAllHelpers}
        />
      </Suspense>
      {isUserManagementOpen && (
        <div className="user-modal-backdrop">
          <section className="user-modal">
            <button className="user-modal-close" onClick={() => setIsUserManagementOpen(false)}>×</button>
            <p className="auth-kicker">ADMINISTRATION</p><h2>Benutzer & Rechte</h2>
            <div className="user-list">{managedUsers.map(user => <div key={user.id}><strong>{user.display_name}</strong><span>{user.email} · {user.role === 'admin' ? 'Administrator' : user.role === 'planner' ? 'Planung' : 'Lesen'}</span></div>)}</div>
            <form onSubmit={handleCreateUser} className="auth-form">
              <h3>Neuen Zugang anlegen</h3>
              <label>Name<input value={newUser.displayName} onChange={event => setNewUser(value => ({ ...value, displayName: event.target.value }))} required /></label>
              <label>E-Mail-Adresse<input type="email" value={newUser.email} onChange={event => setNewUser(value => ({ ...value, email: event.target.value }))} required /></label>
              <label>Einmaliges Passwort<input type="password" minLength={12} value={newUser.password} onChange={event => setNewUser(value => ({ ...value, password: event.target.value }))} required /></label>
              <label>Rolle<select value={newUser.role} onChange={event => setNewUser(value => ({ ...value, role: event.target.value as AuthUser['role'] }))}><option value="planner">Planung – darf bearbeiten</option><option value="viewer">Lesen – nur ansehen</option><option value="admin">Administrator – volle Verwaltung</option></select></label>
              {userManagementError && <p className="auth-error">{userManagementError}</p>}
              <button type="submit">Zugang anlegen</button>
            </form>
          </section>
        </div>
      )}
      {currentUser?.role === 'admin' && (
        <AdminSettingsModal
          isOpen={isAdminSettingsOpen}
          onClose={() => setIsAdminSettingsOpen(false)}
          onSaved={loadData}
        />
      )}
    </div>
  );
};

export default App;
