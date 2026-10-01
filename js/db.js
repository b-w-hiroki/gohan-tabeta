// Data layer. Day records are keyed by "YYYY-MM-DD"; photos are stored as Blobs.
// Records live in IndexedDB (local) or Firestore (after login); callers use the exports below.
const DB_NAME = 'gohan-tabeta';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// Run work spanning both stores as one IndexedDB transaction. If any write
// fails (including quota exhaustion), none of the clears or writes commit.
function runStores(storeNames, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
    let result;
    let operationError = null;
    try {
      result = fn(stores);
    } catch (error) {
      operationError = error;
      tx.abort();
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(operationError || tx.error);
    tx.onabort = () => reject(operationError || tx.error || new Error('IndexedDB transaction aborted'));
  }));
}

export const MEAL_TYPES = [
  { id: 'breakfast', label: '朝食', icon: '🌅' },
  { id: 'lunch', label: '昼食', icon: '☀️' },
  { id: 'dinner', label: '夕食', icon: '🌙' },
  { id: 'snack', label: '間食', icon: '🍪' },
];

export function emptyDay(date) {
  const meals = {};
  for (const t of MEAL_TYPES) meals[t.id] = { items: [], photos: [], memo: '' };
  return { date, meals, exercises: [] };
}

// ---------- local store (IndexedDB) ----------
export const localStore = {
  getDay: (date) => run('days', 'readonly', (s) => s.get(date)),
  putDay: (day) => run('days', 'readwrite', (s) => s.put(day)),
  getDaysInRange: (from, to) => run('days', 'readonly', (s) => s.getAll(IDBKeyRange.bound(from, to))),
  getAllDays: () => run('days', 'readonly', (s) => s.getAll()),
  putPhoto: (photo) => run('photos', 'readwrite', (s) => s.put(photo)),
  getPhoto: (id) => run('photos', 'readonly', (s) => s.get(id)),
  deletePhoto: (id) => run('photos', 'readwrite', (s) => s.delete(id)),
  getAllPhotos: () => run('photos', 'readonly', (s) => s.getAll()),
  clearAll() {
    return runStores(['days', 'photos'], 'readwrite', ({ days, photos }) => {
      days.clear();
      photos.clear();
    });
  },
  replaceAll(daysToSave, photosToSave) {
    return runStores(['days', 'photos'], 'readwrite', ({ days, photos }) => {
      days.clear();
      photos.clear();
      for (const day of daysToSave) days.put(day);
      for (const photo of photosToSave) photos.put(photo);
    });
  },
};

// ---------- active store: local by default, cloud after login ----------
let store = localStore;
export function useStore(next) { store = next; }

export async function getDay(date) {
  const day = await store.getDay(date);
  if (!day) return emptyDay(date);
  // Fill in meal types added after the record was created.
  for (const t of MEAL_TYPES) {
    if (!day.meals[t.id]) day.meals[t.id] = { items: [], photos: [], memo: '' };
  }
  if (!Array.isArray(day.exercises)) day.exercises = [];
  return day;
}

export const putDay = (day) => store.putDay(day);
export const getDaysInRange = (from, to) => store.getDaysInRange(from, to);
export const getAllDays = () => store.getAllDays();
export const putPhoto = (photo) => store.putPhoto(photo);
export const getPhoto = (id) => store.getPhoto(id);
export const deletePhoto = (id) => store.deletePhoto(id);
export const getAllPhotos = () => store.getAllPhotos();
export const clearAll = () => store.clearAll();

// Local storage has a truly atomic implementation. Remote stores cannot span
// an arbitrary number of documents atomically, so preserve a complete backup
// and restore it if any write fails.
export async function replaceAllData(days, photos) {
  if (typeof store.replaceAll === 'function') return store.replaceAll(days, photos);

  const [oldDays, oldPhotos] = await Promise.all([store.getAllDays(), store.getAllPhotos()]);
  try {
    await store.clearAll();
    for (const photo of photos) await store.putPhoto(photo);
    for (const day of days) await store.putDay(day);
  } catch (importError) {
    try {
      await store.clearAll();
      for (const photo of oldPhotos) await store.putPhoto(photo);
      for (const day of oldDays) await store.putDay(day);
    } catch (rollbackError) {
      throw new AggregateError([importError, rollbackError], 'Import and rollback both failed');
    }
    throw importError;
  }
}

export function dayTotal(day) {
  let total = 0;
  for (const t of MEAL_TYPES) total += mealTotal(day.meals[t.id]);
  return total;
}

// One-tap checks on the exercise tab, stored as booleans on the day record.
export const EXERCISE_CHECKS = [
  { id: 'workout', label: '運動した' },
  { id: 'gym', label: 'ジム行った' },
];

// Any exercise on the day: a check, or a recorded entry.
export function didExercise(day) {
  return EXERCISE_CHECKS.some((c) => day[c.id]) || (day.exercises || []).length > 0;
}

export function exerciseTotal(day) {
  return (day.exercises || []).reduce((sum, ex) => sum + (Number(ex.kcal) || 0), 0);
}

// All food items of a day, across meals.
export function dayItems(day) {
  return MEAL_TYPES.flatMap((t) => day.meals[t.id]?.items || []);
}

export function mealTotal(meal) {
  if (!meal) return 0;
  return meal.items.reduce((sum, it) => sum + (Number(it.kcal) || 0), 0);
}

export function hasContent(meal) {
  return !!meal && (meal.items.length > 0 || meal.photos.length > 0 || meal.memo.trim() !== '');
}
