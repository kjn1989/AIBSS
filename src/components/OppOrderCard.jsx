import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { POSITIONS, positionLabel, OPP_LETTERS } from '../lib/model.js';
import { oppNameOf, oppPositionOf, oppHasName } from '../lib/oppBox.js';
import Sheet from './Sheet.jsx';

// 相手チームのオーダー(記号A〜Tで管理)。名前と守備位置は任意で入れられる。
// 自軍のオーダーと同じ並び(打順・名前・守備位置・交代)にして、迷わず使えるようにする。
const FIELD_POSITIONS = POSITIONS.filter((p) => p !== '打' && p !== '控');

export default function OppOrderCard({ game, onSubstitute }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [editing, setEditing] = useState(null); // 名前を編集中の記号
  const lineup = [...(game.oppLineup || [])].sort((a, b) => a.order - b.order);

  return (
    <div className="card">
      <div className="flex" style={{ marginBottom: 8 }}>
        <h2 className="grow" style={{ marginBottom: 0 }}>{game.opponent || t('restab.opponentFallback')}</h2>
      </div>
      <p className="small dim" style={{ marginTop: 0 }}>{t('order.oppHint')}</p>
      {lineup.map((slot, i) => (
        <div className="row" key={slot.order}>
          <span className="rank-badge">{slot.order}</span>
          <button className="grow opp-row-name" onClick={() => setEditing(slot.letter)}>
            <b>{oppNameOf(game, slot.letter)}</b>
            {oppHasName(game, slot.letter) && <span className="dim small"> {slot.letter}</span>}
            <span className="dim small" aria-hidden> ✎</span>
            {i === game.oppBatterIndex && <span className="pill blue" style={{ marginLeft: 6 }}>{t('order.nextBatter')}</span>}
            {game.oppPitcherLetter === slot.letter && <span className="pill amber" style={{ marginLeft: 6 }}>{t('box.oppPitcher')}</span>}
          </button>
          <select
            className="small"
            style={{ width: 78 }}
            aria-label={t('order.oppPosAria', { order: slot.order })}
            value={oppPositionOf(game, slot.letter) || ''}
            onChange={(e) => dispatch({ type: 'SET_OPP_POSITION', gameId: game.id, letter: slot.letter, position: e.target.value })}
          >
            <option value="">—</option>
            {FIELD_POSITIONS.map((pos) => (
              <option key={pos} value={pos}>{positionLabel(pos, lang)}</option>
            ))}
          </select>
          <button className="small" onClick={() => onSubstitute(slot)}>{t('order.change')}</button>
        </div>
      ))}
      {editing && <OppNameSheet game={game} letter={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// 相手選手の名前を書き換えるシート。開いたらすぐ入力でき、Enter か「保存」で閉じる。
export function OppNameSheet({ game, letter, onClose }) {
  const { dispatch } = useStore();
  const t = useT();
  const [name, setName] = useState((game.oppNames || {})[letter] || '');
  const save = () => {
    dispatch({ type: 'SET_OPP_NAME', gameId: game.id, letter, name });
    onClose();
  };
  return (
    <Sheet title={t('box.oppNameTitle', { letter })} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('box.oppNameHint')}</p>
      <input
        autoFocus
        value={name}
        placeholder={t('box.oppNamePlaceholder', { letter })}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        style={{ width: '100%' }}
        aria-label={t('box.oppNameTitle', { letter })}
      />
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// ---- 相手選手交代シート(代打・代走・守備交代。実名の代わりにA〜Tの記号を使う) ----
export function OppSubstituteSheet({ game, slot, onClose, initialKind = 'ph' }) {
  const { dispatch } = useStore();
  const t = useT();
  const [kind, setKind] = useState(initialKind); // ph=代打 pr=代走 def=守備交代
  const [letter, setLetter] = useState('');

  const inLineup = new Set(game.oppLineup.map((l) => l.letter));
  const candidates = OPP_LETTERS.filter((l) => !inLineup.has(l));
  // リエントリーを認めている試合では、再出場は正常なので警告しない
  const isRetired = letter && game.oppRetiredLetters.includes(letter) && !game.allowReentry;
  const kindLabel = t(`order.sub.${kind}`);

  const runnerBase = [1, 2, 3].find((b) => game.runners[b]?.letter === slot.letter);

  return (
    <Sheet title={t('score.oppSubTitle', { order: slot.order, letter: slot.letter })} onClose={onClose}>
      <div className="grid3">
        {['ph', 'pr', 'def'].map((k) => (
          <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {t(`order.sub.${k}`)}
          </button>
        ))}
      </div>

      {kind === 'pr' && !runnerBase && (
        <div className="warn-box mt8">{t('order.sub.prNoRunner')}</div>
      )}

      <div className="section-title">{t('order.sub.playerIn')}</div>
      <select value={letter} onChange={(e) => setLetter(e.target.value)}>
        <option value="">{t('score.selectLetter')}</option>
        {candidates.map((l) => (
          <option key={l} value={l}>
            {oppHasName(game, l) ? `${oppNameOf(game, l)} (${l})` : l}
            {game.oppRetiredLetters.includes(l) ? t('order.sub.usedMark') : ''}
          </option>
        ))}
      </select>

      {isRetired && (
        <div className="warn-box">
          {t('order.sub.retiredWarn', { name: letter })}
        </div>
      )}

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button
          className="primary"
          disabled={!letter}
          onClick={() => {
            dispatch({
              type: 'OPP_SUBSTITUTE',
              gameId: game.id,
              order: slot.order,
              letter,
              asRunner: kind === 'pr',
              label: t('score.oppSubLog', { kind: kindLabel, letter, order: slot.order, outLetter: slot.letter }),
            });
            onClose();
          }}
        >
          {t('order.sub.enter', { kind: kindLabel })}
        </button>
      </div>
    </Sheet>
  );
}
