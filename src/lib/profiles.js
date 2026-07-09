// ============================================================
// 複数チーム(所属チーム切り替え)対応
// 端末内に複数チームのデータ(選手・試合・設定)を独立して保存し、切り替えて使う。
// 草野球チームと部活チームなど、複数チームに所属している場合を想定。
// チームごとのデータは専用のlocalStorageキー(profileStorageKey)に保存され、
// クラウド共有設定(teamCode等)もチームごとに独立するため、別々のクラウドチームへ接続できる。
// ============================================================
import { uid } from './model.js';

export const REGISTRY_KEY = 'bbscorer.profiles.v1';
export const LEGACY_DATA_KEY = 'bbscorer.v1'; // 複数チーム対応前(単一チーム時代)のデータキー

export function profileStorageKey(id) {
  return `bbscorer.v1.profile.${id}`;
}

function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    return raw ? JSON.parse(raw) : null;
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
      edition = parsed?.settings?.edition || edition;
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

export function addProfile(name, edition) {
  const reg = loadRegistry() || { profiles: [], activeId: null };
  const p = { id: uid(), name: (name || '').trim() || '新しいチーム', edition: edition || '草野球', createdAt: Date.now() };
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
