import React, { useState, useMemo, useEffect, useRef } from 'react';
import Sheet from './Sheet.jsx';
import { useStore, useT, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, SO_TYPES, outTypeLabel, allowsFoul , infieldFlyPossible, FIELD_POSITIONS, DIR_TO_POSITION, ERROR_KINDS, playErrorOf } from '../lib/model.js';
import { proposeMoves, batterDestOptions, runnerDestOptions, judgeAdvance } from '../lib/plays.js';
import FieldPad from './FieldPad.jsx';
import BattedBallPad from './BattedBallPad.jsx';
import { depthBand, isFoul } from '../lib/battedBall.js';

const NEEDS_DIRECTION = ['single', 'double', 'triple', 'hr', 'out', 'error', 'sacBunt', 'sacFly'];
// 打球の強さ(弱い/平凡/強い)の呼び名を持つのはこの3つだけ
const TRAJECTORY_TYPES = ['ground', 'liner', 'fly'];

// プレイ確定シート: 方向・走者進塁・打点をまとめて確認して1タップ確定
export default function PlaySheet({ game, initial, batterName, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const edition = state.settings.edition;
  // 凡打の種類ボタンの表示: 日本語モードはエディション別呼称(少年野球のゲッツー等)を維持し、
  // 英語モードは辞書(outType.*)を使う。
  const outLabel = (k) => (lang === 'ja' ? outTypeLabel(k, edition) : t(`outType.${k}`));
  // 走者の行き先ラベル(旧 plays.js DEST_LABEL を言語対応で内製)
  const destLabel = (from) => (to) => {
    if (to === 'out') return t('dest.out');
    if (to === 4) return t('dest.score');
    if (to === from) return t('dest.stay');
    return t('dest.toBase', { base: t(`base.${to}`) });
  };
  const result = initial.result;
  const def = RESULTS[result];
  const resultLabel = lang === 'ja' ? def.label : t(`result.${result}`);
  const myBatting = isMyTeamBatting(game);

  const runnersOn = { 1: !!game.runners[1], 2: !!game.runners[2], 3: !!game.runners[3] };
  const [dirTouched, setDirTouched] = useState(false); // 走者を手で動かしたか

  // 併殺打が成立しうるか。打者アウト + 走者アウトで2つ取るので、
  // 既に2アウトなら起こりえない(1つ目のアウトでその回が終わる)。
  // 走者が居ないときも成立しない。
  const dpPossible = result === 'out' && (runnersOn[1] || runnersOn[2] || runnersOn[3]) && game.outs < 2;
  // インフィールドフライは一二塁(満塁を含む)・2アウト未満でしか宣告されない。
  // 場面が成り立たないのに押せると、記録として誤りになる
  const iflyPossible = result === 'out' && infieldFlyPossible(runnersOn, game.outs);

  const [direction, setDirection] = useState(initial.direction || null);
  // 走者の既定は打球方向で変わる(レフト前の二塁走者は三塁、など)。
  // シート内で方向を選び直したときも組み直すが、走者を手で触っていれば尊重する
  const proposal = useMemo(
    () => proposeMoves(result, runnersOn, direction),
    [result, direction],
  );
  // 打点の極座標(角度・深さ)。方向チップだけを押した場合もここに入る
  const [point, setPoint] = useState(
    initial.hitAngle != null ? { angle: initial.hitAngle, depth: initial.hitDepth } : null,
  );
  // 方向未選択時のみ広いフィールド図を開いておく。選択後は折りたたんでスクロールを減らす
  const [dirOpen, setDirOpen] = useState(!initial.direction);
  // 打球方向の図はシートのいちばん上にある。打球の種類や走者を触るために下へ
  // スクロールすると図は画面の外に出るので、確定できない理由だけ読めても
  // どこを押せばいいのか分からない。案内を押したら図まで戻す。
  const dirRef = useRef(null);
  const goToDir = () => {
    setDirOpen(true);
    // 折りたたみが開くのを待ってから位置を合わせる
    requestAnimationFrame(() => {
      dirRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  // 音声や取り込みで併殺が指定されていても、成立しない状況なら併殺では始めない。
  // ボタンが押せないのに併殺のまま固まって、解除できなくなるのを防ぐ
  const [outType, setOutType] = useState(
    (initial.outType === 'dp' && !dpPossible) || (initial.outType === 'ifly' && !iflyPossible)
      ? 'ground'
      : (initial.outType || (result === 'out' ? 'ground' : null)),
  );
  // 打球の強さ。既定は未記録(null)。押されていないものを平凡として
  // 数え始めるとハードヒット率がすぐ嘘になるので、既定値は入れない
  const [contact, setContact] = useState(initial.contact || null);
  const [soType, setSoType] = useState(initial.soType || 'swinging');
  // このプレイに付いた失策。安打かどうかは打球で決まるので result は触らない。
  // 「右翼へのツーベース → 右翼手の送球が逸れて打者走者が三塁へ」は、
  // 記録規則では二塁打1と送球失策1が同時に付く。result は1つしか持てないので別枠。
  const [errKind, setErrKind] = useState(playErrorOf(initial)?.kind || null);
  const [errPos, setErrPos] = useState(playErrorOf(initial)?.pos || null);
  // 敬遠(故意四球)。四球の内訳なので結果は 'bb' のまま
  const [intentional, setIntentional] = useState(!!initial.intentional);
  const [dests, setDests] = useState(() => {
    const d = {};
    for (const b of [1, 2, 3]) {
      if (runnersOn[b]) {
        const mv = proposal.moves.find((m) => m.from === b);
        d[b] = mv ? mv.to : b; // 提案がなければ「そのまま」
      }
    }
    // 併殺打が最初から選ばれている場合(音声認識等)も、フォース走者を既定でアウトにする
    if (initial.outType === 'dp') {
      const forced = [1, 2, 3].find((b) => runnersOn[b]);
      if (forced) d[forced] = 'out';
    }
    return d;
  });
  const [batterTo, setBatterTo] = useState(initial.batterTo ?? proposal.batterTo);

  // 方向を選び直したら走者の既定を組み直す(レフト前↔ライト前で二塁走者が変わる)。
  // ただし走者を手で動かしたあとは、その判断を上書きしない。
  //
  // 実際に起きた不具合: ここの判定が initial.outType(シートを開いたときの値)を
  // 見ていた。シートの中で併殺打を押してから打球方向を押すと、initial は 'dp' では
  // ないので組み直しが走り、せっかく付けた走者のアウトが消えていた。
  // 「ダブルプレーには走者のアウトが必要です」が出て確定できなくなる。
  // いま選ばれている outType を見て、併殺打のあいだは走者のアウトを守る。
  const firstDir = useRef(true);
  useEffect(() => {
    if (firstDir.current) { firstDir.current = false; return; }
    if (dirTouched) return;
    setDests((prev) => {
      const d = {};
      for (const b of [1, 2, 3]) {
        if (!runnersOn[b]) continue;
        const mv = proposal.moves.find((m) => m.from === b);
        d[b] = mv ? mv.to : b;
      }
      if (outType === 'dp') {
        // すでにアウトにしてある走者はそのまま。1人も居なければフォース走者を落とす
        const wereOut = [1, 2, 3].filter((b) => runnersOn[b] && prev[b] === 'out');
        if (wereOut.length) for (const b of wereOut) d[b] = 'out';
        else {
          const forced = [1, 2, 3].find((b) => runnersOn[b]);
          if (forced) d[forced] = 'out';
        }
      }
      return d;
    });
  }, [direction]);
  const [rbiOverride, setRbiOverride] = useState(null);
  const [advOverride, setAdvOverride] = useState(null);
  // 守備時: 自責点の帰属(継投跨ぎ走者) と 非自責フラグ
  const [erChoices, setErChoices] = useState({}); // { base: pitcherId }
  const [unearned, setUnearned] = useState(() => {
    const u = {};
    for (const b of [1, 2, 3]) if (game.runners[b]?.viaError) u[b] = true;
    return u;
  });

  const needsDir = NEEDS_DIRECTION.includes(result);

  // 移動配列(store形式)
  const moves = useMemo(
    () => [1, 2, 3].filter((b) => runnersOn[b] && dests[b] !== b).map((b) => ({ from: b, to: dests[b] })),
    [dests]
  );

  const runs = moves.filter((m) => m.to === 4).length + (batterTo === 4 ? 1 : 0);
  const autoRbi = result === 'error' || outType === 'dp' ? 0 : runs;
  const rbi = rbiOverride ?? autoRbi;

  const hadRunners = runnersOn[1] || runnersOn[2] || runnersOn[3];
  const isAdvTarget = result === 'out' && hadRunners;

  // ---- 外野フライで走者が還ったら、それは犠牲フライ ----
  // 記録規則 9.08(d): 2アウト未満・飛球が捕られ・走者が生還したら犠飛。
  // 犠飛は打数に数えないので、凡打のまま残すと打率の分母が1つ多くなる。
  // 押し間違いではなく規則どおりの記録なので既定で切り替えるが、
  // 何が起きたかは見えるようにして、凡打のままにも戻せるようにしておく。
  const OUTFIELD = ['LF', 'CF', 'RF'];
  const [keepAsOut, setKeepAsOut] = useState(false);
  const sacFlyShape = result === 'out' && outType === 'fly' && OUTFIELD.includes(direction)
    && game.outs < 2 && [1, 2, 3].some((b) => runnersOn[b] && dests[b] === 4);
  const asSacFly = sacFlyShape && !keepAsOut;
  const finalResult = asSacFly ? 'sacFly' : result;
  const autoAdv = judgeAdvance(moves);
  const advSuccess = advOverride ?? autoAdv;

  // 併殺打: 打者アウトに加え走者も1人以上アウトが成立条件。走者が誰もアウトになっていなければ確定不可
  const dpNoRunnerOut = outType === 'dp' && ![1, 2, 3].some((b) => runnersOn[b] && dests[b] === 'out');

  // ---- 状況と矛盾する記録を止める ----
  // 犠打・犠飛は「2アウトになる前」に限られる(公認野球規則 9.08 a / d)。
  // 2アウトでの送りバントや外野フライは記録上ただの凡打で、そのまま残すと
  // 犠打数・犠飛数が水増しされるだけでなく、犠打・犠飛は打数に数えないので
  // 打率の分母まで狂う。
  const isSac = result === 'sacBunt' || result === 'sacFly';
  const sacTwoOuts = isSac && game.outs >= 2;
  const sacNoRunner = isSac && !hadRunners;
  const advanced = (b) => dests[b] === 4 || (typeof dests[b] === 'number' && dests[b] > b);
  // 犠飛は走者が生還してはじめて犠飛。一・二塁の走者が1つずつ進んだだけの
  // 外野フライは犠飛ではない
  const sacFlyNoScore = result === 'sacFly' && !sacTwoOuts && !sacNoRunner
    && ![1, 2, 3].some((b) => runnersOn[b] && dests[b] === 4);
  // 犠打は走者が進んではじめて犠打。誰も進まなければ野選か凡打
  const sacBuntNoAdvance = result === 'sacBunt' && !sacTwoOuts && !sacNoRunner
    && ![1, 2, 3].some((b) => runnersOn[b] && advanced(b));
  // 振り逃げ: 2アウト未満で一塁が埋まっているときは打者は走れない(規則 5.05 a(2))
  const dropThirdIllegal = result === 'so' && batterTo === 1 && runnersOn[1] && game.outs < 2;

  const blockers = [
    [sacTwoOuts, 'playsheet.sacTwoOuts'],
    [sacNoRunner, 'playsheet.sacNoRunner'],
    [sacFlyNoScore, 'playsheet.sacFlyNoScore'],
    [sacBuntNoAdvance, 'playsheet.sacBuntNoAdvance'],
    [dropThirdIllegal, 'playsheet.dropThirdIllegal'],
  ].filter(([on]) => on).map(([, k]) => k);

  // 凡打の種類を選ぶ(併殺打選択時は、強制されるフォース走者(一塁→二塁→三塁の順で先頭)を
  // 自動でアウトに。既に誰かアウトになっていれば上書きしない)
  const selectOutType = (k) => {
    setOutType(k);
    if (k === 'dp') {
      const alreadyOut = [1, 2, 3].some((b) => runnersOn[b] && dests[b] === 'out');
      if (!alreadyOut) {
        const forced = [1, 2, 3].find((b) => runnersOn[b]);
        if (forced) setDests((d) => ({ ...d, [forced]: 'out' }));
      }
    }
  };

  // 衝突チェック: 複数の走者(+打者)が同じ塁に到達していないか
  const collision = useMemo(() => {
    const occupied = [];
    for (const b of [1, 2, 3]) {
      if (runnersOn[b]) {
        const to = dests[b];
        if (to !== 'out' && to !== 4) occupied.push(to);
      }
    }
    if (typeof batterTo === 'number' && batterTo >= 1 && batterTo <= 3) occupied.push(batterTo);
    return new Set(occupied).size !== occupied.length;
  }, [dests, batterTo]);

  const summary = () => {
    const dir = direction ? (lang === 'ja' ? DIRECTIONS[direction] : t(`dir.${direction}`)) : '';
    // 強さまで選んでいれば「大飛球」のような呼び名で返す。選んでいなければ従来どおり
    // 犠飛にするときは「フライ」を重ねない(「中堅フライ 犠牲フライ」になってしまう)
    // 打球の強さの呼び名(ボテボテ・大飛球など)があるのは ゴロ/ライナー/フライ だけ。
    // 併殺打とインフィールドフライは軌道ではなく「そのアウトが何だったか」なので、
    // ここに混ぜるとキー名がそのまま画面に出る(battedBall.ifly.normal と表示されていた)
    const ot = asSacFly ? '' : contact && outType && TRAJECTORY_TYPES.includes(outType)
      ? t(`battedBall.${outType}.${contact}`)
      : result === 'out' && outType ? outLabel(outType) : '';
    const soLabel = lang === 'ja' ? SO_TYPES[soType] : t(`soType.${soType}`);
    const label = result === 'so'
      ? soLabel + (batterTo === 1 ? t('playsheet.dropThird') : '')
      : asSacFly ? (lang === 'ja' ? RESULTS.sacFly.label : t('result.sacFly'))
        : result === 'out' ? '' : (result === 'bb' && intentional) ? t('result.ibb') : resultLabel;
    const runsSuffix = runs ? t('playsheet.runsSuffix', { n: runs }) : '';
    // 失策も確認文に出す。押したのに文に出ないと、入ったのか分からない
    const errSuffix = errKind
      ? t('playsheet.errSuffix', { pos: errPos || DIR_TO_POSITION[direction] || '', kind: t(`errKind.${errKind}`) })
      : '';
    // 日本語は語のあいだに空白を入れない(「投手 フライ でよろしいですか?」になっていた)
    if (lang === 'ja') return `${[dir, ot, label].filter(Boolean).join('')}${errSuffix}${runsSuffix}`;
    // 英語は語順が異なるため、空でない要素を半角スペースで連結
    return `${[dir, ot, label].filter(Boolean).join(' ')}${errSuffix}${runsSuffix}`;
  };

  // 守備時: 生還する走者のうち継投を跨いだ走者(前投手の責任走者)
  const scoringBases = moves.filter((m) => m.to === 4).map((m) => m.from);
  const inheritedScoring = !myBatting
    ? scoringBases.filter((b) => {
        const r = game.runners[b];
        return r?.pitcherId && r.pitcherId !== game.currentPitcherId;
      })
    : [];

  const confirm = () => {
    dispatch({
      type: 'CONFIRM_PLAY',
      gameId: game.id,
      batterName: batterName || '',
      payload: {
        result: finalResult,
        // 軌道はヒットのときも残す(これまで捨てていた)。併殺はアウトのときだけ
        outType: outType === 'dp' && result !== 'out' ? null : outType,
        contact: needsDir ? contact : null,
        hitAngle: needsDir && point ? point.angle : null,
        hitDepth: needsDir && point ? point.depth : null,
        soType: result === 'so' ? soType : undefined,
        playError: errKind ? { pos: errPos || DIR_TO_POSITION[direction] || null, kind: errKind } : null,
        intentional: result === 'bb' ? intentional : undefined,
        direction: needsDir ? direction : null,
        moves,
        batterTo,
        rbi: rbiOverride !== null ? rbiOverride : undefined,
        advSuccess: isAdvTarget ? advSuccess : undefined,
        erChoices,
        unearnedRuns: unearned,
      },
    });
    onClose();
  };

  const runnerName = (b) => {
    const r = game.runners[b];
    return r?.playerId ? nameOf(r.playerId) : t('runner.onBase', { base: t(`base.${b}`) });
  };

  return (
    <Sheet title={`${batterName ? batterName + ': ' : t('playsheet.oppBatter')}${resultLabel}`} onClose={onClose}>
      {needsDir && (
        <div ref={dirRef}>
          <div className="section-title" style={{ marginTop: 0 }}>{t('playsheet.direction')}</div>
          {dirOpen ? (
            <FieldPad
              value={direction}
              point={point}
              outfieldOnly={result === 'hr'}
              allowFoul={allowsFoul(result)}
              onChange={(key, pt) => { setDirection(key); setPoint(pt); }}
              onDone={() => setDirOpen(false)}
              gameId={game.id}
            />
          ) : (
            <button type="button" className="dir-summary" onClick={() => setDirOpen(true)}>
              <span className="dir-label">
                {lang === 'ja' ? DIRECTIONS[direction] : t(`dir.${direction}`)}
                {point && isFoul(point.angle) && <span className="depth-pill foul">{t('dir.foul')}</span>}
                {point && <span className="depth-pill">{t(`depth.${depthBand(point.depth)}`)}</span>}
              </span>
              <span className="change">{t('playsheet.change')}</span>
            </button>
          )}
        </div>
      )}

      {result === 'so' && (
        <>
          <div className="section-title">{t('playsheet.soType')}</div>
          <div className="grid2">
            {Object.keys(SO_TYPES).map((k) => (
              <button key={k} className={soType === k ? 'primary' : ''} onClick={() => setSoType(k)}>
                {lang === 'ja' ? SO_TYPES[k] : t(`soType.${k}`)}
              </button>
            ))}
          </div>
        </>
      )}

      {result === 'bb' && (
        <>
          <div className="section-title" style={needsDir ? undefined : { marginTop: 0 }}>{t('playsheet.bbType')}</div>
          <div className="grid2">
            <button className={intentional ? '' : 'primary'} onClick={() => setIntentional(false)}>
              {t('bbType.normal')}
            </button>
            <button className={intentional ? 'primary' : ''} onClick={() => setIntentional(true)}>
              {t('bbType.intentional')}
            </button>
          </div>
          <p className="small dim mt8">{t('playsheet.bbTypeNote')}</p>
        </>
      )}

      {needsDir && (
        <>
          <div className="section-title">{t('playsheet.battedBall')}</div>
          <BattedBallPad
            trajectory={outType === 'dp' || outType === 'ifly' ? null : outType}
            contact={contact}
            depth={point ? point.depth : null}
            onChange={(tr, c) => { setOutType(tr); setContact(c); }}
            dp={outType === 'dp'}
            onDp={() => (outType === 'dp' ? setOutType('ground') : selectOutType('dp'))}
            dpDisabled={!dpPossible}
            ifly={outType === 'ifly'}
            onIfly={() => (outType === 'ifly' ? setOutType('fly') : selectOutType('ifly'))}
            iflyDisabled={!iflyPossible}
          />
        </>
      )}

      {(hadRunners || def.onBase || batterDestOptions(result).length > 1) && (
        <div className="section-title">{t('playsheet.runnerMovement')}</div>
      )}

      {[3, 2, 1].map(
        (b) =>
          runnersOn[b] && (
            <div className="runner-move" key={b}>
              <span className="who">{t(`base.${b}`)}: {runnerName(b)}</span>
              <div className="dests">
                {runnerDestOptions(b).map((to) => (
                  <button
                    key={String(to)}
                    className={dests[b] === to ? `sel${to === 'out' ? ' out' : ''}` : ''}
                    onClick={() => { setDirTouched(true); setDests({ ...dests, [b]: to }); }}
                  >
                    {destLabel(b)(to)}
                  </button>
                ))}
              </div>
            </div>
          )
      )}

      {batterDestOptions(result).length > 0 && (
        <div className="runner-move">
          <span className="who">{t('playsheet.batter')}{batterName ? `: ${batterName}` : ''}</span>
          <div className="dests">
            {batterDestOptions(result).map((to) => (
              <button
                key={String(to)}
                className={batterTo === to ? `sel${to === 'out' ? ' out' : ''}` : ''}
                onClick={() => setBatterTo(to)}
              >
                {to === 'out' ? t('dest.out') : to === 4 ? t('dest.score')
                  : result === 'so' && to === 1 ? t('playsheet.soToFirst')
                    : t('dest.toBase', { base: t(`base.${to}`) })}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* このプレイに付いた失策。
          安打かどうかは打球で決まり、そのあと守備が乱れて余分に進んだぶんは失策になる。
          result は1つしか持てないので「安打か失策か」の二択になっていた。
          出塁そのものが失策のとき(result='error')は、そちらで記録済みなので出さない */}
      {needsDir && result !== 'error' && (
        <div className="play-error mt12">
          <div className="flex">
            <span className="small dim grow">{t('playsheet.playError')}</span>
            <div className="toggle-row" style={{ width: 190, marginBottom: 0 }}>
              <button className={!errKind ? 'active' : ''} onClick={() => setErrKind(null)}>
                {t('playsheet.errNone')}
              </button>
              {ERROR_KINDS.map((k) => (
                <button
                  key={k}
                  className={errKind === k ? 'active' : ''}
                  onClick={() => {
                    setErrKind(k);
                    // 打った方向の野手が捕って投げるのが普通。そこを初期値にする
                    if (!errPos) setErrPos(DIR_TO_POSITION[direction] || null);
                  }}
                >
                  {t(`errKind.${k}`)}
                </button>
              ))}
            </div>
          </div>
          {errKind && (
            <>
              <div className="pe-pos mt8">
                {FIELD_POSITIONS.map((p) => (
                  <button
                    key={p}
                    className={errPos === p ? 'primary' : ''}
                    onClick={() => setErrPos(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="small dim mt8">{t('playsheet.playErrorNote')}</p>
            </>
          )}
        </div>
      )}

      {myBatting && (
        <div className="flex mt12">
          <span className="small dim">{t('playsheet.rbi')}</span>
          <div className="stepper">
            <button onClick={() => setRbiOverride(Math.max(0, rbi - 1))}>−</button>
            <span className="val">{rbi}</span>
            <button onClick={() => setRbiOverride(Math.min(4, rbi + 1))}>＋</button>
          </div>
          {rbiOverride !== null && rbiOverride !== autoRbi && <span className="pill amber">{t('playsheet.manual')}</span>}
        </div>
      )}

      {isAdvTarget && myBatting && (
        <div className="flex mt12">
          <span className="small dim">{t('playsheet.advHit')}</span>
          <button className={`small ${advSuccess ? 'primary' : ''}`} onClick={() => setAdvOverride(!advSuccess)}>
            {advSuccess ? t('playsheet.advYes') : t('playsheet.advNo')}
          </button>
          {advOverride === null && <span className="pill">{t('playsheet.autoJudge')}</span>}
        </div>
      )}

      {!myBatting && scoringBases.length > 0 && (
        <>
          <div className="section-title">{t('playsheet.runsRecord')}</div>
          {scoringBases.map((b) => {
            const r = game.runners[b];
            const prevPid = r?.pitcherId;
            const isInherited = inheritedScoring.includes(b);
            const chosen = erChoices[b] || prevPid || game.currentPitcherId;
            return (
              <div key={b} className="card" style={{ padding: 10, marginBottom: 8 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  {t('playsheet.runnerScored', { base: t(`base.${b}`) })}
                  {isInherited && <span className="pill amber" style={{ marginLeft: 6 }}>{t('playsheet.inherited')}</span>}
                </div>
                {isInherited && (
                  <div className="grid2" style={{ marginBottom: 6 }}>
                    <button
                      className={`small ${chosen === prevPid ? 'primary' : ''}`}
                      onClick={() => setErChoices({ ...erChoices, [b]: prevPid })}
                    >
                      {t('playsheet.prevPitcher', { name: nameOf(prevPid) })}
                    </button>
                    <button
                      className={`small ${chosen === game.currentPitcherId ? 'primary' : ''}`}
                      onClick={() => setErChoices({ ...erChoices, [b]: game.currentPitcherId })}
                    >
                      {t('playsheet.currPitcher', { name: nameOf(game.currentPitcherId) })}
                    </button>
                  </div>
                )}
                <button
                  className={`small ${unearned[b] ? 'danger' : 'ghost'}`}
                  onClick={() => setUnearned({ ...unearned, [b]: !unearned[b] })}
                >
                  {unearned[b] ? t('playsheet.unearnedYes') : t('playsheet.unearnedNo')}
                </button>
              </div>
            );
          })}
        </>
      )}

      {sacFlyShape && (
        <div className="card mt12" style={{ padding: 12 }}>
          <div className="small">{asSacFly ? t('playsheet.sacFlyAuto') : t('playsheet.sacFlyKept')}</div>
          <button className="small ghost mt8" style={{ width: '100%' }} onClick={() => setKeepAsOut(!keepAsOut)}>
            {asSacFly ? t('playsheet.sacFlyToOut') : t('playsheet.sacFlyToSac')}
          </button>
        </div>
      )}

      {collision && <div className="warn-box mt12">{t('playsheet.collision')}</div>}
      {dpNoRunnerOut && <div className="warn-box mt12">{t('playsheet.dpNoOut')}</div>}
      {blockers.map((k) => <div key={k} className="warn-box mt12">{t(k)}</div>)}

      {/* 押せない理由を書かずに問いだけ出すと、確定が灰色のまま理由が分からない。
          打球方向は凡打・安打では必須なので、そこを名指しで言う */}
      <div className="confirm-card mt16" style={{ marginBottom: 0, padding: 12 }}>
        {needsDir && !direction ? (
          <button type="button" className="need-dir" onClick={goToDir}>
            <span>{t('playsheet.needDirection')}</span>
            <span className="need-dir-go">{t('playsheet.goToField')}</span>
          </button>
        ) : (
          <div className="q" style={{ fontSize: 16, marginBottom: 0 }}>
            {t('playsheet.confirmQ', { summary: summary() })}
          </div>
        )}
      </div>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={confirm} disabled={(needsDir && !direction) || collision || dpNoRunnerOut || blockers.length > 0}>
          {t('action.confirm')}
        </button>
      </div>
    </Sheet>
  );
}
