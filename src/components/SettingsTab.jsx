import React, { useState } from 'react';
import { useStore, usePlayerName, persist, useT } from '../state/store.jsx';
import { parseFirebaseConfig } from '../lib/cloud.js';
import { encodeWatchLink, encodeInviteLink } from './WatchView.jsx';
import QRCode from './QRCode.jsx';
import { battingCSV, pitchingCSV, playLogCSV, atBatCSV, downloadCSV, shareCSV } from '../lib/csv.js';
import { EDITIONS, HAND_LABEL, editionLabel } from '../lib/model.js';
import EditionText from './EditionText.jsx';
import { listProfiles, getActiveProfileId, addProfile, switchActiveProfile, deleteProfile } from '../lib/profiles.js';
import OfficialCloudCard from './OfficialCloudCard.jsx';
import Sheet from './Sheet.jsx';

export default function SettingsTab() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newThrows, setNewThrows] = useState('');
  const [newBats, setNewBats] = useState('');
  const [showGeminiHelp, setShowGeminiHelp] = useState(false);

  const addPlayer = () => {
    if (!newName.trim()) return;
    dispatch({ type: 'ADD_PLAYER', name: newName.trim(), number: newNumber.trim(), throws: newThrows, bats: newBats });
    setNewName('');
    setNewNumber('');
    setNewThrows('');
    setNewBats('');
  };

  return (
    <div>
      <TeamSwitcherCard />

      <div className="card">
        <h2>🌐 {t('settings.language')} / Language</h2>
        <div className="toggle-row">
          <button
            className={(state.settings.lang || 'ja') === 'ja' ? 'active' : ''}
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { lang: 'ja' } })}
          >
            日本語
          </button>
          <button
            className={state.settings.lang === 'en' ? 'active' : ''}
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { lang: 'en' } })}
          >
            English
          </button>
        </div>
        <p className="small dim">{t('settings.language.hint')}</p>
      </div>

      <div className="card">
        <h2>{t('set.teamTitle')}</h2>
        <label className="small dim">{t('set.teamName')}</label>
        <input
          value={state.settings.teamName}
          onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { teamName: e.target.value } })}
          placeholder={t('app.teamFallback')}
        />
        <label className="small dim mt8" style={{ display: 'block' }}>{t('set.edition')}</label>
        <div className="toggle-row editions">
          {EDITIONS.map((ed) => (
            <button
              key={ed}
              className={state.settings.edition === ed ? 'active' : ''}
              onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { edition: ed } })}
            >
              <EditionText edition={ed} />
            </button>
          ))}
        </div>
        <p className="small dim mt8">
          {t('set.editionNote')}
        </p>
      </div>

      <div className="card">
        <h2>{t('set.players', { n: state.players.length })}</h2>
        <div className="flex">
          <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('set.playerName')} />
          <input style={{ width: 70 }} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder={t('set.number')} inputMode="numeric" />
          <button className="primary" onClick={addPlayer}>{t('action.add')}</button>
        </div>
        <div className="flex mt8">
          <label className="small dim" style={{ width: 28 }}>{t('set.throwShort')}</label>
          <select style={{ width: 68 }} value={newThrows} onChange={(e) => setNewThrows(e.target.value)}>
            <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option>
          </select>
          <label className="small dim" style={{ width: 28, marginLeft: 8 }}>{t('set.batShort')}</label>
          <select style={{ width: 68 }} value={newBats} onChange={(e) => setNewBats(e.target.value)}>
            <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option><option value="S">{t('hand.S')}</option>
          </select>
          <span className="small dim grow" style={{ textAlign: 'right' }}>{t('set.handHint')}</span>
        </div>
        <div className="mt12">
          {state.players.map((p) => (
            <div className="row" key={p.id}>
              <span className="pill">{p.number || '-'}</span>
              <span className="grow">{p.name}</span>
              <label className="small dim">{t('set.throwShort')}</label>
              <select className="hand-select" value={p.throws || ''} onChange={(e) => dispatch({ type: 'UPDATE_PLAYER', id: p.id, patch: { throws: e.target.value } })}>
                <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option>
              </select>
              <label className="small dim">{t('set.batShort')}</label>
              <select className="hand-select" value={p.bats || ''} onChange={(e) => dispatch({ type: 'UPDATE_PLAYER', id: p.id, patch: { bats: e.target.value } })}>
                <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option><option value="S">{t('hand.S')}</option>
              </select>
              <button className="small danger ghost" onClick={() => dispatch({ type: 'DELETE_PLAYER', id: p.id })}>{t('action.delete')}</button>
            </div>
          ))}
          {state.players.length === 0 && <div className="dim small mt8">{t('set.noPlayers')}</div>}
        </div>
      </div>

      <div className="card">
        <h2>{t('set.demoTitle')}</h2>
        <p className="small dim" style={{ marginBottom: 10 }}>
          {t('set.demoDesc')}
        </p>
        {state.demoLoaded ? (
          <button className="danger" onClick={() => dispatch({ type: 'CLEAR_DEMO' })}>{t('set.demoDelete')}</button>
        ) : (
          <button className="primary" onClick={() => dispatch({ type: 'LOAD_DEMO' })}>{t('set.demoLoad')}</button>
        )}
      </div>

      <div className="card">
        <h2>{t('set.aiTitle')}</h2>
        <p className="small dim" style={{ marginBottom: 10 }}>
          {t('set.aiDesc', { extra: state.settings.edition === '草野球' ? t('set.aiDescExtra') : '' })}
          <br />{t('set.aiDesc2')}
        </p>
        <div className="flex" style={{ alignItems: 'center' }}>
          <label className="small dim grow">{t('set.geminiKey')}</label>
          <button type="button" className="small ghost" style={{ color: 'var(--accent)' }} onClick={() => setShowGeminiHelp(true)}>
            {t('set.geminiHelpBtn')}
          </button>
        </div>
        <input
          type="password"
          value={state.settings.geminiApiKey}
          onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { geminiApiKey: e.target.value } })}
          placeholder={t('set.geminiPlaceholder')}
        />
        <div className="flex mt12">
          <span className="grow small">{t('set.voiceAiToggle')}</span>
          <button
            className={`small ${state.settings.useLLM ? 'primary' : ''}`}
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { useLLM: !state.settings.useLLM } })}
          >
            {state.settings.useLLM ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex mt8">
          <span className="grow small">{t('set.maskToggle')}</span>
          <button
            className={`small ${state.settings.maskAiNames ? 'primary' : ''}`}
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { maskAiNames: !state.settings.maskAiNames } })}
          >
            {state.settings.maskAiNames ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="small dim mt8">
          {t('set.aiNote')}
        </p>
      </div>
      {showGeminiHelp && <GeminiKeyHelpSheet onClose={() => setShowGeminiHelp(false)} />}

      <OfficialCloudCard />
      <CloudCard />
      <ExportCard />
      <BackupCard />
      <DangerZoneCard />

      <div className="card">
        <h2>{t('set.dataMgmt')}</h2>
        <p className="small dim">
          {t('set.dataMgmtDesc')}
        </p>
      </div>
    </div>
  );
}

// ---- Gemini APIキーの出し方・注意点(ポップアップ解説) ----
function GeminiKeyHelpSheet({ onClose }) {
  const t = useT();
  return (
    <Sheet title={t('set.geminiHelpTitle')} onClose={onClose}>
      <div className="section-title" style={{ marginTop: 0 }}>{t('set.geminiHelp1')}</div>
      <ol className="small" style={{ paddingLeft: 18, marginBottom: 12, lineHeight: 1.8 }}>
        <li>{t('set.geminiHelp1a')}</li>
        <li>{t('set.geminiHelp1b')}</li>
        <li>{t('set.geminiHelp1c')}</li>
        <li>{t('set.geminiHelp1d')}</li>
        <li>{t('set.geminiHelp1e')}</li>
      </ol>

      <div className="section-title">{t('set.geminiHelp2')}</div>
      <p className="small dim mb8">
        {t('set.geminiHelp2p')}
      </p>

      <div className="section-title">{t('set.geminiHelp3')}</div>
      <p className="small dim mb8">
        {t('set.geminiHelp3p')}
      </p>

      <div className="section-title">{t('set.geminiHelp4')}</div>
      <p className="small dim mb8">
        {t('set.geminiHelp4p')}
      </p>

      <div className="section-title">{t('set.geminiHelp5')}</div>
      <p className="small dim mb8">
        {t('set.geminiHelp5p')}
      </p>

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

// ---- 所属チームの追加・切り替え(草野球チームと部活チーム等、複数チームに所属する場合) ----
function TeamSwitcherCard() {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [profiles, setProfiles] = useState(() => listProfiles());
  const activeId = getActiveProfileId();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEdition, setNewEdition] = useState(EDITIONS[0]);

  const switchTo = (id) => {
    if (id === activeId) return;
    if (!window.confirm(t('set.switchConfirm'))) return;
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
    if (profiles.length <= 1) { window.alert(t('set.lastTeamAlert')); return; }
    if (!window.confirm(t('set.deleteTeamConfirm', { name }))) return;
    deleteProfile(id);
    setProfiles(listProfiles());
  };

  return (
    <div className="card">
      <h2>{t('set.myTeams')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('set.myTeamsDesc')}
      </p>
      {profiles.map((p) => (
        <div className="row" key={p.id}>
          <div className="grow" onClick={() => switchTo(p.id)} role="button">
            <b style={{ color: p.id === activeId ? 'var(--accent)' : 'var(--text)' }}>
              {p.id === activeId ? '✅ ' : ''}{p.name}
            </b>
            <span className="pill" style={{ marginLeft: 6 }}>{lang === 'en' ? t(`edition.${p.edition}`) : editionLabel(p.edition)}</span>
          </div>
          {p.id !== activeId && (
            <button className="small ghost" style={{ color: 'var(--red)' }} onClick={() => remove(p.id, p.name)}>{t('action.delete')}</button>
          )}
        </div>
      ))}
      {adding ? (
        <div className="mt12">
          <label className="small dim">{t('set.teamName')}</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('set.teamNamePlaceholder')} />
          <label className="small dim mt8" style={{ display: 'block' }}>{t('set.edition')}</label>
          <div className="toggle-row editions">
            {EDITIONS.map((ed) => (
              <button key={ed} className={newEdition === ed ? 'active' : ''} onClick={() => setNewEdition(ed)}><EditionText edition={ed} /></button>
            ))}
          </div>
          <div className="grid2 mt8">
            <button className="ghost" onClick={() => setAdding(false)}>{t('action.cancel')}</button>
            <button className="primary" disabled={!newName.trim()} onClick={createTeam}>{t('set.addSwitch')}</button>
          </div>
        </div>
      ) : (
        <button className="mt12" style={{ width: '100%' }} onClick={() => setAdding(true)}>{t('set.addTeam')}</button>
      )}
    </div>
  );
}

// ---- データのリセット(試合の全削除 / 完全初期化) ----
function DangerZoneCard() {
  const { state, dispatch } = useStore();
  const t = useT();
  const gameCount = Object.keys(state.games).length;
  const playerCount = state.players.length;

  const deleteAllGames = () => {
    if (gameCount === 0) { window.alert(t('set.noGamesToDelete')); return; }
    if (!window.confirm(t('set.deleteAllGamesConfirm', { n: gameCount, p: playerCount }))) return;
    // 消える前に自動バックアップを促す最終確認
    if (!window.confirm(t('set.finalDeleteConfirm'))) return;
    dispatch({ type: 'DELETE_ALL_GAMES' });
    window.alert(t('set.deletedGames'));
  };

  const resetAll = () => {
    if (!window.confirm(t('set.resetConfirm', { n: gameCount, p: playerCount }))) return;
    if (!window.confirm(t('set.finalResetConfirm'))) return;
    dispatch({ type: 'RESET_ALL' });
    window.alert(t('set.resetDone'));
  };

  return (
    <div className="card danger-zone">
      <h2>{t('set.dangerTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('set.dangerDescA')}
        <b>{t('set.dangerDescB')}</b>{t('set.dangerDescC')}
      </p>
      <button className="ghost danger" style={{ width: '100%', marginBottom: 8 }} onClick={deleteAllGames}>
        {t('set.deleteGamesBtn')}
      </button>
      <button className="danger" style={{ width: '100%' }} onClick={resetAll}>
        {t('set.resetBtn')}
      </button>
    </div>
  );
}

// ---- バックアップ/復元(全データのJSONエクスポート・インポート) ----
function BackupCard() {
  const { state, dispatch } = useStore();
  const t = useT();
  const stamp = new Date().toISOString().slice(0, 10);

  // データ消失対策のリマインド: 最終バックアップからの経過を表示し、古ければ警告する
  const last = state.settings.lastBackupAt;
  const nGames = Object.keys(state.games || {}).length;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const lastLabel = last ? (daysSince === 0 ? t('set.today') : t('set.daysAgo', { n: daysSince })) : t('set.neverBackup');
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
          window.alert(t('set.notBackupFile'));
          return;
        }
        const nGames = Object.keys(data.games || {}).length;
        const nPlayers = (data.players || []).length;
        if (!window.confirm(
          t('set.restoreConfirm', { p: nPlayers, g: nGames, date: data.exportedAt?.slice(0, 10) || t('set.dateUnknown') })
        )) return;
        dispatch({ type: 'IMPORT_BACKUP', payload: data });
        window.alert(t('set.restored'));
      } catch {
        window.alert(t('set.parseError'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="card">
      <h2>{t('set.backupTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('set.backupDesc')}
      </p>
      <div className="small" style={{ marginBottom: 10 }}>{t('set.lastBackupPrefix')}<b>{lastLabel}</b></div>
      {stale && (
        <div className="warn-box" style={{ marginBottom: 10 }}>
          {t('set.staleWarn')}
        </div>
      )}
      <div className="grid2">
        <button className="primary" onClick={exportBackup}>{t('set.saveBackup')}</button>
        <label className="file-btn">
          {t('set.restoreFile')}
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
          {t('set.pwaHint')}
        </p>
      )}
    </div>
  );
}

// ---- クラウド共有(Firebase Firestore) ----
function CloudCard() {
  const { state, dispatch } = useStore();
  const t = useT();
  const s = state.settings;
  const cfgValid = !!parseFirebaseConfig(s.firebaseConfigText);
  const statusLabel = {
    off: t('set.cloudOff'),
    connecting: t('set.cloudConnecting'),
    on: t('set.cloudOn'),
    error: t('set.cloudError'),
  }[state.cloudStatus];

  const [qr, setQr] = useState(null); // 'watch' | 'invite' | null

  const copyLink = async (link, msg) => {
    try {
      await navigator.clipboard.writeText(link);
      window.alert(msg);
    } catch {
      window.prompt(t('set.copyPrompt'), link);
    }
  };
  const watchLink = () => encodeWatchLink({ configText: s.firebaseConfigText, teamCode: s.teamCode });
  const inviteLink = () => encodeInviteLink({ configText: s.firebaseConfigText, teamCode: s.teamCode });

  return (
    <div className="card">
      <h2>{t('set.cloudTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('set.cloudDesc')}
      </p>
      <label className="small dim">{t('set.firebaseConfigLabel')}</label>
      <textarea
        rows={5}
        value={s.firebaseConfigText}
        onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { firebaseConfigText: e.target.value } })}
        placeholder={'{\n  "apiKey": "...",\n  "projectId": "...",\n  ...\n}'}
      />
      {s.firebaseConfigText && !cfgValid && <div className="warn-box">{t('set.configError')}</div>}
      <label className="small dim mt8" style={{ display: 'block' }}>{t('set.teamCodeLabel')}</label>
      <input
        value={s.teamCode}
        onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { teamCode: e.target.value.trim() } })}
        placeholder={t('set.teamCodePlaceholder')}
      />
      <div className="flex mt12">
        <span className="grow small">{t('set.statusPrefix', { label: statusLabel })}</span>
        <button
          className={s.cloudEnabled ? 'danger' : 'primary'}
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { cloudEnabled: !s.cloudEnabled } })}
          disabled={!s.cloudEnabled && (!cfgValid || !s.teamCode)}
        >
          {s.cloudEnabled ? t('set.stopShare') : t('set.startShare')}
        </button>
      </div>
      {s.cloudEnabled && cfgValid && s.teamCode && (
        <>
          <div className="section-title">{t('set.inviteMembers')}</div>
          <p className="small dim" style={{ marginBottom: 8 }}>
            {t('set.inviteDesc')}
          </p>
          <div className="grid2">
            <button onClick={() => copyLink(inviteLink(), t('set.inviteCopied'))}>
              {t('set.inviteLink')}
            </button>
            <button onClick={() => setQr(qr === 'invite' ? null : 'invite')}>
              {qr === 'invite' ? t('set.closeQr') : t('set.inviteQr')}
            </button>
          </div>
          {qr === 'invite' && (
            <div className="qr-box"><QRCode text={inviteLink()} /><span className="small dim">{t('set.qrHint')}</span></div>
          )}

          <div className="section-title">{t('set.watchTitle')}</div>
          <p className="small dim" style={{ marginBottom: 8 }}>
            {t('set.watchDesc')}
          </p>
          <div className="grid2">
            <button onClick={() => copyLink(watchLink(), t('set.watchCopied'))}>
              {t('set.watchLink')}
            </button>
            <button onClick={() => setQr(qr === 'watch' ? null : 'watch')}>
              {qr === 'watch' ? t('set.closeQr') : t('set.watchQr')}
            </button>
          </div>
          {qr === 'watch' && (
            <div className="qr-box"><QRCode text={watchLink()} /><span className="small dim">{t('set.qrHint')}</span></div>
          )}
        </>
      )}
    </div>
  );
}

// ---- CSV出力・共有 ----
function ExportCard() {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState('all'); // all | current
  const games =
    scope === 'current' && state.currentGameId
      ? [state.games[state.currentGameId]].filter(Boolean)
      : Object.values(state.games);
  const stamp = new Date().toISOString().slice(0, 10);

  const items = [
    { label: t('set.csvBatting'), make: () => battingCSV(games, nameOf), file: `打者成績_${stamp}.csv` },
    { label: t('set.csvPitching'), make: () => pitchingCSV(games, nameOf), file: `投手成績_${stamp}.csv` },
    { label: t('set.csvPlayLog'), make: () => playLogCSV(games, nameOf, state.settings.teamName), file: `プレイログ_${stamp}.csv` },
    { label: t('set.csvAtBat'), make: () => atBatCSV(games, nameOf), file: `打席詳細_${stamp}.csv` },
  ];

  return (
    <div className="card">
      <h2>{t('set.csvTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('set.csvDesc')}
      </p>
      <div className="toggle-row">
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>{t('set.allGames')}</button>
        <button className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')} disabled={!state.currentGameId}>
          {t('set.currentGame')}
        </button>
      </div>
      {items.map((it) => (
        <div className="row" key={it.label}>
          <span className="grow">{it.label}</span>
          <button className="small" onClick={() => downloadCSV(it.file, it.make())}>{t('set.dl')}</button>
          <button className="small" onClick={() => shareCSV(it.file, it.make(), `${state.settings.teamName} ${it.label}`)}>{t('set.shareBtn')}</button>
        </div>
      ))}
      {games.length === 0 && <div className="dim small mt8">{t('set.noExportGames')}</div>}
    </div>
  );
}
