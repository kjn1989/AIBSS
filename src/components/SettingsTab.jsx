import React, { useState } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { parseFirebaseConfig } from '../lib/cloud.js';
import { encodeWatchLink } from './WatchView.jsx';
import { battingCSV, pitchingCSV, playLogCSV, atBatCSV, downloadCSV, shareCSV } from '../lib/csv.js';

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
      <div className="card">
        <h2>チーム設定</h2>
        <label className="small dim">チーム名</label>
        <input
          value={state.settings.teamName}
          onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { teamName: e.target.value } })}
          placeholder="マイチーム"
        />
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

      <CloudCard />
      <ExportCard />

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

  const copyWatchLink = async () => {
    const link = encodeWatchLink({ configText: s.firebaseConfigText, teamCode: s.teamCode });
    try {
      await navigator.clipboard.writeText(link);
      window.alert('観戦リンクをコピーしました。保護者やOBに送ると、書き込みなしで試合速報をリアルタイム閲覧できます。');
    } catch {
      window.prompt('コピーして共有してください:', link);
    }
  };

  return (
    <div className="card">
      <h2>クラウド共有 (Firebase Firestore)</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        Firebaseコンソールで作ったプロジェクトの構成(firebaseConfig)を貼り付け、
        チームで共通の「チームコード」を決めて全員が同じ値を入力すると、
        試合データがリアルタイムで共有されます。未設定でもローカルだけで完全動作します。
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
          <button className="mt12" style={{ width: '100%' }} onClick={copyWatchLink}>
            📺 観戦リンクをコピー(保護者・OB向け閲覧専用)
          </button>
          <p className="small dim mt8">
            リンクを開いた人は書き込みできず、試合速報(スコア・走者・プレイログ)をリアルタイムで見るだけになります。
          </p>
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
