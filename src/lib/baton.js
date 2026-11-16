// ============================================================
// 記録のバトン: 進行中の試合を、いま誰の端末が記録しているか。
//
// クラウド同期は試合を丸ごと1つ送り、あとから送った方が勝つ。2台が同じ試合を
// 入力すると、少し古い状態の端末が相手の打席を黙って上書きする。
// 野球の記録は1打席ずつ順番に進むので、同時に2人が書ける必要は無い。
// 「書けるのは常に1台」にして、交代(バトンを渡す)だけを安全にする。
//
//   game.recorder = { id: 端末ID, name: 表示名, at: バトンを取った時刻 }
//
//  - 進行中の試合で recorder が自分の端末でなければ、その試合は変更できない
//    (reducer で止める。画面のどこから操作しても同じ)
//  - 「記録を引き継ぐ」で recorder を自分にする。at が新しい方が正
//  - 電波が切れている間に別の人が引き継いだ場合、戻ってきた端末の未送信の記録は
//    黙って捨てず、取っておいて持ち主に選ばせる
//
// recorder が無い試合(この仕組みより前の試合・デモ)は従来どおり誰でも書ける。
// ============================================================

const ID_KEY = 'bbscorer.deviceId';
const NAME_KEY = 'bbscorer.recorderName';

const store = () => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

let memoId = null;
// この端末(このブラウザ)の識別子。アカウントはチームで共有されることがあるので、
// ログインしている人ではなく端末で見分ける。バックアップには含めない
// (別の端末に復元したら別の端末として扱う)
export function deviceId() {
  if (memoId) return memoId;
  const s = store();
  let id = s?.getItem(ID_KEY) || '';
  if (!id) {
    id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try { s?.setItem(ID_KEY, id); } catch { /* 保存できなくても、この起動の間は同じIDを使う */ }
  }
  memoId = id;
  return id;
}

// ほかの端末に「いま○○さんが記録中」と出す名前
export function recorderName() {
  return store()?.getItem(NAME_KEY) || '';
}
export function saveRecorderName(name) {
  try { store()?.setItem(NAME_KEY, String(name || '').trim().slice(0, 20)); } catch { /* ignore */ }
}

export const newRecorder = (name = recorderName()) => ({ id: deviceId(), name: String(name || '').trim(), at: Date.now() });

// この端末からは変更できない試合か(進行中で、別の端末がバトンを持っている)
export function lockedFor(game, myId = deviceId()) {
  return !!game && game.status === 'ongoing' && !!game.recorder?.id && game.recorder.id !== myId;
}
export const holdsBaton = (game, myId = deviceId()) => !!game?.recorder?.id && game.recorder.id === myId;

const epoch = (g) => Number(g?.recorder?.at) || 0;

// 手元にあって、届いた側に無い記録の数(未送信のまま上書きされる記録)
export function unsentLogs(local, remote) {
  const have = new Set((remote?.playLogs || []).map((l) => l.id));
  return (local?.playLogs || []).filter((l) => !have.has(l.id));
}

// クラウドから届いた試合と手元の試合の、どちらを採るか。
//   take: 'remote' | 'local'
//   conflict: 手元の未送信の記録が上書きされる(持ち主に選ばせる必要がある)
export function chooseRemote(local, remote, myId = deviceId()) {
  if (!local) return { take: 'remote', conflict: false };
  const le = epoch(local);
  const re = epoch(remote);
  if (re > le) {
    // 自分がバトンを持っていた間に、別の端末が引き継いだ。相手が正。
    // 自分が電波の無い間に付けた記録が相手に無ければ、消える前に取っておく
    const lost = holdsBaton(local, myId) && remote.recorder?.id !== myId ? unsentLogs(local, remote) : [];
    return { take: 'remote', conflict: lost.length > 0, lost: lost.length };
  }
  if (re < le) return { take: 'local', conflict: false }; // 自分のほうが後から引き継いだ
  // 同じ持ち主の間は、これまでどおり新しい方
  return { take: (remote.updatedAt || 0) >= (local.updatedAt || 0) ? 'remote' : 'local', conflict: false };
}

// ---- 攻守交代で自動的に渡す(任意) ----
// game.batonPlan = { on, offense: {id,name}, defense: {id,name} }。
// 自チームが攻撃のときの記録係と、守備のときの記録係を決めておく。
// 半回が変わった時点で、記録している端末がバトンを渡す(渡した端末は見るだけに変わる)。
// 初期は無効で、使うかどうかは記録している人が選ぶ。
export function knownRecorders(game) {
  const out = new Map();
  for (const r of game?.recorders || []) if (r?.id) out.set(r.id, r.name || '');
  if (game?.recorder?.id) out.set(game.recorder.id, game.recorder.name || out.get(game.recorder.id) || '');
  return [...out.entries()].map(([id, name]) => ({ id, name }));
}
export function noteRecorder(game, rec) {
  if (!rec?.id) return;
  const list = (game.recorders || []).filter((r) => r.id !== rec.id);
  game.recorders = [...list, { id: rec.id, name: rec.name || '' }];
}
// この半回の記録係に渡すべき相手(渡す必要が無ければ null)
export function nextRecorderFor(game, myTeamBatting, myId = deviceId()) {
  const plan = game?.batonPlan;
  if (!plan?.on || game.status !== 'ongoing' || !holdsBaton(game, myId)) return null;
  const target = myTeamBatting ? plan.offense : plan.defense;
  return target?.id && target.id !== myId ? target : null;
}
