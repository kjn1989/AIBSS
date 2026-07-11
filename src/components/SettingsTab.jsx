import React, { useState } from 'react';
import { useStore, usePlayerName, persist } from '../state/store.jsx';
import { parseFirebaseConfig } from '../lib/cloud.js';
import { encodeWatchLink, encodeInviteLink } from './WatchView.jsx';
import QRCode from './QRCode.jsx';
import { battingCSV, pitchingCSV, playLogCSV, atBatCSV, downloadCSV, shareCSV } from '../lib/csv.js';
import { EDITIONS } from '../lib/model.js';
import { listProfiles, getActiveProfileId, addProfile, switchActiveProfile, deleteProfile } from '../lib/profiles.js';
import OfficialCloudCard from './OfficialCloudCard.jsx';

export default function SettingsTab() {
  const { state, dispatch } = useStore();
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');

  const addPlayer = () => {
    if (!newName.trim()) return;
    dispatch({ type: 'ADD_PLAYER', name: newName.trim(), number: newNumber.trim() });
    setNewName('');
    setNewNumber('');
  };

  return (
    <div>
      <TeamSwitcherCard />

      <div className="card">
        <h2>チーム設定</h2>
        <label className="small dim">チーム名</label>
        <input
          value={state.settings.teamName}
          onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { teamName: e.target.value } })}
          placeholder="マイチーム"
        />
        <label className="small dim mt8" style={{ display: 'block' }}>エディション</label>
        <div className="toggle-row">
          {EDITIONS.map((ed) => (
            <button
              key={ed}
              className={state.settings.edition === ed ? 'active' : ''}
              onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { edition: ed } })}
            >
              {ed}
            </button>
          ))}
        </div>
        <p className="small dim mt8">
          「草野球」では📇AI選手名鑑・🤖AIスタメン提案が使えます(パワプロ風の際どい寸評を含むため)。
          「ブカツ(中高大)」「少年野球」ではこの2機能は表示されません。
        </p>
      </div>

      <div className="card">
        <h2>選手登録 ({state.players.length}人)</h2>
        <div className="flex">
          <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="選手名" />
          <input style={{ width: 70 }} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="背番号" inputMode="numeric" />
          <button className="primary" onClick={addPlayer}>追加</button>
        </div>
        <div className="mt12">
          {state.players.map((p) => (
            <div className="row" key={p.id}>
              <span className="pill">{p.number || '-'}</span>
              <span className="grow">{p.name}</span>
              <button className="small danger ghost" onClick={() => dispatch({ type: 'DELETE_PLAYER', id: p.id })}>削除</button>
            </div>
          ))}
          {state.players.length === 0 && <div className="dim small mt8">選手が未登録です。デモデータでも試せます。</div>}
        </div>
      </div>

      <div className="card">
        <h2>デモデータ</h2>
        <p className="small dim" style={{ marginBottom: 10 }}>
          ダミーの選手12人と3試合分の記録を投入して、ランキング表示を確認できます。
        </p>
        {state.demoLoaded ? (
          <button className="danger" onClick={() => dispatch({ type: 'CLEAR_DEMO' })}>デモデータを削除</button>
        ) : (
          <button className="primary" onClick={() => dispatch({ type: 'LOAD_DEMO' })}>デモデータを投入</button>
        )}
      </div>

      <div className="card">
        <h2>音声入力の設定</h2>
        <p className="small dim" style={{ marginBottom: 10 }}>
          音声解釈はオフラインのルールエンジンで動作します。曖昧な発話の解釈精度を上げたい場合のみ、
          外部LLM API(Anthropic)を任意で連携できます(信頼度が低いときだけ呼び出し)。
        </p>
        <div className="flex">
          <span className="grow small">LLM解釈を有効にする</span>
          <button
            className={`small ${state.settings.useLLM ? 'primary' : ''}`}
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { useLLM: !state.settings.useLLM } })}
          >
            {state.settings.useLLM ? 'ON' : 'OFF'}
          </button>
        </div>
        {state.settings.useLLM && (
          <div className="mt8">
            <label className="small dim">Anthropic APIキー (sk-ant-...)</label>
            <input
              type="password"
              value={state.settings.anthropicApiKey}
              onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { anthropicApiKey: e.target.value } })}
              placeholder="未入力の場合はオフラインエンジンのみ"
            />
            <p className="small dim mt8">⚠️ キーはこの端末のブラウザ内にのみ保存されます。</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>AI機能(Gemini)の設定</h2>
        <p className="small dim" style={{ marginBottom: 10 }}>
          {state.settings.edition === '草野球'
            ? '選手個人ページの「📇 名鑑」でのスカウト寸評生成、🤖AIスタメン提案、CSV取り込み時のAI補完等に使用します(任意)。未設定の場合はダミー文言が表示されます。'
            : 'CSV取り込み時のAI補完等に使用します(任意)。📇AI選手名鑑・🤖AIスタメン提案は「草野球」エディションのみの機能です。'}
        </p>
        <label className="small dim">Gemini APIキー</label>
        <input
          type="password"
          value={state.settings.geminiApiKey}
          onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { geminiApiKey: e.target.value } })}
          placeholder="未入力の場合はダミー文言のみ"
        />
        <p className="small dim mt8">⚠️ キーはこの端末のブラウザ内にのみ保存されます。</p>
      </div>

      <OfficialCloudCard />
      <CloudCard />
      <ExportCard />
      <BackupCard />
      <DangerZoneCard />

      <div className="card">
        <h2>データ管理</h2>
        <p className="small dim">
          データはこの端末のブラウザ内(localStorage)に自動保存され、オフラインでも完全動作します。
          クラウド共有を有効にすると、同じチームコードを設定した全員の端末とリアルタイム同期します。
        </p>
      </div>
    </div>
  );
}

// ---- 所属チームの追加・切り替え(草野球チームと部活チーム等、複数チームに所属する場合) ----
function TeamSwitcherCard() {
  const { state } = useStore();
  const [profiles, setProfiles] = useState(() => listProfiles());
  const activeId = getActiveProfileId();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEdition, setNewEdition] = useState(EDITIONS[0]);

  const switchTo = (id) => {
    if (id === activeId) return;
    if (!window.confirm('チームを切り替えます。画面がリロードされます。')) return;
    persist(state); // 切り替え前に現在のチームの最新データを確実に保存
    switchActiveProfile(id);
    window.location.reload();
  };

  const createTeam = () => {
    const name = newName.trim();
    if (!name) return;
    persist(state);
    const p = addProfile(name, newEdition);
    switchActiveProfile(p.id);
    window.location.reload();
  };

  const remove = (id, name) => {
    if (profiles.length <= 1) { window.alert('最後の1チームは削除できません。'); return; }
    if (!window.confirm(`「${name}」を削除しますか？\nこのチームの選手・試合データも全て削除されます。この操作は取り消せません。`)) return;
    deleteProfile(id);
    setProfiles(listProfiles());
  };

  return (
    <div className="card">
      <h2>所属チーム</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        複数のチームに所属している場合、ここでチームを追加・切り替えできます(例: 草野球チームと部活チーム)。
        チームごとに選手・試合・設定・クラウド共有が独立します。
      </p>
      {profiles.map((p) => (
        <div className="row" key={p.id}>
          <div className="grow" onClick={() => switchTo(p.id)} role="button">
            <b style={{ color: p.id === activeId ? 'var(--accent)' : 'var(--text)' }}>
              {p.id === activeId ? '✅ ' : ''}{p.name}
            </b>
            <span className="pill" style={{ marginLeft: 6 }}>{p.edition}</span>
          </div>
          {p.id !== activeId && (
            <button className="small ghost" style={{ color: 'var(--red)' }} onClick={() => remove(p.id, p.name)}>削除</button>
          )}
        </div>
      ))}
      {adding ? (
        <div className="mt12">
          <label className="small dim">チーム名</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: ○○中学校野球部" />
          <label className="small dim mt8" style={{ display: 'block' }}>エディション</label>
          <div className="toggle-row">
            {EDITIONS.map((ed) => (
              <button key={ed} className={newEdition === ed ? 'active' : ''} onClick={() => setNewEdition(ed)}>{ed}</button>
            ))}
          </div>
          <div className="grid2 mt8">
            <button className="ghost" onClick={() => setAdding(false)}>キャンセル</button>
            <button className="primary" disabled={!newName.trim()} onClick={createTeam}>追加して切り替え</button>
          </div>
        </div>
      ) : (
        <button className="mt12" style={{ width: '100%' }} onClick={() => setAdding(true)}>＋ チームを追加</button>
      )}
    </div>
  );
}

// ---- データのリセット(試合の全削除 / 完全初期化) ----
function DangerZoneCard() {
  const { state, dispatch } = useStore();
  const gameCount = Object.keys(state.games).length;
  const playerCount = state.players.length;

  const deleteAllGames = () => {
    if (gameCount === 0) { window.alert('削除する試合がありません。'); return; }
    if (!window.confirm(
      `試合結果を全て削除しますか？(${gameCount}件)\n\nチーム名と選手(${playerCount}人)はそのまま残ります。\nこの操作は取り消せません。`
    )) return;
    // 消える前に自動バックアップを促す最終確認
    if (!window.confirm('本当に削除します。よろしいですか？(念のため事前のバックアップ保存を推奨)')) return;
    dispatch({ type: 'DELETE_ALL_GAMES' });
    window.alert('試合結果を全て削除しました。選手とチーム名はそのままです。');
  };

  const resetAll = () => {
    if (!window.confirm(
      `完全初期化しますか？\n\n全ての試合(${gameCount}件)と選手(${playerCount}人)を削除します。\nチーム名・クラウド設定は残ります。\nこの操作は取り消せません。`
    )) return;
    if (!window.confirm('本当に初期化します。よろしいですか？(念のため事前のバックアップ保存を推奨)')) return;
    dispatch({ type: 'RESET_ALL' });
    window.alert('初期化しました。');
  };

  return (
    <div className="card danger-zone">
      <h2>データのリセット</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        テスト入力を消して本番用にやり直すときに使います。
        <b>削除は取り消せません。</b>不安な場合は先に上の「バックアップを保存」で保存しておくと、後から復元できます。
      </p>
      <button className="ghost danger" style={{ width: '100%', marginBottom: 8 }} onClick={deleteAllGames}>
        🗑 試合結果だけ全て削除(選手・チーム名は残す)
      </button>
      <button className="danger" style={{ width: '100%' }} onClick={resetAll}>
        ⚠️ 完全初期化(試合も選手も削除)
      </button>
    </div>
  );
}

// ---- バックアップ/復元(全データのJSONエクスポート・インポート) ----
function BackupCard() {
  const { state, dispatch } = useStore();
  const stamp = new Date().toISOString().slice(0, 10);

  // データ消失対策のリマインド: 最終バックアップからの経過を表示し、古ければ警告する
  const last = state.settings.lastBackupAt;
  const nGames = Object.keys(state.games || {}).length;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const lastLabel = last ? (daysSince === 0 ? '今日' : `${daysSince}日前`) : 'まだ保存していません';
  const stale = nGames > 0 && (!last || Date.now() - last > 7 * 86400000);
  // ホーム画面未追加のPWAはiOSでストレージ自動削除の対象になりやすい
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const exportBackup = () => {
    const payload = {
      // リブランド後も旧バージョンのアプリで復元できるよう、識別子は旧名のまま維持する
      app: 'aibss-baseball-scorer',
      version: 1,
      exportedAt: new Date().toISOString(),
      players: state.players,
      members: state.members || [],
      games: state.games,
      currentGameId: state.currentGameId,
      settings: state.settings,
      demoLoaded: state.demoLoaded,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 一部ブラウザは非ASCIIのdownload属性を無視するためASCIIファイル名にする
    a.download = `aibss-backup_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({ type: 'UPDATE_SETTINGS', patch: { lastBackupAt: Date.now() } });
  };

  const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== 'aibss-baseball-scorer' || typeof data.games !== 'object') {
          window.alert('このファイルはAI-BASEのバックアップではないようです。');
          return;
        }
        const nGames = Object.keys(data.games || {}).length;
        const nPlayers = (data.players || []).length;
        if (!window.confirm(
          `バックアップを復元しますか？\n(選手${nPlayers}人・試合${nGames}件 / ${data.exportedAt?.slice(0, 10) || '日付不明'})\n\n⚠️ この端末の現在のデータはすべて上書きされます。`
        )) return;
        dispatch({ type: 'IMPORT_BACKUP', payload: data });
        window.alert('復元しました。');
      } catch {
        window.alert('ファイルを読み込めませんでした(JSONの解析エラー)。');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="card">
      <h2>バックアップ / 復元</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        全データ(選手・全試合・設定)を1つのファイルに書き出します。
        機種変更やブラウザのキャッシュ削除に備えて、シーズン中は定期的な保存をおすすめします。
      </p>
      <div className="small" style={{ marginBottom: 10 }}>最終バックアップ: <b>{lastLabel}</b></div>
      {stale && (
        <div className="warn-box" style={{ marginBottom: 10 }}>
          ⚠️ しばらくバックアップしていません。端末の故障やブラウザのデータ削除に備えて、今保存しておくことをおすすめします。
        </div>
      )}
      <div className="grid2">
        <button className="primary" onClick={exportBackup}>⬇ バックアップを保存</button>
        <label className="file-btn">
          ⬆ 復元(ファイル選択)
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {!isStandalone && (
        <p className="small dim" style={{ marginTop: 10 }}>
          💡 ホーム画面に追加すると、iPhoneのデータ自動削除の対象外になり、記録が消えにくくなります(共有ボタン →「ホーム画面に追加」)。
        </p>
      )}
    </div>
  );
}

// ---- クラウド共有(Firebase Firestore) ----
function CloudCard() {
  const { state, dispatch } = useStore();
  const s = state.settings;
  const cfgValid = !!parseFirebaseConfig(s.firebaseConfigText);
  const statusLabel = {
    off: 'オフ(ローカルのみ)',
    connecting: '接続中…',
    on: '✅ 同期中',
    error: '⚠️ エラー(config/ルール/ネットワークを確認)',
  }[state.cloudStatus];

  const [qr, setQr] = useState(null); // 'watch' | 'invite' | null

  const copyLink = async (link, msg) => {
    try {
      await navigator.clipboard.writeText(link);
      window.alert(msg);
    } catch {
      window.prompt('コピーして共有してください:', link);
    }
  };
  const watchLink = () => encodeWatchLink({ configText: s.firebaseConfigText, teamCode: s.teamCode });
  const inviteLink = () => encodeInviteLink({ configText: s.firebaseConfigText, teamCode: s.teamCode });

  return (
    <div className="card">
      <h2>クラウド共有 (上級者向け・自前Firebase)</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        自分のFirebaseプロジェクトで同期したい上級者向けの旧方式です。
        通常は上の「AI-BASE公式クラウド」をお使いください(公式クラウド接続中はこちらは使われません)。
        Firebaseコンソールで作ったプロジェクトの構成(firebaseConfig)を貼り付け、
        チームで共通の「チームコード」を決めて全員が同じ値を入力すると、試合データがリアルタイムで共有されます。
      </p>
      <label className="small dim">firebaseConfig (JSONまたはコンソールのコピペ)</label>
      <textarea
        rows={5}
        value={s.firebaseConfigText}
        onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { firebaseConfigText: e.target.value } })}
        placeholder={'{\n  "apiKey": "...",\n  "projectId": "...",\n  ...\n}'}
      />
      {s.firebaseConfigText && !cfgValid && <div className="warn-box">⚠️ configを解釈できません(apiKey/projectId必須)。</div>}
      <label className="small dim mt8" style={{ display: 'block' }}>チームコード(合言葉)</label>
      <input
        value={s.teamCode}
        onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { teamCode: e.target.value.trim() } })}
        placeholder="例: eagles-2026"
      />
      <div className="flex mt12">
        <span className="grow small">状態: {statusLabel}</span>
        <button
          className={s.cloudEnabled ? 'danger' : 'primary'}
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { cloudEnabled: !s.cloudEnabled } })}
          disabled={!s.cloudEnabled && (!cfgValid || !s.teamCode)}
        >
          {s.cloudEnabled ? '共有を停止' : '共有を開始'}
        </button>
      </div>
      {s.cloudEnabled && cfgValid && s.teamCode && (
        <>
          <div className="section-title">チームメンバーを招待</div>
          <p className="small dim" style={{ marginBottom: 8 }}>
            リンク/QRを開くだけで同期設定が完了し、記録に参加できます(書き込み可)。
          </p>
          <div className="grid2">
            <button onClick={() => copyLink(inviteLink(), '招待リンクをコピーしました。チームメンバーに送ってください。')}>
              🔗 招待リンク
            </button>
            <button onClick={() => setQr(qr === 'invite' ? null : 'invite')}>
              {qr === 'invite' ? 'QRを閉じる' : '📱 招待QR'}
            </button>
          </div>
          {qr === 'invite' && (
            <div className="qr-box"><QRCode text={inviteLink()} /><span className="small dim">スマホのカメラで読み取ってもらってください</span></div>
          )}

          <div className="section-title">観戦(閲覧専用)</div>
          <p className="small dim" style={{ marginBottom: 8 }}>
            保護者・OB向け。書き込みできず、試合速報をリアルタイムで見るだけになります。
          </p>
          <div className="grid2">
            <button onClick={() => copyLink(watchLink(), '観戦リンクをコピーしました。')}>
              🔗 観戦リンク
            </button>
            <button onClick={() => setQr(qr === 'watch' ? null : 'watch')}>
              {qr === 'watch' ? 'QRを閉じる' : '📱 観戦QR'}
            </button>
          </div>
          {qr === 'watch' && (
            <div className="qr-box"><QRCode text={watchLink()} /><span className="small dim">スマホのカメラで読み取ってもらってください</span></div>
          )}
        </>
      )}
    </div>
  );
}

// ---- CSV出力・共有 ----
function ExportCard() {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState('all'); // all | current
  const games =
    scope === 'current' && state.currentGameId
      ? [state.games[state.currentGameId]].filter(Boolean)
      : Object.values(state.games);
  const stamp = new Date().toISOString().slice(0, 10);

  const items = [
    { label: '打者成績', make: () => battingCSV(games, nameOf), file: `打者成績_${stamp}.csv` },
    { label: '投手成績', make: () => pitchingCSV(games, nameOf), file: `投手成績_${stamp}.csv` },
    { label: 'プレイログ', make: () => playLogCSV(games, nameOf, state.settings.teamName), file: `プレイログ_${stamp}.csv` },
    { label: '打席詳細', make: () => atBatCSV(games, nameOf), file: `打席詳細_${stamp}.csv` },
  ];

  return (
    <div className="card">
      <h2>CSV出力・共有</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        ヘッダー付き・1行1レコードのCSV(UTF-8 BOM付き)。ダウンロードして
        Googleスプレッドシートにインポート/貼り付けできるほか、共有ボタンでLINE等に直接送れます。
      </p>
      <div className="toggle-row">
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全試合</button>
        <button className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')} disabled={!state.currentGameId}>
          選択中の試合
        </button>
      </div>
      {items.map((it) => (
        <div className="row" key={it.label}>
          <span className="grow">{it.label}</span>
          <button className="small" onClick={() => downloadCSV(it.file, it.make())}>⬇ DL</button>
          <button className="small" onClick={() => shareCSV(it.file, it.make(), `${state.settings.teamName} ${it.label}`)}>📤 共有</button>
        </div>
      ))}
      {games.length === 0 && <div className="dim small mt8">出力対象の試合がありません。</div>}
    </div>
  );
}
