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
  async clearAll() {
    await run('days', 'readwrite', (s) => s.clear());
    await run('photos', 'readwrite', (s) => s.clear());
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

export function dayTotal(day) {
  let total = 0;
  for (const t of MEAL_TYPES) total += mealTotal(day.meals[t.id]);
  return total;
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
