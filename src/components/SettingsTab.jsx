import React, { useState, useEffect, useMemo } from 'react';
import { useStore, usePlayerName, persist, useT } from '../state/store.jsx';
import { parseFirebaseConfig } from '../lib/cloud.js';
import { encodeWatchLink, encodeInviteLink } from './WatchView.jsx';
import QRCode from './QRCode.jsx';
import { resetFieldPadHint } from './FieldPad.jsx';
import { battingCSV, pitchingCSV, playLogCSV, atBatCSV, downloadCSV, shareCSV } from '../lib/csv.js';
import { EDITIONS, HAND_LABEL, editionLabel, FIELD_POSITIONS, uncoveredPositions } from '../lib/model.js';
import {
  isArchived, tenureByPlayer, currentYear, currentSchoolYear, DEFAULT_YEAR_START_MONTH,
  usesGrade, defaultSchoolType, defaultYearStartMonth, maxGradeOf, gradeOf, entryYearFromGrade,
  sortByGrade, SCHOOL_TYPES, SEASON_START_MONTHS, labelOfYear, yearLabel, yearsInGames,
} from '../lib/year.js';
import EditionText from './EditionText.jsx';
import { listProfiles, getActiveProfileId, addProfile, switchActiveProfile, deleteProfile, listOrphanedProfiles, restoreProfile } from '../lib/profiles.js';
import OfficialCloudCard from './OfficialCloudCard.jsx';
import Sheet from './Sheet.jsx';
import RosterManageSheet from './RosterManageSheet.jsx';

// 同じ名前で二重登録された選手を検出して統合を促すカード。
// 二重登録があると「同じ人」と判定できず、打順移動の表示や通算成績が分断される。
// 出場記録が多い方(=本来使われている方)を残す側の既定にする。
// 代の呼び名。伝統校の「第75期」、主将の名を取った「山田の代」など、
// チームによって呼び方の文化が違うので、既定の呼び方を上書きできるようにする。
// 上書きは settings.yearLabels に { 年: '呼び名' } で持つ(空欄なら既定)。
function SeasonNames() {
  const { state, dispatch } = useStore();
  const t = useT();
  const startMonth = state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  const labels = state.settings.yearLabels || {};
  // 記録のある代 + いまの代(まだ試合が無くても名前を付けられるように)
  const years = [...new Set([
    ...yearsInGames(Object.values(state.games), startMonth),
    currentYear(startMonth),
  ])].sort((a, b) => b - a);
  if (!years.length) return null;

  const setLabel = (y, v) => {
    const next = { ...labels };
    if (v.trim()) next[y] = v; else delete next[y];
    dispatch({ type: 'UPDATE_SETTINGS', patch: { yearLabels: next } });
  };

  return (
    <div className="mt12">
      <label className="small dim" style={{ display: 'block', marginBottom: 4 }}>{t('season.names')}</label>
      {years.slice(0, 8).map((y) => (
        <div className="row" key={y}>
          <span className="small dim" style={{ width: 92, flex: '0 0 92px' }}>
            {t('season.default', { label: yearLabel(y, state.settings.lang || 'ja', startMonth) })}
          </span>
          <input
            className="grow"
            value={labels[y] || ''}
            placeholder={yearLabel(y, state.settings.lang || 'ja', startMonth)}
            onChange={(e) => setLabel(y, e.target.value)}
          />
        </div>
      ))}
      <p className="small dim" style={{ marginTop: 4 }}>{t('season.namesHint')}</p>
    </div>
  );
}

// 主将・副主将。名簿の行はもう要素が多く、役割の選択を各行に置くと選手名が潰れる。
// 設定は1か所(この行)に集約し、行側には背番号ピルの色だけで示す(行幅の消費ゼロ)。
function TeamRoleRow() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [picking, setPicking] = useState(null); // 'captain' | 'vice' | null
  const active = state.players.filter((p) => !isArchived(p));
  const nameOf = (role) => active.filter((p) => p.teamRole === role).map((p) => p.name).join('・');
  const cap = nameOf('captain');
  const vice = nameOf('vice');

  return (
    <div className="role-row mt8">
      <button className="role-chip" onClick={() => setPicking(picking === 'captain' ? null : 'captain')}>
        <b>{t('role.captain')}</b>
        <span>{cap || t('role.unset')}</span>
      </button>
      <button className="role-chip" onClick={() => setPicking(picking === 'vice' ? null : 'vice')}>
        <b>{t('role.vice')}</b>
        <span>{vice || t('role.unset')}</span>
      </button>
      {picking && (
        <div className="role-pick">
          <div className="small dim" style={{ marginBottom: 6 }}>
            {t('role.pick', { role: t(`role.${picking}`) })}
          </div>
          <div className="role-opts">
            <button
              className="small ghost"
              onClick={() => {
                active.filter((p) => p.teamRole === picking)
                  .forEach((p) => dispatch({ type: 'SET_TEAM_ROLE', id: p.id, role: '' }));
                setPicking(null);
              }}
            >
              {t('role.none')}
            </button>
            {active.map((p) => (
              <button
                key={p.id}
                className={`small ${p.teamRole === picking ? 'primary' : 'ghost'}`}
                onClick={() => { dispatch({ type: 'SET_TEAM_ROLE', id: p.id, role: picking }); setPicking(null); }}
              >
                {p.number ? `${p.number} ` : ''}{p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 学年をまとめて設定
//
// 1人ずつ直せるようにはしたが、名簿を作った直後は全員が未設定になる。
// 10人20人を1行ずつ開いて選ぶのは現実的でないので、まとめて付ける道を用意する。
// 押した瞬間に保存する(まとめて設定しておいて保存を押し忘れる事故を作らない)。
// ============================================================
// ---- 守備位置を決めるシート ----
// メインとサブを別々に並べる。1回押すとサブ、もう1回でメイン、という
// 切り替え方は説明を読まないと分からず、読んでも指が覚えるまで迷っていた。
// とくに「1つしか守らない選手」がいちばん多いのに、その人でも2回押す必要があった。
//
// メインは丸(1つだけ)、サブは四角(複数)。ラジオとチェックの違いは説明が要らない。
// サブは選んだ順が優先順位で、番号を出す。上げ下げもできる。
function PositionSheet({ player, onClose }) {
  const { dispatch } = useStore();
  const t = useT();
  const main = player.position || '';
  const subs = player.subPositions || [];
  const patch = (p) => dispatch({ type: 'UPDATE_PLAYER', id: player.id, patch: p });

  const setMain = (pos) => {
    const next = main === pos ? '' : pos;
    // メインに選んだ位置はサブから外す。同じ位置が二重に立つと順番も意味を失う
    patch({ position: next, subPositions: subs.filter((x) => x !== next) });
  };
  const toggleSub = (pos) => {
    if (pos === main) return;
    patch({ subPositions: subs.includes(pos) ? subs.filter((x) => x !== pos) : [...subs, pos] });
  };
  const promote = (pos) => {
    const i = subs.indexOf(pos);
    if (i <= 0) return;
    const next = [...subs];
    next[i - 1] = subs[i];
    next[i] = subs[i - 1];
    patch({ subPositions: next });
  };

  return (
    <Sheet title={t('pos.sheetTitle', { name: player.name })} onClose={onClose}>
      <p className="dim small" style={{ marginTop: 0 }}>{t('pos.sheetHint')}</p>

      <div className="pos-sec">{t('pos.mainHead')}<i>{t('pos.mainNote')}</i></div>
      <div className="pos-chips">
        {FIELD_POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            className={`pos-chip radio${main === pos ? ' pos-main' : ''}`}
            role="radio"
            aria-checked={main === pos}
            onClick={() => setMain(pos)}
          >
            <span className="mk" aria-hidden="true" />{pos}
          </button>
        ))}
      </div>

      <div className="pos-sec">{t('pos.subHead')}<i>{t('pos.subNote')}</i></div>
      <div className="pos-chips">
        {FIELD_POSITIONS.map((pos) => {
          const isMain = main === pos;
          const rank = subs.indexOf(pos);
          return (
            <button
              key={pos}
              type="button"
              className={`pos-chip check${rank >= 0 ? ' pos-sub' : ''}${isMain ? ' is-main-here' : ''}`}
              role="checkbox"
              aria-checked={rank >= 0}
              disabled={isMain}
              title={isMain ? t('pos.alreadyMain') : ''}
              onClick={() => toggleSub(pos)}
            >
              <span className="mk" aria-hidden="true" />{pos}
              {rank >= 0 && <b className="rank">{rank + 1}</b>}
            </button>
          );
        })}
      </div>

      {/* サブが2つ以上あるときだけ、順番を直す行を出す。
          1つしか無いなら順番に意味が無いので出さない */}
      {subs.length > 1 && (
        <>
          <div className="pos-sec">{t('pos.orderHead')}<i>{t('pos.orderNote')}</i></div>
          <div className="pos-order">
            {subs.map((pos, i) => (
              <span key={pos} className="pos-order-item">
                <b>{i + 1}</b>{pos}
                <button
                  type="button"
                  className="up"
                  disabled={i === 0}
                  aria-label={t('pos.promote', { pos })}
                  onClick={() => promote(pos)}
                >
                  ↑
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

function GradeBulkSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const thisYear = currentSchoolYear();
  const maxGrade = maxGradeOf(state.settings.schoolType || defaultSchoolType(state.settings.edition)) || 6;
  // 未設定を先頭に出す。やることが上から順に並ぶようにする
  const rows = useMemo(() => {
    const active = state.players.filter((p) => !isArchived(p));
    return [...active].sort((a, b) => {
      const ga = gradeOf(a, thisYear);
      const gb = gradeOf(b, thisYear);
      if (ga == null && gb != null) return -1;
      if (gb == null && ga != null) return 1;
      return (ga || 0) - (gb || 0);
    });
  }, [state.players, thisYear]);
  const unset = rows.filter((p) => gradeOf(p, thisYear) == null).length;

  const set = (p, grade) => dispatch({
    type: 'UPDATE_PLAYER', id: p.id,
    patch: { entryYear: entryYearFromGrade(grade, thisYear) },
  });

  return (
    <Sheet title={t('grade.bulkTitle')} onClose={onClose}>
      <p className="small dim" style={{ margin: '0 0 12px' }}>{t('grade.bulkNote')}</p>
      {rows.map((p) => {
        const g = gradeOf(p, thisYear);
        return (
          <div className="row grade-bulk-row" key={p.id}>
            <span className="grow player-name">{p.name}</span>
            <span className="grade-pick">
              {/* 「なし」は現在値でも光らせない。色が付いているのは「決めた行」だけにして、
                  残りの作業が一目で分かるようにする */}
              <button className="none" onClick={() => set(p, '')}>{t('grade.none')}</button>
              {Array.from({ length: maxGrade }, (_, i) => i + 1).map((n) => (
                <button key={n} className={g === n ? 'on' : ''} onClick={() => set(p, n)}>{n}</button>
              ))}
            </span>
          </div>
        );
      })}
      {rows.length === 0 && <div className="dim small">{t('set.noPlayers')}</div>}
      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>
          {unset > 0 ? t('grade.bulkRemain', { n: unset }) : t('action.close')}
        </button>
      </div>
    </Sheet>
  );
}

// 打球パッドの初回説明を、もう一度出せるようにする。
// 「どこでも押せる」は一度見れば分かるが、あとから入った人には見せたい。
function PadHintCard() {
  const t = useT();
  const [done, setDone] = React.useState(false);
  return (
    <div className="card">
      <h2>{t('padHint.title')}</h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('padHint.body')}<br />{t('padHint.perGame')}
      </p>
      <button onClick={() => { resetFieldPadHint(); setDone(true); }}>{t('padHint.reset')}</button>
      {done && <p className="small" style={{ color: 'var(--green)', margin: '10px 0 0' }}>{t('padHint.resetDone')}</p>}
    </div>
  );
}

function DuplicatePlayersCard() {
  const { state, dispatch } = useStore();
  const t = useT();

  // 名前ごとにまとめ、2件以上あるものを重複とみなす
  const byName = new Map();
  for (const p of state.players) {
    const key = (p.name || '').trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }
  // 各選手が何回出場記録に現れるか(残す側を決める材料)
  const useCount = (id) => {
    let n = 0;
    for (const g of Object.values(state.games)) {
      for (const ab of g.atBats || []) if (ab.playerId === id) n++;
      for (const l of g.lineup || []) if (l.playerId === id) n++;
      for (const l of g.startingLineup || []) if (l.playerId === id) n++;
      for (const log of g.playLogs || []) {
        const p = log.payload || {};
        if (p.playerId === id || p.in === id || p.out === id) n++;
      }
    }
    return n;
  };

  const dups = [...byName.entries()].filter(([, list]) => list.length > 1);
  if (dups.length === 0) return null;

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('set.dupTitle')}</div>
      <p className="small dim" style={{ marginTop: 0 }}>{t('set.dupDesc')}</p>
      {dups.map(([name, list]) => {
        // 出場記録が多い順、同数なら背番号がある方を優先して残す
        const ranked = [...list].sort((a, b) => (useCount(b.id) - useCount(a.id)) || ((b.number ? 1 : 0) - (a.number ? 1 : 0)));
        const keep = ranked[0];
        const others = ranked.slice(1);
        const label = (p) => `${p.name}${p.number ? ` #${p.number}` : t('set.dupNoNumber')}（${t('set.dupUses', { n: useCount(p.id) })}）`;
        return (
          <div className="row" key={name} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="grow">
              <b>{name}</b>
              <div className="small dim">{t('set.dupKeep', { who: label(keep) })}</div>
              {others.map((o) => <div className="small dim" key={o.id}>{t('set.dupMerge', { who: label(o) })}</div>)}
            </div>
            <button
              className="primary small"
              onClick={() => {
                if (!window.confirm(t('set.dupConfirm', { name, keep: label(keep), n: others.length }))) return;
                for (const o of others) dispatch({ type: 'MERGE_PLAYERS', keepId: keep.id, mergeId: o.id });
              }}
            >
              {t('set.dupAction')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function SettingsTab() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newThrows, setNewThrows] = useState('');
  const [newBats, setNewBats] = useState('');
  const [showGeminiHelp, setShowGeminiHelp] = useState(false);
  const [newGrade, setNewGrade] = useState('');
  const [rosterSort, setRosterSort] = useState('grade');
  const [gradeBulk, setGradeBulk] = useState(false);
  const [manage, setManage] = useState(false);
  const [posPlayer, setPosPlayer] = useState(null); // 守備位置シートを開いている選手ID
  // 学年はブカツ・少年野球でのみ使う。草野球では欄ごと出さない
  const gradeOn = usesGrade(state.settings.edition);
  const startMonth = state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  // 学年は学校の年度(4月始まり)で数える。チームの代(中学・高校は9月始まり)とは別軸
  const thisYear = currentSchoolYear();
  const schoolType = state.settings.schoolType || defaultSchoolType(state.settings.edition);
  const maxGrade = maxGradeOf(schoolType) || 6;

  // 名簿の並び。学年順のときは学年ごとの見出しを差し込む(どこで区切れるか分かるように)
  // 誰も守れない位置。現役の名簿だけで見る(アーカイブ済みは出られない)
  const holes = uncoveredPositions(state.players.filter((p) => !isArchived(p)));

  const rosterRows = (() => {
    const active = state.players.filter((p) => !isArchived(p));
    let rows = active;
    if (gradeOn && rosterSort === 'grade') rows = sortByGrade(active, thisYear);
    else if (rosterSort === 'number') {
      const num = (p) => { const n = parseInt(p.number, 10); return Number.isFinite(n) ? n : Infinity; };
      rows = [...active].sort((a, b) => num(a) - num(b));
    }
    const showHeads = gradeOn && rosterSort === 'grade';
    let prev;
    // 学年は行の中で直せるようにする(見出しは区切りで、直す手段ではない)。
    return rows.map((p, i) => {
      const g = gradeOf(p, thisYear);
      let head = null;
      if (showHeads && (i === 0 || g !== prev)) {
        head = { grade: g, n: rows.filter((x) => gradeOf(x, thisYear) === g).length, entry: p.entryYear };
      }
      prev = g;
      return { p, head, grade: g };
    });
  })();

  // 学年が未設定の人数。名簿を作った直後は全員がここに入る
  const unsetGrades = gradeOn
    ? state.players.filter((p) => !isArchived(p) && gradeOf(p, thisYear) == null).length
    : 0;

  const addPlayer = () => {
    if (!newName.trim()) return;
    // 入力は「学年」で受け、保存は入学年度に変換する(学年は毎年変わるが入学年度は変わらない)
    dispatch({
      type: 'ADD_PLAYER', name: newName.trim(), number: newNumber.trim(), throws: newThrows, bats: newBats,
      entryYear: gradeOn ? entryYearFromGrade(newGrade, thisYear) : null,
    });
    setNewName('');
    setNewNumber('');
    setNewThrows('');
    setNewBats('');
    setNewGrade('');
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
        {gradeOn && (
          <div className="mt12">
            <label className="small dim" style={{ display: 'block', marginBottom: 4 }}>{t('grade.school')}</label>
            <select
              value={schoolType || ''}
              onChange={(e) => dispatch({
                type: 'UPDATE_SETTINGS',
                patch: {
                  schoolType: e.target.value,
                  // 中学・高校は夏の大会で代が替わるので、代の開始月も合わせる
                  yearStartMonth: defaultYearStartMonth(state.settings.edition, e.target.value),
                },
              })}
            >
              {SCHOOL_TYPES.map((st) => <option key={st.id} value={st.id}>{t(`school.${st.id}`)}</option>)}
            </select>
            <p className="small dim" style={{ marginTop: 4 }}>{t('grade.schoolHint')}</p>

            {/* 代の切り替わり月。夏の大会の時期は地域やチームで前後するので選べるようにする */}
            <label className="small dim" style={{ display: 'block', margin: '12px 0 4px' }}>{t('season.start')}</label>
            <select
              value={startMonth}
              onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { yearStartMonth: Number(e.target.value) } })}
            >
              {SEASON_START_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m === 4 ? t('season.aprilNote') : m === 1 ? t('season.janNote') : t('season.month', { n: m })}
                </option>
              ))}
            </select>
            <p className="small dim" style={{ marginTop: 4 }}>
              {t('season.startHint')}
              {' '}
              <span style={{ color: 'var(--accent)' }}>
                {labelOfYear(thisYear - (startMonth >= 7 ? 1 : 0), state.settings)}
              </span>
            </p>
            <SeasonNames />
          </div>
        )}
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
        <h2>{t('set.players', { n: state.players.filter((p) => !isArchived(p)).length })}</h2>
        {/* 追加フォームは1つの枠にまとめ、確定ボタンを最後に置く。
            以前は「追加」が1行目にあったので、下の 投/打/学年 がフォームの一部に
            見えず、一覧の絞り込みだと誤解されていた */}
        <div className="add-form">
          <div className="add-form-title">{t('set.addPlayer')}</div>
          <div className="flex">
            <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('set.playerName')} />
            <input style={{ width: 70 }} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder={t('set.number')} inputMode="numeric" />
          </div>
          <div className="flex mt8">
            <label className="small dim" style={{ width: 28 }}>{t('set.throwShort')}</label>
            <select style={{ width: 62 }} value={newThrows} onChange={(e) => setNewThrows(e.target.value)}>
              <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option>
            </select>
            <label className="small dim" style={{ width: 28, marginLeft: 4 }}>{t('set.batShort')}</label>
            <select style={{ width: 62 }} value={newBats} onChange={(e) => setNewBats(e.target.value)}>
              <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option><option value="S">{t('hand.S')}</option>
            </select>
            {gradeOn ? (
              <>
                <label className="small dim" style={{ width: 28, marginLeft: 4 }}>{t('grade.label')}</label>
                <select className="grow" value={newGrade} onChange={(e) => setNewGrade(e.target.value)}>
                  <option value="">—</option>
                  {Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => (
                    <option key={g} value={g}>{t('grade.nth', { n: g })}</option>
                  ))}
                </select>
              </>
            ) : (
              <span className="small dim grow" style={{ textAlign: 'right' }}>{t('set.handHint')}</span>
            )}
          </div>
          {gradeOn && newGrade && (
            <p className="small mt8" style={{ color: 'var(--accent)', margin: '8px 0 0' }}>
              {t('grade.entryHint', { y: entryYearFromGrade(newGrade, thisYear) })}
            </p>
          )}
          <button className="primary mt8" style={{ width: '100%' }} onClick={addPlayer}>{t('action.add')}</button>
        </div>
        <TeamRoleRow />
        {gradeOn && (
          <button className="small ghost mt8" style={{ width: '100%' }} onClick={() => setGradeBulk(true)}>
            {t('grade.bulkOpen')}
            {unsetGrades > 0 && <span className="dim"> ({t('grade.bulkUnset', { n: unsetGrades })})</span>}
          </button>
        )}
        {/* アーカイブと削除は年に数回しか触らず、削除は取り消せない。
            各行に常時置くのをやめ、この入口の奥にまとめる */}
        <button className="small ghost mt8 manage-open" style={{ width: '100%' }} onClick={() => setManage(true)}>
          {t('manage.open')}
          <span className="dim">{t('manage.openSub')}</span>
        </button>
        {gradeOn && (
          <>
          <div className="lens-row mt8">
            {[['grade', 'grade.sortGrade'], ['number', 'grade.sortNumber'], ['added', 'grade.sortAdded']].map(([k, key]) => (
              <button key={k} className={rosterSort === k ? 'on' : ''} onClick={() => setRosterSort(k)}>{t(key)}</button>
            ))}
          </div>
          </>
        )}
        <div className="mt12 roster-list">
          {/* 行のいちばん左が背番号だと分かるように書く。すぐ上に「学年」の見出しが
              出るので、丸の数字が学年に見えてしまっていた */}
          {rosterRows.length > 0 && <div className="roster-legend">{t('set.rosterLegend')}</div>}
          {/* 学年の区切りが無いエディションには載せる見出しが無いので、一覧の直上に1本出す */}
          {rosterRows.length > 0 && !gradeOn && (
            <div className="roster-colhead">
              <span className="sp" /><i>{t('set.throwShort')}</i><i>{t('set.batShort')}</i>
            </div>
          )}
          {rosterRows.map(({ p, head, grade }) => (
            <React.Fragment key={p.id}>
              {head && (
                <div className="grade-head">
                  <b>{head.grade == null ? t('grade.unset') : t('grade.nth', { n: head.grade })}</b>
                  {head.grade != null && <span>{t('grade.count', { n: head.n, y: head.entry })}</span>}
                  {/* 右/左のセレクトが2つ並ぶだけでは、どちらが投でどちらが打か行から
                      読み取れない。区切りの見出しは「この区切りの中で共通のこと」を
                      書く場所なので、列の名前をここに置く(行の高さは増えない) */}
                  <span className="hand-cols">
                    <i>{t('set.throwShort')}</i><i>{t('set.batShort')}</i>
                  </span>
                </div>
              )}
            <div className="row">
              <input
                className={`num-edit${p.teamRole === 'captain' ? ' cap' : p.teamRole === 'vice' ? ' vice' : ''}`}
                title={p.teamRole === 'captain' ? t('role.captain') : p.teamRole === 'vice' ? t('role.vice') : undefined}
                value={p.number || ''}
                onChange={(e) => dispatch({ type: 'UPDATE_PLAYER', id: p.id, patch: { number: e.target.value } })}
                placeholder="-"
                inputMode="numeric"
                maxLength={3}
                aria-label={t('set.number')}
              />
              <span className="grow player-cell">
                <span className="player-name">{p.name}</span>
                <span className="player-meta">
                {gradeOn && (
                  // 学年は登録時にしか決められず、あとから直せなかった。
                  // 入れ違いや入力漏れを直す手段が無いと名簿が信用できなくなる
                  <select
                    className="grade-select"
                    aria-label={t('grade.label')}
                    value={grade == null ? '' : grade}
                    onChange={(e) => dispatch({
                      type: 'UPDATE_PLAYER', id: p.id,
                      patch: { entryYear: entryYearFromGrade(e.target.value, thisYear) },
                    })}
                  >
                    {/* 行の中では幅を取れないので短い言い方にする(見出しは「学年 未設定」) */}
                    <option value="">{t('grade.unsetShort')}</option>
                    {Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => (
                      <option key={g} value={g}>{t('grade.nth', { n: g })}</option>
                    ))}
                  </select>
                )}
                {/* 守備位置。ここが空だとAIスタメン提案は「誰がどこを守れるか」を
                    知らないまま9枠を埋めることになる */}
                <button
                  type="button"
                  className={`pos-btn${p.position ? ' set' : ''}`}
                  onClick={() => setPosPlayer(p.id)}
                  aria-label={t('pos.sheetTitle', { name: p.name })}
                >
                  {p.position ? <b>{p.position}</b> : t('pos.unset')}
                  {/* サブは優先順の上位2つを位置そのもので出し、残りは数にする。
                      数だけだと「何を守れるのか」が名簿から読み取れない */}
                  {(p.subPositions || []).length > 0 && (
                    <i>{(p.subPositions || []).slice(0, 2).join('')}</i>
                  )}
                  {(p.subPositions || []).length > 2 && (
                    <u>+{(p.subPositions || []).length - 2}</u>
                  )}
                </button>
                </span>
              </span>
              <select
                className="hand-select" aria-label={t('set.throwShort')} title={t('set.throwShort')}
                value={p.throws || ''} onChange={(e) => dispatch({ type: 'UPDATE_PLAYER', id: p.id, patch: { throws: e.target.value } })}
              >
                <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option>
              </select>
              <select
                className="hand-select" aria-label={t('set.batShort')} title={t('set.batShort')}
                value={p.bats || ''} onChange={(e) => dispatch({ type: 'UPDATE_PLAYER', id: p.id, patch: { bats: e.target.value } })}
              >
                <option value="">—</option><option value="R">{t('hand.R')}</option><option value="L">{t('hand.L')}</option><option value="S">{t('hand.S')}</option>
              </select>
            </div>
            </React.Fragment>
          ))}
          {state.players.filter((p) => !isArchived(p)).length === 0 && <div className="dim small mt8">{t('set.noPlayers')}</div>}
          {gradeBulk && <GradeBulkSheet onClose={() => setGradeBulk(false)} />}
          {manage && <RosterManageSheet onClose={() => setManage(false)} />}
          {posPlayer && (() => {
            const target = state.players.find((x) => x.id === posPlayer);
            return target ? <PositionSheet player={target} onClose={() => setPosPlayer(null)} /> : null;
          })()}
          {/* 誰も守れない位置があると、そもそもスタメンが組めない。名簿の側で先に言う */}
          {holes.length > 0 && (
            <div className="warn-box mt8">{t('pos.uncovered', { list: holes.join('・') })}</div>
          )}
        </div>
      </div>

      <DuplicatePlayersCard />

      <PadHintCard />

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

      <BuildInfoCard />
    </div>
  );
}

// 動いているビルドの識別子。「直したのに反映されない」ときに、
// 端末が新しいビルドを読めているかをその場で確認できるようにする。
function BuildInfoCard() {
  const t = useT();
  const info = typeof __BUILD_INFO__ === 'undefined' ? { sha: 'dev', time: '' } : __BUILD_INFO__;
  const reload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* 失敗しても再読込は試す */ }
    window.location.reload();
  };
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('set.buildTitle')}</div>
      <div className="row">
        <span className="grow small dim">{t('set.buildOf', { sha: info.sha, time: info.time })}</span>
        <button className="small" onClick={reload}>{t('set.buildReload')}</button>
      </div>
      <p className="small dim" style={{ marginBottom: 0 }}>{t('set.buildHint')}</p>
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
  const [orphans, setOrphans] = useState([]); // 削除済みだがIDBに残っている復元候補

  useEffect(() => {
    listOrphanedProfiles().then(setOrphans).catch(() => setOrphans([]));
  }, [profiles.length]);

  const restore = (id) => {
    restoreProfile(id).then(() => {
      switchActiveProfile(id);
      window.location.reload();
    }).catch((e) => window.alert(e?.message || '復元に失敗しました'));
  };

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

      {orphans.length > 0 && (
        <div className="mt12" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="section-title" style={{ marginTop: 0 }}>{t('set.restoreTitle')}</div>
          <p className="small dim" style={{ marginBottom: 8 }}>{t('set.restoreDesc')}</p>
          {orphans.map((o) => (
            <div className="row" key={o.id}>
              <div className="grow">
                <b>{o.name}</b> <span className="pill">{lang === 'en' ? t(`edition.${o.edition}`) : editionLabel(o.edition)}</span>
                <div className="dim small">{t('set.restoreCount', { players: o.players, games: o.games })}</div>
              </div>
              <button className="small primary" onClick={() => restore(o.id)}>{t('set.restore')}</button>
            </div>
          ))}
        </div>
      )}

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
