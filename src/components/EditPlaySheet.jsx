import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, SO_TYPES, outTypeLabel, allowsFoul, infieldFlyPossible } from '../lib/model.js';
import { depthBand, isFoul } from '../lib/battedBall.js';
import FieldPad from './FieldPad.jsx';
import BattedBallPad from './BattedBallPad.jsx';
import Sheet from './Sheet.jsx';

// ---- 過去プレイの事後編集シート ----
// 結果種別・方向・打点を後から修正/削除できる(成績は自動で再計算)。
// スコア・走者・投手成績はここでは変えず、必要なら手動修正機能を案内する。
// draft を渡すと「まだ存在しない打席」を作るシートになる。
// 保存するまで何も書き込まないので、閉じれば無かったことになる。
export default function EditPlaySheet({ game, log, draft, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const isNew = !!draft;
  const p = isNew
    ? { result: 'single', playerId: draft.playerId, order: draft.order, direction: null }
    : (log.payload || {});
  const [result, setResult] = useState(p.result);
  const [direction, setDirection] = useState(p.direction || null);
  const [outType, setOutType] = useState(p.outType || 'ground');
  const [soType, setSoType] = useState(p.soType || 'swinging');
  const [intentional, setIntentional] = useState(!!p.intentional);
  // 打点(角度・深さ)と強さ。入力できるものは直せなければならない。
  // とくに方向だけ直して打点が古いままだと、分布図が直した方向と食い違う
  const [point, setPoint] = useState(
    p.hitAngle != null ? { angle: p.hitAngle, depth: p.hitDepth } : null,
  );
  const [contact, setContact] = useState(p.contact || null);
  // 直しに来た時点では方向は入っているので畳んでおく(シートを短くする)
  const [dirOpen, setDirOpen] = useState(!p.direction);
  const [rbi, setRbi] = useState(p.rbi ?? null);
  const isAtBat = isNew || log.kind === 'atbat';
  const [playerId, setPlayerId] = useState(p.playerId || null);

  const save = () => {
    if (isNew) {
      dispatch({
        type: 'ADD_RETRO_ATBAT', gameId: game.id,
        inning: draft.inning, playerId, order: draft.order,
        result, direction, outType, soType, intentional, contact, rbi: rbi || 0,
        hitAngle: point ? point.angle : null,
        hitDepth: point ? point.depth : null,
      });
      onClose();
      return;
    }
    // 打者の付け替え(リエントリー対応)は結果編集より先に反映する
    if (isAtBat && playerId && playerId !== p.playerId) {
      dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: log.id, newPlayerId: playerId });
    }
    dispatch({
      type: 'EDIT_PLAY_LOG',
      gameId: game.id,
      logId: log.id,
      patch: {
        result, direction, outType, soType, intentional, contact,
        hitAngle: point ? point.angle : null,
        hitDepth: point ? point.depth : null,
        ...(isAtBat && rbi !== null ? { rbi } : {}),
      },
    });
    onClose();
  };

  const remove = () => {
    if (!window.confirm(t('gp.deleteConfirm'))) return;
    dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: log.id });
    onClose();
  };

  return (
    <Sheet
      title={isNew
        ? t('ss.addTitle', { inning: draft.inning })
        : t('gp.editTitle', { inning: log.inning, half: t(log.isTop ? 'half.top' : 'half.bottom') })}
      onClose={onClose}
    >
      {isAtBat && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{t('gp.reassignBatter')}</div>
          <select className="small" style={{ width: '100%' }} value={playerId || ''} onChange={(e) => setPlayerId(e.target.value)}>
            {state.players.map((pl) => (
              <option key={pl.id} value={pl.id}>{pl.name}{pl.number ? ` #${pl.number}` : ''}</option>
            ))}
          </select>
        </>
      )}
      <div className="section-title" style={isAtBat ? undefined : { marginTop: 0 }}>{t('gp.result')}</div>
      <div className="grid3">
        {Object.entries(RESULTS).map(([k, def]) => (
          <button
            key={k}
            className={`small ${result === k ? 'primary' : ''}`}
            onClick={() => {
              setResult(k);
              // ファウルの安打は無い。ファウルフライを安打に直したら打点は外す
              // (残すと「ファウルゾーンに落ちたヒット」という記録ができてしまう)
              if (!allowsFoul(k) && point && isFoul(point.angle)) setPoint(null);
            }}
          >
            {lang === 'ja' ? def.label : t(`result.${k}`)}
          </button>
        ))}
      </div>

      {/* 入力と同じパッドで直す。方向だけ直して打点が古いまま残ると、
          分布図が直した方向と食い違ってしまう */}
      <div className="section-title">{t('gp.direction')}</div>
      {dirOpen ? (
        <FieldPad
          value={direction}
          point={point}
          gameId={game.id}
          allowFoul={allowsFoul(result)}
          onChange={(key, pt) => { setDirection(key); setPoint(pt); }}
          onDone={() => setDirOpen(false)}
        />
      ) : (
        <button type="button" className="dir-summary" onClick={() => setDirOpen(true)}>
          <span className="dir-label">
            {direction ? (lang === 'ja' ? DIRECTIONS[direction] : t(`dir.${direction}`)) : t('playsheet.notTapped')}
            {point && isFoul(point.angle) && <span className="depth-pill foul">{t('dir.foul')}</span>}
            {point && <span className="depth-pill">{t(`depth.${depthBand(point.depth)}`)}</span>}
          </span>
          <span className="change">{t('playsheet.change')}</span>
        </button>
      )}

      <div className="section-title">{t('playsheet.battedBall')}</div>
      {/* 併殺は、その打席が始まった時点で2アウト未満のときだけ。
          既に2アウトなら1つ目のアウトでその回が終わるので起こりえない。
          古いログには outsBefore が無いので、その場合は従来どおり許す。
          インフィールドフライは一二塁(満塁を含む)・2アウト未満のときだけ */}
      <BattedBallPad
        trajectory={outType === 'dp' || outType === 'ifly' ? null : outType}
        contact={contact}
        depth={point ? point.depth : null}
        onChange={(tr, c) => { setOutType(tr); setContact(c); }}
        dp={outType === 'dp'}
        onDp={() => setOutType(outType === 'dp' ? 'ground' : 'dp')}
        dpDisabled={result !== 'out' || (p.outsBefore ?? 0) >= 2}
        ifly={outType === 'ifly'}
        onIfly={() => setOutType(outType === 'ifly' ? 'fly' : 'ifly')}
        iflyDisabled={result !== 'out' || !infieldFlyPossible(p.beforeRunners, p.outsBefore ?? 0)}
      />
      {result === 'so' && (
        <>
          <div className="section-title">{t('playsheet.soType')}</div>
          <div className="grid2">
            {Object.keys(SO_TYPES).map((k) => (
              <button key={k} className={`small ${soType === k ? 'primary' : ''}`} onClick={() => setSoType(k)}>{lang === 'ja' ? SO_TYPES[k] : t(`soType.${k}`)}</button>
            ))}
          </div>
        </>
      )}
      {result === 'bb' && (
        <>
          <div className="section-title">{t('playsheet.bbType')}</div>
          <div className="grid2">
            <button className={`small ${intentional ? '' : 'primary'}`} onClick={() => setIntentional(false)}>
              {t('bbType.normal')}
            </button>
            <button className={`small ${intentional ? 'primary' : ''}`} onClick={() => setIntentional(true)}>
              {t('bbType.intentional')}
            </button>
          </div>
        </>
      )}

      {isAtBat && (
        <div className="flex mt12">
          <span className="small dim grow">{t('playsheet.rbi')}</span>
          <div className="stepper">
            <button onClick={() => setRbi(Math.max(0, (rbi ?? p.rbi ?? 0) - 1))}>−</button>
            <span className="val">{rbi ?? p.rbi ?? 0}</span>
            <button onClick={() => setRbi(Math.min(4, (rbi ?? p.rbi ?? 0) + 1))}>＋</button>
          </div>
        </div>
      )}

      <div className="warn-box mt12">
        {isNew ? t('ss.addWarn') : t('gp.editWarn')}
      </div>

      {!isNew && <button className="ghost danger mt8" style={{ width: '100%' }} onClick={remove}>{t('gp.deletePlay')}</button>}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}
