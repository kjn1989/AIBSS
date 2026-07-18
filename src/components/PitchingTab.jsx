import React, { useState } from 'react';
import { useStore, usePlayerName, isMyTeamBatting, useT } from '../state/store.jsx';
import { formatIP } from '../lib/model.js';

// 1登板レコードの編集カード
function RecordCard({ game, pr }) {
  const { dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [detail, setDetail] = useState(false);

  const adjust = (patch) => dispatch({ type: 'ADJUST_PITCHING', gameId: game.id, recordId: pr.id, patch });
  const step = (field, delta, min = 0) => adjust({ [field]: Math.max(min, (pr[field] || 0) + delta) });

  return (
    <div className="card">
      <div className="flex">
        <span className="rank-badge">{pr.appearanceOrder}</span>
        <b className="grow" style={{ fontSize: 16 }}>
          {nameOf(pr.playerId)}
          {game.currentPitcherId === pr.playerId && <span className="pill green" style={{ marginLeft: 6 }}>{t('pt.active')}</span>}
        </b>
        <button
          className={`small ${pr.win ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'win', value: !pr.win, exclusive: true })}
        >
          {t('pt.win')}
        </button>
        <button
          className={`small ${pr.save ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'save', value: !pr.save, exclusive: true })}
        >
          {t('pt.save')}
        </button>
        <button
          className={`small ${pr.hold ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'hold', value: !pr.hold, exclusive: false })}
        >
          {t('pt.hold')}
        </button>
      </div>

      <div className="grid3 mt12 center small">
        <div><div className="dim">{t('pt.ip')}</div><b style={{ fontSize: 18 }}>{formatIP(pr.outsRecorded)}</b></div>
        <div><div className="dim">{t('pt.runs')}</div><b style={{ fontSize: 18 }}>{pr.runs}</b></div>
        <div><div className="dim">{t('pt.er')}</div><b style={{ fontSize: 18 }}>{pr.earnedRuns}</b></div>
        <div><div className="dim">{t('pt.hits')}</div><b>{pr.hitsAllowed}</b></div>
        <div><div className="dim">{t('pt.bbhbp')}</div><b>{pr.walks + pr.hitByPitch}</b></div>
        <div><div className="dim">{t('pt.k')}</div><b>{pr.strikeouts}</b></div>
      </div>
      <div className="center small dim mt8">{t('pt.pitches', { n: pr.pitches })}</div>
      {pr.pitchesByInning && Object.keys(pr.pitchesByInning).length > 0 && (
        <div className="pitch-innings" style={{ justifyContent: 'center' }}>
          <span className="pi-title">{t('score.byInning')}</span>
          {Object.entries(pr.pitchesByInning)
            .map(([inn, n]) => [Number(inn), n])
            .filter(([, n]) => n > 0)
            .sort((a, b) => a[0] - b[0])
            .map(([inn, n]) => (
              <span className="pi-chip" key={inn}>{t('score.inningN', { n: inn })}<b>{n}</b></span>
            ))}
        </div>
      )}

      <div className="flex mt12">
        <span className="small dim grow">{t('pt.erAdjust')}</span>
        <div className="stepper">
          <button onClick={() => step('earnedRuns', -1)}>−</button>
          <span className="val">{pr.earnedRuns}</span>
          <button onClick={() => step('earnedRuns', +1)}>＋</button>
        </div>
      </div>

      <button className="ghost small mt8" onClick={() => setDetail(!detail)}>
        {detail ? t('pt.detailClose') : t('pt.detailOpen')}
      </button>
      {detail && (
        <div className="mt8">
          {[
            ['outsRecorded', t('pt.f.outs'), (v) => formatIP(v)],
            ['runs', t('pt.f.runs'), String],
            ['hitsAllowed', t('pt.f.hits'), String],
            ['abFaced', t('pt.f.ab'), String],
            ['walks', t('pt.f.bb'), String],
            ['hitByPitch', t('pt.f.hbp'), String],
            ['strikeouts', t('pt.f.k'), String],
            ['pitches', t('pt.f.pitches'), String],
          ].map(([field, label, fmt]) => (
            <div className="flex mt8" key={field}>
              <span className="small dim grow">{label}</span>
              <div className="stepper">
                <button onClick={() => step(field, -1)}>−</button>
                <span className="val">{fmt(pr[field] || 0)}</span>
                <button onClick={() => step(field, +1)}>＋</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 進行中の試合の登板・継投管理(成績タブに埋め込んで使う)
export function PitchingGameManagement({ game }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [nextPitcher, setNextPitcher] = useState('');

  const records = [...game.pitchingRecords].sort((a, b) => a.appearanceOrder - b.appearanceOrder);

  return (
    <div>
      <div className="card">
        <h2>{t('pt.title', { date: game.date, opp: game.opponent || t('restab.opponentFallback') })}</h2>
        <div className="flex">
          <select className="grow" value={nextPitcher} onChange={(e) => setNextPitcher(e.target.value)}>
            <option value="">{t('score.selectPitcher')}</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!nextPitcher || nextPitcher === game.currentPitcherId}
            onClick={() => {
              dispatch({
                type: 'SET_PITCHER', gameId: game.id, playerId: nextPitcher,
                label: game.currentPitcherId
                  ? t('pt.relievedLog', { name: nameOf(nextPitcher), prev: nameOf(game.currentPitcherId) })
                  : t('pt.starterLog', { name: nameOf(nextPitcher) }),
              });
              setNextPitcher('');
            }}
          >
            {game.currentPitcherId ? t('pt.relieve') : t('pt.startPitch')}
          </button>
        </div>
        {game.currentPitcherId && (
          <p className="small dim mt8">{t('pt.currentPitcher')}<b>{nameOf(game.currentPitcherId)}</b></p>
        )}
        {[1, 2, 3].some((b) => game.runners[b]) && !isMyTeamBatting(game) && (
          <div className="warn-box">
            {t('pt.inheritedWarn')}
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <div className="big-note">{t('pt.noRecordsA')}<br />{t('pt.noRecordsB')}</div>
      ) : (
        records.map((pr) => <RecordCard key={pr.id} game={game} pr={pr} />)
      )}
    </div>
  );
}
