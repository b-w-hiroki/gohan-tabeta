const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i;

function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function invalid(message) {
  throw new Error(`Invalid backup: ${message}`);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
}

async function decodePhoto(photo, index) {
  assertRecord(photo, `photos[${index}]`);
  if (typeof photo.id !== 'string' || !photo.id) invalid(`photos[${index}].id is missing`);
  if (!isDateKey(photo.date)) invalid(`photos[${index}].date is invalid`);
  if (typeof photo.data !== 'string') invalid(`photos[${index}].data is missing`);
  const match = DATA_URL.exec(photo.data);
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) invalid(`photos[${index}].data is not a valid image`);
  let binary;
  try { binary = atob(match[2]); } catch { invalid(`photos[${index}].data is not valid base64`); }
  if (!binary.length) invalid(`photos[${index}].data is empty`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1] });
  try {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
  } catch {
    invalid(`photos[${index}].data cannot be decoded as an image`);
  }
  return { id: photo.id, date: photo.date, blob };
}

function referencedPhotoIds(day) {
  const ids = [];
  for (const [mealName, meal] of Object.entries(day.meals)) {
    assertRecord(meal, `day ${day.date} meal ${mealName}`);
    if (!Array.isArray(meal.items)) invalid(`day ${day.date} meal ${mealName}.items must be an array`);
    if (typeof meal.memo !== 'string') invalid(`day ${day.date} meal ${mealName}.memo must be a string`);
    if (!Array.isArray(meal.photos)) invalid(`day ${day.date} meal ${mealName}.photos must be an array`);
    for (const id of meal.photos) {
      if (typeof id !== 'string' || !id) invalid(`day ${day.date} contains an invalid photo reference`);
      ids.push(id);
    }
  }
  return ids;
}

// Parse and fully validate/decode before the caller asks for confirmation or
// touches existing records.
export async function prepareBackupText(text) {
  let data;
  try { data = JSON.parse(text); } catch { invalid('JSON could not be parsed'); }
  assertRecord(data, 'root');
  if (data.app !== 'gohan-tabeta' || data.version !== 1) invalid('app or version does not match');
  if (!Array.isArray(data.days)) invalid('days must be an array');
  if (data.photos != null && !Array.isArray(data.photos)) invalid('photos must be an array');
  if (data.settings != null) assertRecord(data.settings, 'settings');
  const settings = { ...(data.settings || {}) };
  // version 1 exports historically also carried these two values at the top level.
  if (settings.goalKcal == null && data.goalKcal != null) settings.goalKcal = data.goalKcal;
  if (settings.profile == null && data.profile != null) settings.profile = data.profile;
  if (settings.goalKcal != null && (!Number.isFinite(Number(settings.goalKcal)) || Number(settings.goalKcal) <= 0)) {
    invalid('settings.goalKcal is invalid');
  }
  if (settings.profile != null) assertRecord(settings.profile, 'settings.profile');
  if (settings.myFoods != null && !Array.isArray(settings.myFoods)) invalid('settings.myFoods must be an array');

  const dayKeys = new Set();
  const references = [];
  for (const [index, day] of data.days.entries()) {
    assertRecord(day, `days[${index}]`);
    if (!isDateKey(day.date)) invalid(`days[${index}].date is invalid`);
    if (dayKeys.has(day.date)) invalid(`duplicate day ${day.date}`);
    dayKeys.add(day.date);
    assertRecord(day.meals, `days[${index}].meals`);
    references.push(...referencedPhotoIds(day));
  }

  const photoIds = new Set();
  const photos = await Promise.all((data.photos || []).map(async (photo, index) => {
    const decoded = await decodePhoto(photo, index);
    if (photoIds.has(decoded.id)) invalid(`duplicate photo ${decoded.id}`);
    photoIds.add(decoded.id);
    return decoded;
  }));
  for (const id of references) if (!photoIds.has(id)) invalid(`referenced photo ${id} is missing`);

  return { days: data.days, photos, settings };
}
