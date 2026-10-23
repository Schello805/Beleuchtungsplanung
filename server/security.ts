export const plannerSettingKeys = [
  'candle_spacing', 'candle_buffer', 'map_tile_theme', 'theme',
  'distribution_default_chunk_length', 'distribution_min_work_meters',
  'distribution_max_work_meters', 'distribution_max_difference_meters', 'distribution_assignment_mode'
];

export function filterImportedSettings(data: any, role: string) {
  if (role === 'admin' || !data?.settings) return data;
  return { ...data, settings: Object.fromEntries(Object.entries(data.settings).filter(([key]) => plannerSettingKeys.includes(key))) };
}

export const redactRequestUrl = (url: string) => url
  .replace(/(\/public\/helpers\/|\/passwort-setzen\/|\/einladung\/)[^/?]+/g, '$1[redacted]')
  .replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
