import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { generateScoutReport } from '../lib/gemini.js';
import { buildStatsSummary } from '../lib/stats.js';
import FullscreenView from './FullscreenView.jsx';

// ---- プリセット特殊能力タグ ----
//
// タグは「保存されるデータ」で、選手に { label, type } で載る。
// ここを単純に訳すと、日本語で付けたタグを英語表示にしたとき、保存済みの
// ラベル(日本語)と候補ボタンのラベル(英語)が別物になり、同じタグを二重に
// 付けられてしまう。そこでプリセットには**言語に依らないid**を持たせ、
// 表示だけ id から引く。保存する側にも id を載せる。
//
// id を持たない古いデータ(と自由入力タグ)は、保存されているラベルをそのまま出す。
// ただし日本語のプリセット名で保存されたものは JA_LABEL_TO_ID で逆引きできるので、
// 過去の記録も英語で読める。**データは書き換えない**(書き換えると、同期で
// 古い端末と新しい端末のあいだで往復して壊れる)。
// type: 'plus'(長所) / 'minus'(短所) / 'joke'(個性・チーム貢献)
const TAG_GROUPS = [
  {
    categoryKey: 'sc.catBatting',
    type: 'plus',
    ids: [
      'contact', 'power', 'allFields', 'oppoField', 'multiHit', 'grinder',
      'clutch', 'fromBehind', 'walkOff', 'pinchHit', 'grandSlam', 'firstPitch', 'bunt', 'infieldHit',
    ],
  },
  {
    categoryKey: 'sc.catPitchDefRun',
    type: 'plus',
    ids: [
      'lateLife', 'sharpBreak', 'heavyBall', 'strikeouts', 'strongerLate', 'outOfTrouble', 'glove', 'cannonArm',
      'accurateThrow', 'gameCalling', 'steals', 'baserunning', 'headFirst',
    ],
  },
  {
    categoryKey: 'sc.catWeakness',
    type: 'minus',
    ids: ['strikesOut', 'wild', 'command', 'errors', 'pullHappy', 'fadesLate', 'predictable', 'bloopers'],
  },
  {
    categoryKey: 'sc.catCharacter',
    type: 'joke',
    ids: [
      'dugoutSpark', 'quickReply', 'rainMagnet', 'sunshine', 'socialSecretary', 'gearNerd',
      'statsNerd', 'booksTheField', 'ironMan',
    ],
  },
];

// 日本語のプリセット名 → id。id を持たずに保存された過去のタグを読むためだけに使う
const JA_LABEL_TO_ID = {
  アベレージヒッター: 'contact', パワーヒッター: 'power', 広角打法: 'allFields', 流し打ち: 'oppoField',
  固め打ち: 'multiHit', 粘り打ち: 'grinder', 'チャンス◯': 'clutch', '逆境◯': 'fromBehind',
  サヨナラ男: 'walkOff', '代打◯': 'pinchHit', 満塁男: 'grandSlam', '初球◯': 'firstPitch',
  'バント◯': 'bunt', '内野安打◯': 'infieldHit',
  'ノビ◯': 'lateLife', 'キレ◯': 'sharpBreak', 重い球: 'heavyBall', 奪三振: 'strikeouts',
  尻上がり: 'strongerLate', 'ピンチ◯': 'outOfTrouble', 守備職人: 'glove', レーザービーム: 'cannonArm',
  '送球◯': 'accurateThrow', 'キャッチャー◯': 'gameCalling', '盗塁◯': 'steals', '走塁◯': 'baserunning',
  ヘッスラ: 'headFirst',
  三振多め: 'strikesOut', 荒れ球: 'wild', 制球に難あり: 'command', エラー多め: 'errors',
  引っ張りすぎ: 'pullHappy', スタミナ切れ: 'fadesLate', 単調: 'predictable', ポテンヒット製造機: 'bloopers',
  盛り上げ隊長: 'dugoutSpark', 出欠即答: 'quickReply', '雨男/雨女': 'rainMagnet', '晴れ男/晴れ女': 'sunshine',
  宴会部長: 'socialSecretary', ギアマニア: 'gearNerd', データマン: 'statsNerd',
  グラウンド手配師: 'booksTheField', 鉄人: 'ironMan',
};

// 保存済みタグの id(無ければ日本語ラベルから逆引き)。自由入力タグは null
const tagIdOf = (tag) => tag?.id || JA_LABEL_TO_ID[tag?.label] || null;

// キャッチフレーズの候補(AI未生成のとき使う)
const CATCHPHRASE_IDS = ['cornerstone', 'allOrNothing', 'heart', 'unsung', 'trumpCard'];

// 戻り値: { report, nextGameTip, practiceTip }(Gemini生成時と同じ形にして表示側を共通化)
// 文のつなぎ方は言語で違う(日本語は続けて書けるが、英語は文のあいだに空白が要る)
function buildDummyReport(name, tags, statsSummary, uniqueFacts, recentSummary, t, labelOf) {
  const pick = (type) => tags.filter((x) => x.type === type).map(labelOf);
  const plus = pick('plus');
  const minus = pick('minus');
  const joke = pick('joke');
  const who = name || t('sc.unnamed');

  if (tags.length === 0 && !statsSummary) {
    return {
      report: t('sc.dummyEmpty', { name: who }),
      nextGameTip: t('sc.dummyEmptyNext'),
      practiceTip: t('sc.dummyEmptyPractice'),
    };
  }

  const parts = [];
  if (uniqueFacts.length) {
    // 同率よりも単独首位の方が際立つので優先して取り上げる
    const best = uniqueFacts.find((f) => !f.includes(t('sc.tieWord'))) || uniqueFacts[0];
    parts.push(t('sc.dummyUnique', { name: who, fact: best }));
  } else if (statsSummary) {
    parts.push(t('sc.dummyStats', { name: who, stats: statsSummary }));
  } else {
    parts.push(t('sc.dummyOpen', { name: who }));
  }
  if (plus.length) {
    parts.push(t('sc.dummyPlus', {
      first: plus[0],
      rest: plus.length > 1 ? t('sc.dummyPlusRest', { list: plus.slice(1).join(t('sc.listJoin')) }) : '',
    }));
  }
  if (minus.length) parts.push(t('sc.dummyMinus', { first: minus[0] }));
  // 個性は実際のタグがある時だけ触れる(無いのに褒めると嘘くさくなるため)
  if (joke.length) parts.push(t('sc.dummyJoke', { list: joke.join(t('sc.listJoin')) }));

  return {
    report: parts.join(t('sc.sentenceJoin')),
    nextGameTip: recentSummary ? t('sc.dummyNextWith', { recent: recentSummary }) : t('sc.dummyNext'),
    practiceTip: minus.length ? t('sc.dummyPracticeWith', { first: minus[0] }) : t('sc.dummyPractice'),
  };
}

function TagPill({ label, type, onClick }) {
  return (
    <button type="button" className={`tag-pill ${type}`} onClick={onClick}>
      {label}
    </button>
  );
}

// 顔写真をアップロード用に256px正方形へリサイズ・圧縮してdataURL化(localStorage肥大化を防ぐ)
function fileToAvatarDataURL(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const r = Math.max(size / img.width, size / img.height); // cover(中央切り抜き)
      const iw = img.width * r, ih = img.height * r;
      ctx.drawImage(img, (size - iw) / 2, (size - ih) / 2, iw, ih);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---- AI選手名鑑&AIコーチコメント ----
// Gemini APIキーが設定タブで入力されていれば実際にAI生成し、未設定/失敗時はダミー文言にフォールバックする。
export default function ScoutCard({ player, batting, pitching, battingM, pitchingM, uniqueFacts = [], recentSummary = '', saveType = 'UPDATE_PLAYER', onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const apiKey = state.settings.geminiApiKey;
  const statsSummary = buildStatsSummary(batting, pitching, battingM, pitchingM);
  // プリセットタグは id から引く。id が無いもの(自由入力・古いデータ)は保存された文字をそのまま
  const labelOf = (tag) => { const id = tagIdOf(tag); return id ? t(`tag.${id}`) : tag.label; };
  const catchOf = (id) => t(`sc.catch.${id}`);
  const [catchphrase, setCatchphrase] = useState(player?.scoutCatchphrase || catchOf(CATCHPHRASE_IDS[0]));
  const [photo, setPhoto] = useState(player?.scoutPhoto || ''); // 顔写真のdataURL
  const [tags, setTags] = useState(player?.scoutTags || []); // { id?, label, type }
  const [freeText, setFreeText] = useState('');
  const [freeType, setFreeType] = useState('plus');
  const [report, setReport] = useState(player?.scoutReport || '');
  const [nextGameTip, setNextGameTip] = useState(player?.scoutNextGameTip || '');
  const [practiceTip, setPracticeTip] = useState(player?.scoutPracticeTip || '');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null); // 'ai' | 'dummy-no-key' | 'dummy-error' | null(未生成)
  const [errorDetail, setErrorDetail] = useState('');
  const [dirty, setDirty] = useState(false); // 確定(保存)していない変更があるか

  const name = player?.name || t('sc.playerFallback');

  // 同一判定は id を優先する。日本語で付けたタグを英語表示で見ても同じタグとして扱うため
  const sameTag = (a, b) => {
    const ia = tagIdOf(a);
    const ib = tagIdOf(b);
    return ia && ib ? ia === ib : a.label === b.label;
  };
  const hasTagId = (id) => tags.some((x) => tagIdOf(x) === id);
  const hasLabel = (label) => tags.some((x) => x.label === label);

  const togglePreset = (id, type) => {
    setTags((prev) => (prev.some((x) => tagIdOf(x) === id)
      ? prev.filter((x) => tagIdOf(x) !== id)
      // label も入れておく。id を知らない古いバージョンで開いても読めるようにする
      : [...prev, { id, label: t(`tag.${id}`), type }]));
    setDirty(true);
  };

  const addFreeTag = () => {
    const label = freeText.trim();
    if (!label || hasLabel(label)) return;
    setTags((prev) => [...prev, { label, type: freeType }]);
    setFreeText('');
    setDirty(true);
  };

  const removeTag = (tag) => {
    setTags((prev) => prev.filter((x) => !sameTag(x, tag)));
    setDirty(true);
  };

  const onPhoto = async (file) => {
    try {
      const url = await fileToAvatarDataURL(file);
      setPhoto(url);
      setDirty(true);
    } catch {
      /* 読み込み失敗は無視 */
    }
  };

  const initial = name.slice(0, 1);

  const applyDummy = () => {
    setCatchphrase(catchOf(CATCHPHRASE_IDS[Math.floor(Math.random() * CATCHPHRASE_IDS.length)]));
    const d = buildDummyReport(name, tags, statsSummary, uniqueFacts, recentSummary, t, labelOf);
    setReport(d.report);
    setNextGameTip(d.nextGameTip);
    setPracticeTip(d.practiceTip);
  };

  const generate = async () => {
    setDirty(true);
    if (!apiKey) {
      applyDummy();
      setSource('dummy-no-key');
      return;
    }
    setLoading(true);
    // AIへ渡すタグも表示と同じ言語にする(日本語のタグから英語の寸評を書かせない)
    const tagsForAi = tags.map((x) => ({ label: labelOf(x), type: x.type }));
    const result = await generateScoutReport({ apiKey, name, number: player?.number, tags: tagsForAi, statsSummary, uniqueFacts, recentSummary, lang });
    setLoading(false);
    if (result && !result.error) {
      if (result.catchphrase) setCatchphrase(result.catchphrase);
      setReport(result.report);
      setNextGameTip(result.nextGameTip || '');
      setPracticeTip(result.practiceTip || '');
      setSource('ai');
    } else {
      applyDummy();
      setErrorDetail(result?.error || '');
      setSource('dummy-error');
    }
  };

  const handleClose = () => {
    if (dirty && !window.confirm(t('sc.discardConfirm'))) return;
    onClose();
  };

  const handleConfirm = () => {
    dispatch({
      type: saveType,
      id: player.id,
      patch: {
        scoutTags: tags, scoutCatchphrase: catchphrase, scoutReport: report, scoutPhoto: photo,
        scoutNextGameTip: nextGameTip, scoutPracticeTip: practiceTip,
      },
    });
    setDirty(false);
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={handleClose}>{t('common.back')}</button>
        <h2>
          {t('sc.title')}
          {dirty && <span className="small" style={{ color: 'var(--amber)', marginLeft: 6, fontWeight: 700 }}>{t('sc.unsaved')}</span>}
        </h2>
        <button className="primary small" onClick={handleConfirm}>{t('sc.confirm')}</button>
      </header>
      <div className="fullscreen-body">
        <div className="scout-card">
          <div className="scout-top">
            <label className="scout-photo" title={t('sc.photoHint')}>
              {photo ? <img src={photo} alt={name} /> : initial}
              <span className="scout-photo-cam">📷</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhoto(f);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="scout-catch">{catchphrase}</div>
            <div className="scout-name">{name}{player?.number ? ` #${player.number}` : ''}</div>
          </div>

          <div className="scout-mid">
            {statsSummary && <p className="small dim mb8">{t('sc.seasonStats', { stats: statsSummary })}</p>}
            {recentSummary && <p className="small dim mb8">{t('sc.recentForm', { recent: recentSummary })}</p>}
            {uniqueFacts.length > 0 && (
              <p className="small dim mb8">{t('sc.teamStrengths', { list: uniqueFacts.join(t('sc.listJoin')) })}</p>
            )}
            <div className="selected-tags-panel">
              <div className="section-title" style={{ margin: 0 }}>
                {t('sc.tagsTitle')} {tags.length > 0 && <span className="tag-count-badge">{tags.length}</span>}
              </div>
              {tags.length === 0 ? (
                <p className="small dim mt8">{t('sc.tagsEmpty')}</p>
              ) : (
                <>
                  <div className="tag-pill-row mt8">
                    {tags.map((tag) => (
                      <TagPill key={tagIdOf(tag) || tag.label} label={labelOf(tag)} type={tag.type} onClick={() => removeTag(tag)} />
                    ))}
                  </div>
                  <p className="small dim mt8">{t('sc.tagsRemoveHint')}</p>
                </>
              )}
            </div>

            {TAG_GROUPS.map((g) => (
              <div key={g.categoryKey}>
                <div className="section-title small">{t(g.categoryKey)} <span className="dim">({t(`sc.type.${g.type}`)})</span></div>
                <div className="tag-suggest-row">
                  {g.ids.map((id) => (
                    <button
                      key={id}
                      className={`tag-suggest ${g.type} ${hasTagId(id) ? 'on' : ''}`}
                      onClick={() => togglePreset(id, g.type)}
                    >
                      {t(`tag.${id}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="section-title small">{t('sc.freeTag')}</div>
            <div className="flex" style={{ gap: 6 }}>
              <input
                style={{ flex: 1 }}
                placeholder={t('sc.freeTagPlaceholder')}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFreeTag()}
              />
              <select style={{ width: 96 }} value={freeType} onChange={(e) => setFreeType(e.target.value)}>
                <option value="plus">{t('sc.type.plus')}</option>
                <option value="minus">{t('sc.type.minus')}</option>
                <option value="joke">{t('sc.type.joke')}</option>
              </select>
              <button className="small" onClick={addFreeTag}>{t('sc.add')}</button>
            </div>
          </div>

          <div className="scout-bottom">
            <div className="flex" style={{ marginBottom: 8 }}>
              <div className="grow section-title" style={{ margin: 0 }}>{t('sc.coachComment')}</div>
              <button className="small primary" onClick={generate} disabled={loading}>
                {loading ? t('sc.generating') : apiKey ? t('sc.genAi') : t('sc.genDummy')}
              </button>
            </div>
            <div className="scout-report">
              {report || buildDummyReport(name, tags, statsSummary, uniqueFacts, recentSummary, t, labelOf).report}
            </div>
            {source === 'ai' && <p className="small mt8" style={{ color: 'var(--green)' }}>{t('sc.byAi')}</p>}
            {source === 'dummy-error' && (
              <p className="small mt8" style={{ color: 'var(--amber)' }}>
                {t('sc.aiFailed')}{errorDetail && `(${errorDetail})`}
              </p>
            )}
            {source !== 'ai' && source !== 'dummy-error' && (
              <p className="small dim mt8">{apiKey ? t('sc.notYet') : t('sc.noKey')}</p>
            )}
            {(nextGameTip || practiceTip) && (
              <div className="scout-tips mt12">
                {nextGameTip && (
                  <div className="scout-tip">
                    <div className="scout-tip-label">{t('sc.tipNext')}</div>
                    <div className="scout-tip-body">{nextGameTip}</div>
                  </div>
                )}
                {practiceTip && (
                  <div className="scout-tip">
                    <div className="scout-tip-label">{t('sc.tipPractice')}</div>
                    <div className="scout-tip-body">{practiceTip}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FullscreenView>
  );
}
