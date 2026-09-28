// IndexedDB wrapper. Day records are keyed by "YYYY-MM-DD"; photos are stored as Blobs.
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
  return { date, meals };
}

export async function getDay(date) {
  const day = await run('days', 'readonly', (s) => s.get(date));
  if (!day) return emptyDay(date);
  // Fill in meal types added after the record was created.
  for (const t of MEAL_TYPES) {
    if (!day.meals[t.id]) day.meals[t.id] = { items: [], photos: [], memo: '' };
  }
  return day;
}

export function putDay(day) {
  return run('days', 'readwrite', (s) => s.put(day));
}

export function getDaysInRange(from, to) {
  return run('days', 'readonly', (s) => s.getAll(IDBKeyRange.bound(from, to)));
}

export function getAllDays() {
  return run('days', 'readonly', (s) => s.getAll());
}

export function putPhoto(photo) {
  return run('photos', 'readwrite', (s) => s.put(photo));
}

export function getPhoto(id) {
  return run('photos', 'readonly', (s) => s.get(id));
}

export function deletePhoto(id) {
  return run('photos', 'readwrite', (s) => s.delete(id));
}

export function getAllPhotos() {
  return run('photos', 'readonly', (s) => s.getAll());
}

export async function clearAll() {
  await run('days', 'readwrite', (s) => s.clear());
  await run('photos', 'readwrite', (s) => s.clear());
}

export function dayTotal(day) {
  let total = 0;
  for (const t of MEAL_TYPES) total += mealTotal(day.meals[t.id]);
  return total;
}

export function mealTotal(meal) {
  if (!meal) return 0;
  return meal.items.reduce((sum, it) => sum + (Number(it.kcal) || 0), 0);
}

export function hasContent(meal) {
  return !!meal && (meal.items.length > 0 || meal.photos.length > 0 || meal.memo.trim() !== '');
}
