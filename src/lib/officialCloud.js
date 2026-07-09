// ============================================================
// AI-BSS公式クラウド(運営ホスト型Firebase)
//  - 認証: Google / メールリンク(パスワードレス)
//  - チーム管理: teams/{id} + members(権限: owner/scorer/viewer) + invites(招待トークン)
//  - 同期: teams/{id}/games|players|crew を購読+push(LWW判定は CloudSync 側)
// アクセス制御はサーバ側の firestore.rules が強制する(リポジトリ同梱)。
// 旧方式(自前Firebase+チームコード / lib/cloud.js)とは独立して併存する。
// ============================================================
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail,
  isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut,
  connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  connectFirestoreEmulator, collection, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot,
} from 'firebase/firestore';
import { getOfficialConfig, officialAvailable } from './officialConfig.js';
import { uid as newId } from './model.js';

export { officialAvailable };

let app = null;
let auth = null;
let db = null;

function ensureInit() {
  if (app) return true;
  const cfg = getOfficialConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
  app = initializeApp(cfg, 'aibss-official');
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
  if (cfg.emulator) {
    // ローカル検証(Firebaseエミュレータ)用。本番configにemulatorフラグは入れないこと。
    const host = cfg.emulatorHost || '127.0.0.1';
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    // e2e用のテストログイン(エミュレータ時のみ露出)
    window.__aibssTestSignIn = async (email, password = 'aibss-test-pass') => {
      try {
        await createUserWithEmailAndPassword(auth, email, password);
      } catch {
        await signInWithEmailAndPassword(auth, email, password);
      }
    };
  }
  return true;
}

// ---------------- 認証 ----------------
export function watchAuth(cb) {
  if (!ensureInit()) return () => {};
  return onAuthStateChanged(auth, cb);
}

export async function loginWithGoogle() {
  if (!ensureInit()) throw new Error('公式クラウドは未設定です');
  await signInWithPopup(auth, new GoogleAuthProvider());
}

const PENDING_EMAIL_KEY = 'bbscorer.pendingLoginEmail';

export async function sendLoginLink(email) {
  if (!ensureInit()) throw new Error('公式クラウドは未設定です');
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  });
  localStorage.setItem(PENDING_EMAIL_KEY, email);
}

// メールリンクからの遷移でログインを完了する(App起動時に呼ぶ)。該当しなければ何もしない。
export async function completeLoginLink() {
  if (!ensureInit()) return false;
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;
  const email = localStorage.getItem(PENDING_EMAIL_KEY) ||
    window.prompt('確認のため、ログイン用リンクを受け取ったメールアドレスを入力してください');
  if (!email) return false;
  await signInWithEmailLink(auth, email, window.location.href);
  localStorage.removeItem(PENDING_EMAIL_KEY);
  const clean = new URL(window.location.href);
  clean.search = '';
  window.history.replaceState({}, '', clean.toString());
  return true;
}

export async function logout() {
  if (ensureInit()) await signOut(auth);
}

// セッション復元(非同期)を待ってから現在のユーザーを返す。未ログインならnull
export function currentUserAsync() {
  if (!ensureInit()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

// ---------------- チーム管理 ----------------
function memberDoc(u, role, inviteToken) {
  return {
    uid: u.uid,
    role, // 'owner' | 'scorer' | 'viewer'
    name: u.displayName || u.email || '名無し',
    email: u.email || '',
    joinedAt: Date.now(),
    ...(inviteToken ? { invite: inviteToken } : {}),
  };
}

export async function createCloudTeam({ name, edition }) {
  if (!ensureInit()) throw new Error('公式クラウドは未設定です');
  const u = auth.currentUser;
  if (!u) throw new Error('ログインしてください');
  const teamId = newId();
  await setDoc(doc(db, 'teams', teamId), {
    id: teamId, name, edition, ownerUid: u.uid, createdAt: Date.now(), plan: 'free',
  });
  await setDoc(doc(db, 'teams', teamId, 'members', u.uid), memberDoc(u, 'owner', null));
  await setDoc(doc(db, 'users', u.uid, 'memberships', teamId), {
    teamId, teamName: name, role: 'owner', joinedAt: Date.now(),
  });
  return teamId;
}

// 招待トークンを発行(URLに埋め込む。トークンを知っていること自体が参加権)
export async function createInvite(teamId, role = 'scorer') {
  if (!ensureInit()) throw new Error('公式クラウドは未設定です');
  const token = newId() + newId();
  await setDoc(doc(db, 'invites', token), {
    teamId, role,
    createdBy: auth.currentUser.uid,
    createdAt: Date.now(),
    expiresAt: Date.now() + 14 * 86400000, // 14日で失効
  });
  return token;
}

export function inviteUrl(token) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('ct', token);
  return url.toString();
}

export async function joinByInvite(token) {
  if (!ensureInit()) throw new Error('公式クラウドは未設定です');
  const u = auth.currentUser;
  if (!u) throw new Error('ログインしてください');
  const inv = await getDoc(doc(db, 'invites', token));
  if (!inv.exists()) throw new Error('招待が見つかりません(削除済み・URL誤りの可能性)');
  const { teamId, role, expiresAt } = inv.data();
  if (expiresAt < Date.now()) throw new Error('招待の有効期限が切れています');
  await setDoc(doc(db, 'teams', teamId, 'members', u.uid), memberDoc(u, role, token));
  const team = await getDoc(doc(db, 'teams', teamId));
  const meta = { name: team.data()?.name || 'チーム', edition: team.data()?.edition || '草野球' };
  await setDoc(doc(db, 'users', u.uid, 'memberships', teamId), {
    teamId, teamName: meta.name, role, joinedAt: Date.now(),
  });
  return { teamId, role, ...meta };
}

export async function listMyTeams() {
  if (!ensureInit()) return [];
  const u = auth.currentUser;
  if (!u) return [];
  const snap = await getDocs(collection(db, 'users', u.uid, 'memberships'));
  return snap.docs.map((d) => d.data());
}

export async function listMembers(teamId) {
  if (!ensureInit()) return [];
  const snap = await getDocs(collection(db, 'teams', teamId, 'members'));
  return snap.docs.map((d) => d.data());
}

export async function setMemberRole(teamId, uid, role) {
  await setDoc(doc(db, 'teams', teamId, 'members', uid), { role }, { merge: true });
}

export async function removeMember(teamId, uid) {
  await deleteDoc(doc(db, 'teams', teamId, 'members', uid));
}

// ---------------- 同期接続(lib/cloud.jsのconnectCloudと同じ呼び出し形) ----------------
// Firestoreはundefinedを許容しないため除去(JSON往復でスキーマ同一性も担保)
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function connectOfficial({ teamId, onGames, onPlayers, onCrew, onStatus }) {
  if (!ensureInit() || !teamId) {
    onStatus?.('error');
    return null;
  }
  onStatus?.('connecting');
  const unsubs = [];
  const sub = (col, cb) => {
    unsubs.push(onSnapshot(
      collection(db, 'teams', teamId, col),
      (snap) => {
        onStatus?.('on');
        cb?.(snap.docs.map((d) => d.data()));
      },
      () => onStatus?.('error')
    ));
  };
  sub('games', onGames);
  sub('players', onPlayers);
  sub('crew', onCrew);
  return {
    teamId,
    async pushGame(game) { await setDoc(doc(db, 'teams', teamId, 'games', game.id), sanitize(game)); },
    async pushPlayer(player) { await setDoc(doc(db, 'teams', teamId, 'players', player.id), sanitize(player)); },
    async pushCrew(member) { await setDoc(doc(db, 'teams', teamId, 'crew', member.id), sanitize(member)); },
    teardown() { unsubs.forEach((u) => u()); },
  };
}
