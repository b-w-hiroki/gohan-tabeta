// Firebase Auth + Firestore. Loaded lazily so the app still works offline / without a config.
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
let fb = null; // { auth, db, a: authModule, f: firestoreModule }

export const isConfigured = () => !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);

export async function initCloud() {
  if (fb || !isConfigured()) return fb;
  const [{ initializeApp }, a, f] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = a.getAuth(app);
  await a.setPersistence(auth, a.browserLocalPersistence).catch(() => {});
  let db;
  try {
    // Offline cache: records open instantly and edits made offline sync later.
    db = f.initializeFirestore(app, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) });
  } catch {
    db = f.getFirestore(app);
  }
  fb = { auth, db, a, f };
  return fb;
}

// A Google redirect login is in flight (set just before leaving the page).
const REDIRECT_KEY = 'authRedirectPending';
export function redirectPending() {
  try { return !!localStorage.getItem(REDIRECT_KEY); } catch { return false; }
}
function setRedirectPending(on) {
  try { if (on) localStorage.setItem(REDIRECT_KEY, '1'); else localStorage.removeItem(REDIRECT_KEY); } catch { /* ignore */ }
}

// Resolves once with the signed-in user (or null).
export async function currentUser() {
  const c = await initCloud();
  if (!c) return null;
  // Only finish a redirect login when one was started: on some browsers this call is slow.
  if (redirectPending()) {
    setRedirectPending(false);
    await c.a.getRedirectResult(c.auth).catch(() => null);
  }
  await c.auth.authStateReady();
  return c.auth.currentUser;
}

const AUTH_ERRORS = {
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/missing-password': 'パスワードを入力してください',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/email-already-in-use': 'このメールアドレスは登録済みです。ログインしてください',
  'auth/invalid-credential': 'メールアドレスかパスワードが違います',
  'auth/wrong-password': 'メールアドレスかパスワードが違います',
  'auth/user-not-found': 'このメールアドレスは登録されていません',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてからお試しください',
  'auth/network-request-failed': '通信できませんでした。電波の良い場所でお試しください',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました',
  'auth/unauthorized-domain': 'このURLはログインが許可されていません（Firebaseの承認済みドメインを確認）',
  'auth/requires-recent-login': '安全のため、いったんログアウトして再ログインしてから操作してください',
  'auth/operation-not-allowed': 'このログイン方法は有効になっていません（Firebaseの設定を確認）',
};
export const authErrorMessage = (e) => AUTH_ERRORS[e?.code] || `ログインできませんでした（${e?.code || e?.message || '不明なエラー'}）`;

export async function signInGoogle() {
  const { auth, a } = await initCloud();
  const provider = new a.GoogleAuthProvider();
  try {
    return (await a.signInWithPopup(auth, provider)).user;
  } catch (e) {
    // Popups can be blocked (e.g. some home-screen apps): fall back to a full-page redirect.
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      setRedirectPending(true);
      await a.signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

export async function signInEmail(email, password) {
  const { auth, a } = await initCloud();
  return (await a.signInWithEmailAndPassword(auth, email, password)).user;
}

export async function signUpEmail(email, password) {
  const { auth, a } = await initCloud();
  return (await a.createUserWithEmailAndPassword(auth, email, password)).user;
}

export async function resetPassword(email) {
  const { auth, a } = await initCloud();
  await a.sendPasswordResetEmail(auth, email);
}

// Deletes all of the user's records, then the account itself.
export async function deleteAccount() {
  const { auth, a, f } = await initCloud();
  const user = auth.currentUser;
  if (!user) return;
  await cloudStore(user.uid).clearAll();
  await f.deleteDoc(refs(user.uid).user);
  await a.deleteUser(user);
}

export async function signOutCloud() {
  const c = await initCloud();
  if (c) await c.a.signOut(c.auth);
}

// ---------- Firestore data (users/{uid}/days, users/{uid}/photos, users/{uid} settings) ----------
function refs(uid) {
  const { db, f } = fb;
  return {
    user: f.doc(db, 'users', uid),
    days: f.collection(db, 'users', uid, 'days'),
    day: (date) => f.doc(db, 'users', uid, 'days', date),
    photos: f.collection(db, 'users', uid, 'photos'),
    photo: (id) => f.doc(db, 'users', uid, 'photos', id),
  };
}

export function cloudStore(uid) {
  const { f } = fb;
  const r = refs(uid);
  const list = async (q) => (await f.getDocs(q)).docs.map((d) => d.data());
  return {
    async getDay(date) { const s = await f.getDoc(r.day(date)); return s.exists() ? s.data() : null; },
    putDay: (day) => f.setDoc(r.day(day.date), day),
    getDaysInRange: (from, to) => list(f.query(r.days, f.where('date', '>=', from), f.where('date', '<=', to))),
    getAllDays: () => list(r.days),
    async putPhoto({ id, blob, date }) {
      await f.setDoc(r.photo(id), { id, date, data: await fitDataUrl(blob) });
    },
    async getPhoto(id) {
      const s = await f.getDoc(r.photo(id));
      if (!s.exists()) return null;
      const p = s.data();
      return { id: p.id, date: p.date, blob: await (await fetch(p.data)).blob() };
    },
    deletePhoto: (id) => f.deleteDoc(r.photo(id)),
    async getAllPhotos() {
      const docs = await list(r.photos);
      return Promise.all(docs.map(async (p) => ({ id: p.id, date: p.date, blob: await (await fetch(p.data)).blob() })));
    },
    async clearAll() {
      for (const col of [r.days, r.photos]) {
        const snap = await f.getDocs(col);
        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = f.writeBatch(fb.db);
          snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    },
    async hasAnyDay() {
      return !(await f.getDocs(f.query(r.days, f.limit(1)))).empty;
    },
    async getSettings() { const s = await f.getDoc(r.user); return s.exists() ? s.data() : null; },
    saveSettings: (data) => f.setDoc(r.user, data, { merge: true }),
  };
}

// Firestore documents are capped at 1 MiB, so shrink photos until the data URL fits comfortably.
const MAX_PHOTO_CHARS = 900_000;
async function fitDataUrl(blob) {
  let url = await blobToDataUrl(blob);
  if (url.length <= MAX_PHOTO_CHARS) return url;
  const img = await createImageBitmap(blob);
  for (const [size, q] of [[1024, 0.72], [800, 0.65], [640, 0.6], [480, 0.55]]) {
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= MAX_PHOTO_CHARS) break;
  }
  return url;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
