// ============================================================
// バックアップの書き出し
//
// 設定画面の中に閉じていたが、画面が落ちたときの逃げ道としても要る。
// 描画が壊れて設定画面まで辿り着けない場面こそ、いちばん書き出したい。
// だから設定画面から切り出して、どこからでも呼べるようにしてある。
// ============================================================

// 保存する中身。リブランド後も旧バージョンのアプリで復元できるよう、
// 識別子は旧名のまま維持する
export function backupPayload(state) {
  return {
    app: 'aibss-baseball-scorer',
    version: 1,
    exportedAt: new Date().toISOString(),
    players: state?.players || [],
    members: state?.members || [],
    games: state?.games || {},
    currentGameId: state?.currentGameId ?? null,
    settings: state?.settings || {},
    demoLoaded: !!state?.demoLoaded,
  };
}

export const backupFileName = (now = new Date()) =>
  // 一部ブラウザは非ASCIIのdownload属性を無視するのでASCIIファイル名にする
  `aibss-backup_${now.toISOString().slice(0, 10)}.json`;

// 書き出して、成否を返す。呼び出し側が「保存した日時」を記録できるように
// 例外を投げずに false を返す(落ちている最中に呼ばれることがある)
export function downloadBackup(state) {
  try {
    const blob = new Blob([JSON.stringify(backupPayload(state))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
