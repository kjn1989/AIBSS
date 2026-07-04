import React, { useState } from 'react';
import { useStore } from '../state/store.jsx';
import { generateScoutReport } from '../lib/gemini.js';
import { fmtAvg } from '../lib/stats.js';
import FullscreenView from './FullscreenView.jsx';

// ---- プリセット特殊能力タグ(パワプロ風) ----
// type: 'plus'(青=長所) / 'minus'(赤=短所) / 'joke'(緑=個性・チーム貢献)
const TAG_GROUPS = [
  {
    category: '打撃',
    type: 'plus',
    tags: [
      'アベレージヒッター', 'パワーヒッター', '広角打法', '流し打ち', '固め打ち', '粘り打ち',
      'チャンス◯', '逆境◯', 'サヨナラ男', '代打◯', '満塁男', '初球◯', 'バント◯', '内野安打◯',
    ],
  },
  {
    category: '投球・守備・走塁',
    type: 'plus',
    tags: [
      'ノビ◯', 'キレ◯', '重い球', '奪三振', '尻上がり', 'ピンチ◯', '守備職人', 'レーザービーム',
      '送球◯', 'キャッチャー◯', '盗塁◯', '走塁◯', 'ヘッスラ',
    ],
  },
  {
    category: '課題・弱点',
    type: 'minus',
    tags: ['三振多め', '荒れ球', '制球に難あり', 'エラー多め', '引っ張りすぎ', 'スタミナ切れ', '単調', 'ポテンヒット製造機'],
  },
  {
    category: 'キャラクター・チーム貢献',
    type: 'joke',
    tags: [
      '盛り上げ隊長', '出欠即答', '雨男/雨女', '晴れ男/晴れ女', '宴会部長', 'ギアマニア',
      'データマン', 'グラウンド手配師', '鉄人',
    ],
  },
];

const TYPE_LABEL = { plus: 'プラス評価', minus: 'マイナス評価', joke: '個性・その他' };

// ダミーのスカウト寸評テンプレート(実際のAI生成の代わりに文言を組み立てるモック)
const CATCHPHRASES = [
  '頼れる4番打者候補', '一振りに賭ける男', 'チームの心臓', '無冠の職人', '最後の切り札',
];

function buildDummyReport(name, tags, statsSummary) {
  const plus = tags.filter((t) => t.type === 'plus').map((t) => t.label);
  const minus = tags.filter((t) => t.type === 'minus').map((t) => t.label);
  const joke = tags.filter((t) => t.type === 'joke').map((t) => t.label);

  if (tags.length === 0 && !statsSummary) {
    return `${name || '無名の選手'}……まだタグも成績データも登録されていない。素材としては未知数だが、伸びしろは無限大かもしれない。`;
  }
  let s = `${name || '無名の選手'}、`;
  if (statsSummary) s += `今季${statsSummary}という数字を残す。`;
  if (plus.length) s += `「${plus[0]}」の看板に嘘はない。`;
  if (plus.length > 1) s += `加えて${plus.slice(1).join('・')}も持ち味で、使い勝手は抜群だ。`;
  if (minus.length) s += `ただし${minus.join('・')}が課題で、そこを克服できれば化ける。`;
  if (joke.length) s += `グラウンド外では${joke.join('・')}としても欠かせない存在……なのは間違いない。`;
  s += ' 愛すべきキャラクターであることは、球団としても認めざるを得ない。';
  return s;
}

// 選手の集計成績(打撃/投手)を短い日本語サマリーに変換し、スカウト寸評に反映させる
function buildStatsSummary(batting, pitching, m, pm) {
  const parts = [];
  if (batting && batting.pa > 0 && m) {
    parts.push(`打率${fmtAvg(m.ba)} 本塁打${batting.hr} 打点${batting.rbi} OPS${m.ops === null ? '-' : m.ops.toFixed(3)}`);
  }
  if (pitching && (pitching.outsRecorded > 0 || pitching.games > 0) && pm) {
    parts.push(`防御率${pm.era7 === null ? '-' : pm.era7.toFixed(2)} 奪三振${pitching.strikeouts} WHIP${pm.whip === null ? '-' : pm.whip.toFixed(2)}`);
  }
  return parts.join(' / ');
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

// ---- AI選手名鑑&スカウト寸評 ----
// Gemini APIキーが設定タブで入力されていれば実際にAI生成し、未設定/失敗時はダミー文言にフォールバックする。
export default function ScoutCard({ player, batting, pitching, battingM, pitchingM, saveType = 'UPDATE_PLAYER', onClose }) {
  const { state, dispatch } = useStore();
  const apiKey = state.settings.geminiApiKey;
  const statsSummary = buildStatsSummary(batting, pitching, battingM, pitchingM);
  const [catchphrase, setCatchphrase] = useState(player?.scoutCatchphrase || CATCHPHRASES[0]);
  const [photo, setPhoto] = useState(player?.scoutPhoto || ''); // 顔写真のdataURL
  const [tags, setTags] = useState(player?.scoutTags || []); // { label, type }
  const [freeText, setFreeText] = useState('');
  const [freeType, setFreeType] = useState('plus');
  const [report, setReport] = useState(player?.scoutReport || '');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null); // 'ai' | 'dummy-no-key' | 'dummy-error' | null(未生成)
  const [errorDetail, setErrorDetail] = useState('');
  const [dirty, setDirty] = useState(false); // 確定(保存)していない変更があるか

  const name = player?.name || '選手';

  const hasTag = (label) => tags.some((t) => t.label === label);

  const toggleTag = (label, type) => {
    setTags((prev) => (prev.some((t) => t.label === label) ? prev.filter((t) => t.label !== label) : [...prev, { label, type }]));
    setDirty(true);
  };

  const addFreeTag = () => {
    const label = freeText.trim();
    if (!label || hasTag(label)) return;
    setTags((prev) => [...prev, { label, type: freeType }]);
    setFreeText('');
    setDirty(true);
  };

  const removeTag = (label) => {
    setTags((prev) => prev.filter((t) => t.label !== label));
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

  const generate = async () => {
    setDirty(true);
    if (!apiKey) {
      setCatchphrase(CATCHPHRASES[Math.floor(Math.random() * CATCHPHRASES.length)]);
      setReport(buildDummyReport(name, tags, statsSummary));
      setSource('dummy-no-key');
      return;
    }
    setLoading(true);
    const result = await generateScoutReport({ apiKey, name, number: player?.number, tags, statsSummary });
    setLoading(false);
    if (result && !result.error) {
      if (result.catchphrase) setCatchphrase(result.catchphrase);
      setReport(result.report);
      setSource('ai');
    } else {
      setCatchphrase(CATCHPHRASES[Math.floor(Math.random() * CATCHPHRASES.length)]);
      setReport(buildDummyReport(name, tags, statsSummary));
      setErrorDetail(result?.error || '');
      setSource('dummy-error');
    }
  };

  const handleClose = () => {
    if (dirty && !window.confirm('確定せずに戻ると、現在の入力内容は全てキャンセルされます。よろしいですか？')) return;
    onClose();
  };

  const handleConfirm = () => {
    dispatch({
      type: saveType,
      id: player.id,
      patch: { scoutTags: tags, scoutCatchphrase: catchphrase, scoutReport: report, scoutPhoto: photo },
    });
    setDirty(false);
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={handleClose}>← 戻る</button>
        <h2>
          AI選手名鑑
          {dirty && <span className="small" style={{ color: 'var(--amber)', marginLeft: 6, fontWeight: 700 }}>●未確定</span>}
        </h2>
        <button className="primary small" onClick={handleConfirm}>確定</button>
      </header>
      <div className="fullscreen-body">
        <div className="scout-card">
          <div className="scout-top">
            <label className="scout-photo" title="タップで顔写真をアップロード">
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
            {statsSummary && <p className="small dim mb8">📊 今季成績: {statsSummary}</p>}
            <div className="selected-tags-panel">
              <div className="section-title" style={{ margin: 0 }}>
                特殊能力タグ {tags.length > 0 && <span className="tag-count-badge">{tags.length}</span>}
              </div>
              {tags.length === 0 ? (
                <p className="small dim mt8">下のタグ候補から選ぶか、自由入力で追加してください。</p>
              ) : (
                <>
                  <div className="tag-pill-row mt8">
                    {tags.map((t) => (
                      <TagPill key={t.label} label={t.label} type={t.type} onClick={() => removeTag(t.label)} />
                    ))}
                  </div>
                  <p className="small dim mt8">タップで解除できます。</p>
                </>
              )}
            </div>

            {TAG_GROUPS.map((g) => (
              <div key={g.category}>
                <div className="section-title small">{g.category} <span className="dim">({TYPE_LABEL[g.type]})</span></div>
                <div className="tag-suggest-row">
                  {g.tags.map((label) => (
                    <button
                      key={label}
                      className={`tag-suggest ${g.type} ${hasTag(label) ? 'on' : ''}`}
                      onClick={() => toggleTag(label, g.type)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="section-title small">自由入力タグ</div>
            <div className="flex" style={{ gap: 6 }}>
              <input
                style={{ flex: 1 }}
                placeholder="タグを入力..."
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFreeTag()}
              />
              <select style={{ width: 96 }} value={freeType} onChange={(e) => setFreeType(e.target.value)}>
                <option value="plus">プラス</option>
                <option value="minus">マイナス</option>
                <option value="joke">個性</option>
              </select>
              <button className="small" onClick={addFreeTag}>追加</button>
            </div>
          </div>

          <div className="scout-bottom">
            <div className="flex" style={{ marginBottom: 8 }}>
              <div className="grow section-title" style={{ margin: 0 }}>スカウト寸評</div>
              <button className="small primary" onClick={generate} disabled={loading}>
                {loading ? '生成中...' : apiKey ? '✨ AIで生成' : '🎲 生成(ダミー)'}
              </button>
            </div>
            <div className="scout-report">
              {report || buildDummyReport(name, tags, statsSummary)}
            </div>
            {source === 'ai' && <p className="small mt8" style={{ color: 'var(--green)' }}>✨ Gemini AIによる生成です。</p>}
            {source === 'dummy-error' && (
              <p className="small mt8" style={{ color: 'var(--amber)' }}>
                ⚠️ AI生成に失敗したため、ダミー文言を表示しています。{errorDetail && `(${errorDetail})`}
              </p>
            )}
            {source !== 'ai' && source !== 'dummy-error' && (
              <p className="small dim mt8">
                {apiKey ? '※ まだ生成していません。' : '※ Gemini APIキー未設定のため、ダミー文言です。設定タブから追加できます。'}
              </p>
            )}
          </div>
        </div>
      </div>
    </FullscreenView>
  );
}
