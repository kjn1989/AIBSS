import React, { useState, useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { oppBattingByLetter, oppPitchingStats, oppHasName } from '../lib/oppBox.js';
import { lastOppRoster } from '../lib/matchup.js';
import { formatIP } from '../lib/model.js';

// ============================================================
// 相手選手名の聞き出し
//
// 相手選手名は任意入力なので、入れないと対戦成績は何も出ない。
// けれど試合前に9人ぶん入力させるのは無理がある。
//
// そこで、試合が終わった直後・成績が目の前にある場所で聞く。
// 「Bは3打数3安打でした。名前を入れますか?」——数字が見えている状態なら
// 誰のことか思い出せるし、入力の動機も最大化する。
//
// 名前は後から入れても過去の試合に遡って繋がるので、ここで入れた1件が
// そのまま通算の対戦成績になる。
// ============================================================
export default function OppNamePrompt({ game }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState({});
  const [done, setDone] = useState(false);

  const rows = useMemo(() => {
    const bat = oppBattingByLetter(game);
    const pit = new Map(oppPitchingStats(game).map((p) => [p.letter, p]));
    const out = [];
    // 打席か登板の記録がある記号だけを聞く(出ていない記号まで並べても埋まらない)
    const letters = new Set([...bat.keys(), ...pit.keys()]);
    for (const letter of letters) {
      if (oppHasName(game, letter)) continue;
      const b = bat.get(letter);
      const p = pit.get(letter);
      const order = (game.oppLineup || []).find((l) => l.letter === letter)?.order ?? null;
      out.push({ letter, order, bat: b, pit: p });
    }
    return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.letter.localeCompare(b.letter));
  }, [game]);

  // 同じ相手と過去に対戦していれば、そのときの名前を候補に出す
  const known = useMemo(() => {
    const r = lastOppRoster(
      Object.values(state.games).filter((g) => g.id !== game.id),
      game.opponent,
    );
    return r ? [...new Set(Object.values(r.oppNames || {}))] : [];
  }, [state.games, game.id, game.opponent]);

  if (!rows.length || done) return null;

  const line = (r) => {
    const parts = [];
    if (r.bat) {
      parts.push(t('oppname.batLine', { ab: r.bat.ab, h: r.bat.h }));
      if (r.bat.hr) parts.push(t('oppname.hr', { n: r.bat.hr }));
    }
    if (r.pit) parts.push(t('oppname.pitLine', { ip: formatIP(r.pit.outs), k: r.pit.k }));
    return parts.join(' ・ ');
  };

  const save = () => {
    let n = 0;
    for (const [letter, name] of Object.entries(draft)) {
      const v = (name || '').trim();
      if (!v) continue;
      dispatch({ type: 'SET_OPP_NAME', gameId: game.id, letter, name: v });
      n += 1;
    }
    if (n) setDone(true);
  };

  const filled = Object.values(draft).filter((v) => (v || '').trim()).length;

  return (
    <div className="card oppname-card">
      <div className="oppname-head" role="button" onClick={() => setOpen((v) => !v)}>
        <b>{t('oppname.title', { n: rows.length })}</b>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      <p className="small dim" style={{ margin: '2px 0 0' }}>{t('oppname.why')}</p>

      {open && (
        <>
          {known.length > 0 && (
            <p className="small dim" style={{ marginTop: 8 }}>
              {t('oppname.known')}
              {known.slice(0, 8).map((nm) => (
                <button
                  key={nm}
                  className="small ghost"
                  style={{ marginLeft: 5 }}
                  onClick={() => {
                    // まだ埋まっていない最初の欄に入れる
                    const target = rows.find((r) => !(draft[r.letter] || '').trim());
                    if (target) setDraft((d) => ({ ...d, [target.letter]: nm }));
                  }}
                >
                  {nm}
                </button>
              ))}
            </p>
          )}
          <div className="mt8">
            {rows.map((r) => (
              <div className="oppname-row" key={r.letter}>
                <span className="oppname-tag">{r.order ? `${r.order}番` : ''}{r.letter}</span>
                <span className="oppname-stat">{line(r)}</span>
                <input
                  value={draft[r.letter] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.letter]: e.target.value }))}
                  placeholder={t('oppname.placeholder')}
                />
              </div>
            ))}
          </div>
          <div className="flex mt12">
            <button className="primary grow" disabled={!filled} onClick={save}>
              {t('oppname.save', { n: filled })}
            </button>
            <button className="grow" onClick={() => setDone(true)}>{t('oppname.skip')}</button>
          </div>
          <p className="foot-note">{t('oppname.laterNote')}</p>
        </>
      )}
    </div>
  );
}
