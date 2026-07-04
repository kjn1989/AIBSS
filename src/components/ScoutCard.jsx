import React, { useMemo, useState } from 'react';

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

function buildDummyReport(name, tags) {
  const plus = tags.filter((t) => t.type === 'plus').map((t) => t.label);
  const minus = tags.filter((t) => t.type === 'minus').map((t) => t.label);
  const joke = tags.filter((t) => t.type === 'joke').map((t) => t.label);

  if (tags.length === 0) {
    return `${name || '無名の選手'}……まだタグが登録されていない。素材としては未知数だが、伸びしろは無限大かもしれない。まずはタグを付けてやってくれ。`;
  }
  let s = `${name || '無名の選手'}、`;
  if (plus.length) s += `「${plus[0]}」の看板に嘘はない。`;
  if (plus.length > 1) s += `加えて${plus.slice(1).join('・')}も持ち味で、使い勝手は抜群だ。`;
  if (minus.length) s += `ただし${minus.join('・')}が課題で、そこを克服できれば化ける。`;
  if (joke.length) s += `グラウンド外では${joke.join('・')}としても欠かせない存在……なのは間違いない。`;
  s += ' 愛すべきキャラクターであることは、球団としても認めざるを得ない。';
  return s;
}

function TagPill({ label, type, onClick }) {
  return (
    <button type="button" className={`tag-pill ${type}`} onClick={onClick}>
      {label}
    </button>
  );
}

// ---- AI選手名鑑&スカウト寸評 (UIモック / ダミーデータのみ、AI連携は未実装) ----
export default function ScoutCard({ player, onClose }) {
  const [catchphrase, setCatchphrase] = useState(CATCHPHRASES[0]);
  const [tags, setTags] = useState([]); // { label, type }
  const [freeText, setFreeText] = useState('');
  const [freeType, setFreeType] = useState('plus');
  const [report, setReport] = useState('');

  const name = player?.name || '選手';

  const hasTag = (label) => tags.some((t) => t.label === label);

  const toggleTag = (label, type) => {
    setTags((prev) => (prev.some((t) => t.label === label) ? prev.filter((t) => t.label !== label) : [...prev, { label, type }]));
  };

  const addFreeTag = () => {
    const label = freeText.trim();
    if (!label || hasTag(label)) return;
    setTags((prev) => [...prev, { label, type: freeType }]);
    setFreeText('');
  };

  const removeTag = (label) => setTags((prev) => prev.filter((t) => t.label !== label));

  const initial = name.slice(0, 1);

  const generate = () => {
    setCatchphrase(CATCHPHRASES[Math.floor(Math.random() * CATCHPHRASES.length)]);
    setReport(buildDummyReport(name, tags));
  };

  return (
    <div className="fullscreen-view">
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>AI選手名鑑</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="scout-card">
          <div className="scout-top">
            <div className="scout-photo">{initial}</div>
            <div className="scout-catch">{catchphrase}</div>
            <div className="scout-name">{name}{player?.number ? ` #${player.number}` : ''}</div>
          </div>

          <div className="scout-mid">
            <div className="section-title">特殊能力タグ</div>
            {tags.length === 0 ? (
              <p className="small dim">下のタグ候補から選ぶか、自由入力で追加してください。</p>
            ) : (
              <>
                <div className="tag-pill-row">
                  {tags.map((t) => (
                    <TagPill key={t.label} label={t.label} type={t.type} onClick={() => removeTag(t.label)} />
                  ))}
                </div>
                <p className="small dim mt8">タップで解除できます。</p>
              </>
            )}

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
              <button className="small primary" onClick={generate}>🎲 生成(ダミー)</button>
            </div>
            <div className="scout-report">
              {report || buildDummyReport(name, tags)}
            </div>
            <p className="small dim mt8">※ この寸評はダミー生成です。AI(Gemini等)連携は次のステップで対応予定。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
