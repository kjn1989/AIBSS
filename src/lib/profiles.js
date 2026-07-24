// ============================================================
// 複数チーム(所属チーム切り替え)対応
// 端末内に複数チームのデータ(選手・試合・設定)を独立して保存し、切り替えて使う。
// 草野球チームと部活チームなど、複数チームに所属している場合を想定。
// チームごとのデータは専用のlocalStorageキー(profileStorageKey)に保存され、
// クラウド共有設定(teamCode等)もチームごとに独立するため、別々のクラウドチームへ接続できる。
// ============================================================
import { uid, normalizeEdition } from './model.js';
import { idbAllKeys, idbLoad } from './durableStore.js';

export const REGISTRY_KEY = 'bbscorer.profiles.v1';
export const LEGACY_DATA_KEY = 'bbscorer.v1'; // 複数チーム対応前(単一チーム時代)のデータキー

export function profileStorageKey(id) {
  return `bbscorer.v1.profile.${id}`;
}

function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    const reg = raw ? JSON.parse(raw) : null;
    // 旧エディション表記(ブカツ(中-大)等)を現行表記へ正規化
    if (reg?.profiles) for (const p of reg.profiles) p.edition = normalizeEdition(p.edition) || p.edition;
    return reg;
  } catch {
    return null;
  }
}

function saveRegistry(reg) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch {
    /* 容量超過等は無視 */
  }
}

// 起動時に一度だけ呼ぶ(React描画より前・同期処理)。
// レジストリが無ければ、旧・単一チーム時代のデータ(あれば)を最初のチームとして移行する。
export function ensureRegistry() {
  let reg = loadRegistry();
  if (reg && Array.isArray(reg.profiles) && reg.profiles.length && reg.activeId) return reg;

  const id = uid();
  let name = 'マイチーム';
  let edition = '草野球';
  const legacyRaw = localStorage.getItem(LEGACY_DATA_KEY);
  if (legacyRaw) {
    try {
      const parsed = JSON.parse(legacyRaw);
      name = parsed?.settings?.teamName || name;
      edition = normalizeEdition(parsed?.settings?.edition) || edition;
    } catch {
      /* JSON破損時は既定値のまま */
    }
    try {
      localStorage.setItem(profileStorageKey(id), legacyRaw); // 旧データをそのまま最初のチームへ複製(旧キーも残す)
    } catch {
      /* noop */
    }
  }
  reg = { profiles: [{ id, name, edition, createdAt: Date.now() }], activeId: id };
  saveRegistry(reg);
  return reg;
}

export function listProfiles() {
  return loadRegistry()?.profiles || [];
}

export function getActiveProfileId() {
  return loadRegistry()?.activeId || null;
}

// 指定した公式クラウドのチームIDに紐付いた既存プロフィールを返す(無ければnull)。
// クラウドのチームごとにローカルのプロフィールを1対1で対応させ、選手・試合データの
// 混在を防ぐために使う(同じチームに二重接続しないよう既存プロフィールを再利用する)。
export function findProfileByOfficialTeamId(tid) {
  if (!tid) return null;
  return listProfiles().find((p) => p.officialTeamId === tid) || null;
}

export function addProfile(name, edition, extra = {}) {
  const reg = loadRegistry() || { profiles: [], activeId: null };
  const p = {
    id: uid(),
    name: (name || '').trim() || '新しいチーム',
    edition: edition || '草野球',
    createdAt: Date.now(),
    ...extra, // 例: { officialTeamId } 招待参加で作るプロフィールにクラウドチームを紐付ける
  };
  reg.profiles.push(p);
  saveRegistry(reg);
  return p;
}

// チーム名/エディション変更時に、切り替えリストの表示をレジストリ側にも反映する
export function updateProfileMeta(id, patch) {
  const reg = loadRegistry();
  if (!reg) return;
  const p = reg.profiles.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  saveRegistry(reg);
}

// 戻り値: 削除後にアクティブにすべきチームid(削除したのがアクティブだった場合)
export function deleteProfile(id) {
  const reg = loadRegistry();
  if (!reg) return null;
  reg.profiles = reg.profiles.filter((p) => p.id !== id);
  if (reg.activeId === id) reg.activeId = reg.profiles[0]?.id || null;
  saveRegistry(reg);
  try {
    localStorage.removeItem(profileStorageKey(id));
  } catch {
    /* noop */
  }
  return reg.activeId;
}

export function switchActiveProfile(id) {
  const reg = loadRegistry();
  if (!reg) return;
  reg.activeId = id;
  saveRegistry(reg);
}

// 削除済みチームの復元候補を探す。deleteProfileはlocalStorageのみ削除しIndexedDBの
// ミラーは残るため、レジストリ外(=削除済み)のプロフィールデータがIDBに残っていれば拾える。
// 戻り値: [{ id, name, edition, games, players }]
export async function listOrphanedProfiles() {
  const reg = loadRegistry();
  const known = new Set((reg?.profiles || []).map((p) => p.id));
  const prefix = 'bbscorer.v1.profile.';
  const keys = await idbAllKeys();
  const out = [];
  for (const k of keys) {
    if (typeof k !== 'string' || !k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    if (known.has(id)) continue; // レジストリに在る=現役なので対象外
    if (localStorage.getItem(k)) continue; // localStorageに在る=削除されていない
    const snap = await idbLoad(k);
    if (!snap) continue;
    try {
      const b = JSON.parse(snap);
      out.push({
        id,
        name: b.settings?.teamName || 'チーム',
        edition: normalizeEdition(b.settings?.edition) || '草野球',
        games: Object.keys(b.games || {}).length,
        players: (b.players || []).length,
      });
    } catch {
      /* 壊れたスナップショットは無視 */
    }
  }
  return out;
}

// 削除済みチームをIDBミラーから復元(localStorage復元+レジストリ再登録)
export async function restoreProfile(id) {
  const key = profileStorageKey(id);
  const snap = await idbLoad(key);
  if (!snap) throw new Error('復元データが見つかりません');
  localStorage.setItem(key, snap);
  const reg = loadRegistry() || { profiles: [], activeId: null };
  if (!reg.profiles.some((p) => p.id === id)) {
    let name = 'チーム', edition = '草野球';
    try { const b = JSON.parse(snap); name = b.settings?.teamName || name; edition = normalizeEdition(b.settings?.edition) || edition; } catch { /* noop */ }
    reg.profiles.push({ id, name, edition });
    saveRegistry(reg);
  }
  return id;
}
