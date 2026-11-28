import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { oppPitcherLabel, oppPitcherLetters, nextOppPitcherLetter, oppHasName, oppNameOf } from '../lib/oppBox.js';
import Sheet from './Sheet.jsx';

// 相手の投手交代。いちばん多い「控えの投手が出てくる」は大きなボタン1つで済ませる。
//   ・次の投手は自動で「2番手」「3番手」と呼ぶ(名前が分かれば入れられる。あとからでも可)
//   ・相手の打順の選手がマウンドに回ったときだけ、下の一覧から選ぶ
export default function OppPitcherSheet({ game, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [name, setName] = useState('');
  const cur = game.oppPitcherLetter;
  const next = nextOppPitcherLetter(game);
  const nextLabel = oppPitcherLabel({ ...game, oppNames: {} }, next, lang);
  const pitches = (l) => game.oppPitchers?.[l]?.pitches || 0;

  const change = (letter, labelText) => {
    if (!letter || letter === cur) { onClose(); return; }
    if (name.trim() && letter === next) dispatch({ type: 'SET_OPP_NAME', gameId: game.id, letter, name: name.trim() });
    dispatch({ type: 'OPP_SET_PITCHER', gameId: game.id, letter, label: t('opp.pitchLog', { who: labelText }) });
    onClose();
  };

  // 打順の選手(いま投げている投手は除く)
  const lineup = (game.oppLineup || []).filter((s) => s.letter && s.letter !== cur);
  const past = oppPitcherLetters(game).filter((l) => l !== cur);

  return (
    <Sheet title={t('opp.pitchTitle')} onClose={onClose}>
      {cur && (
        <p className="small" style={{ marginTop: 0 }}>
          {t('opp.pitchNow', { who: oppPitcherLabel(game, cur, lang), n: pitches(cur) })}
        </p>
      )}
      {next && (
        <div className="opp-next">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('opp.pitchNamePh', { who: nextLabel })} maxLength={20} />
          <button className="primary big-btn" onClick={() => change(next, name.trim() || nextLabel)}>
            {t('opp.pitchNext', { who: name.trim() || nextLabel })}
          </button>
          <p className="small dim" style={{ margin: '4px 0 0' }}>{t('opp.pitchNextHint')}</p>
        </div>
      )}
      {lineup.length > 0 && (
        <details className="opp-from-lineup mt12">
          <summary className="small">{t('opp.pitchFromLineup')}</summary>
          <div className="opp-lineup-grid">
            {lineup.map((s) => (
              <button key={s.letter} onClick={() => change(s.letter, oppHasName(game, s.letter) ? oppNameOf(game, s.letter) : t('opp.orderN', { n: s.order }))}>
                {t('opp.orderN', { n: s.order })}{oppHasName(game, s.letter) ? ` ${oppNameOf(game, s.letter)}` : ''}
              </button>
            ))}
          </div>
        </details>
      )}
      {past.length > 0 && (
        <p className="small dim mt8">{t('opp.pitchPast', { list: past.map((l) => `${oppPitcherLabel(game, l, lang)}(${pitches(l)}${t('opp.pitchUnit')})`).join('、') })}</p>
      )}
      <div className="sheet-actions"><button onClick={onClose}>{t('action.cancel')}</button></div>
    </Sheet>
  );
}
