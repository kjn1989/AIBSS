import React, { useState, useEffect, useRef } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { computeHighlights } from '../lib/highlights.js';
import { generateNewspaper } from '../lib/gemini.js';
import { generateNewspaperImage, shareNewspaperImage } from '../lib/newspaperImage.js';
import FullscreenView from './FullscreenView.jsx';

// Gemini用の試合サマリー(人間可読テキスト)
function buildSummary(game, h, teamName) {
  const lines = [
    `日付: ${game.date}`,
    `対戦: ${teamName} vs ${game.opponent || '対戦相手'}`,
    `最終スコア: ${game.myScore} - ${game.oppScore}（${h.resultLabel}）`,
  ];
  if (h.topBatter) lines.push(`MVP: ${h.topBatter.name}（${h.topBatter.h}安打 ${h.topBatter.rbi}打点${h.topBatter.hr ? ` ${h.topBatter.hr}本塁打` : ''}）`);
  if (h.topPitcher) lines.push(`好投: ${h.topPitcher.name} ${h.topPitcher.line}`);
  if (h.clutch) lines.push(`決勝・勝ち越し打: ${h.clutch.label}`);
  if (h.extraBaseHits.length) lines.push(`見どころ: ${h.extraBaseHits.slice(0, 4).join(' / ')}`);
  return lines.join('\n');
}

// APIキー未設定/失敗時のテンプレート記事
function buildFallbackArticle(game, h, teamName) {
  const rl = h.resultLabel;
  const headline = rl === '勝利' ? `${teamName} 快勝！` : rl === '敗北' ? `${teamName} 惜敗` : `${teamName} 引き分け`;
  let body = `${game.date}、${teamName}は${game.opponent || '対戦相手'}と対戦し、${game.myScore}対${game.oppScore}で${rl}した。`;
  if (h.topBatter) body += `打線では${h.topBatter.name}が${h.topBatter.h}安打${h.topBatter.rbi}打点と気を吐いた。`;
  if (h.topPitcher) body += `マウンドでは${h.topPitcher.name}が${h.topPitcher.line}と力投。`;
  if (h.clutch) body += `${h.clutch.label}が試合を分けた。`;
  body += '次戦のさらなる活躍に期待がかかる。';
  return {
    headline,
    subhead: `${game.myScore}-${game.oppScore}、${game.opponent || '対戦相手'}戦`,
    body,
    comment: '',
  };
}

// AIスポーツ新聞: 試合結果からAIが記事を書き、写真と合わせて新聞レイアウトのPNGを生成
export default function NewspaperView({ game, onClose }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const apiKey = state.settings.geminiApiKey;
  const teamName = state.settings.teamName || 'マイチーム';
  const h = computeHighlights(game, nameOf);

  const [photo, setPhoto] = useState(null); // HTMLImageElement
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null); // 'ai' | 'fallback' | 'error'
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const urlRef = useRef('');

  // 記事 or 写真が変わるたびに新聞画像を再描画してプレビュー
  useEffect(() => {
    if (!article) return;
    let cancelled = false;
    generateNewspaperImage({ article, game, teamName, photo }).then((blob) => {
      if (cancelled || !blob) return;
      const u = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = u;
      setPreviewUrl(u);
    });
    return () => { cancelled = true; };
  }, [article, photo, game, teamName]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPhoto = (file) => {
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.src = URL.createObjectURL(file);
  };

  const generate = async () => {
    setError('');
    if (!apiKey) {
      setArticle(buildFallbackArticle(game, h, teamName));
      setSource('fallback');
      return;
    }
    setLoading(true);
    const r = await generateNewspaper({ apiKey, summary: buildSummary(game, h, teamName) });
    setLoading(false);
    if (r && !r.error) {
      setArticle(r);
      setSource('ai');
    } else {
      setArticle(buildFallbackArticle(game, h, teamName));
      setSource('error');
      setError(r?.error || 'オフラインのため生成できませんでした');
    }
  };

  const share = async () => {
    const blob = await generateNewspaperImage({ article, game, teamName, photo });
    await shareNewspaperImage(blob, game);
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>AIスポーツ新聞</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <p className="small dim" style={{ marginBottom: 10 }}>
            試合結果からAIが「スポーツ新聞」風の記事を執筆します。写真を添えると一面記事として合成されます。
          </p>
          <div className="grid2">
            <label className="file-btn">
              {photo ? '📷 写真を変更' : '📷 写真を選ぶ（任意）'}
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
            <button className="primary" onClick={generate} disabled={loading}>
              {loading ? '🖋 執筆中...' : article ? '🔄 記事を作り直す' : '📰 新聞を作る'}
            </button>
          </div>
          {source === 'ai' && <p className="small mt8" style={{ color: 'var(--green)' }}>✨ Gemini AIによる記事です。</p>}
          {source === 'error' && <p className="small mt8" style={{ color: 'var(--amber)' }}>⚠️ AI生成に失敗したため、テンプレート記事です。{error && `(${error})`}</p>}
          {source === 'fallback' && <p className="small dim mt8">※ Gemini APIキー未設定のためテンプレート記事です。設定タブでキーを追加すると臨場感が増します。</p>}
        </div>

        {article && (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>✍️ 内容を確認・修正</div>
            <p className="small dim" style={{ marginBottom: 10 }}>
              AIの記事は誤りを含むことがあります。下を直すとプレビューに即反映されます。
            </p>
            <label className="small dim">見出し</label>
            <input value={article.headline || ''} onChange={(e) => setArticle({ ...article, headline: e.target.value })} />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>小見出し（リード）</label>
            <input value={article.subhead || ''} onChange={(e) => setArticle({ ...article, subhead: e.target.value })} />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>本文</label>
            <textarea
              rows={7}
              value={article.body || ''}
              onChange={(e) => setArticle({ ...article, body: e.target.value })}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>記者の目（任意）</label>
            <input value={article.comment || ''} onChange={(e) => setArticle({ ...article, comment: e.target.value })} />
          </div>
        )}

        {previewUrl && (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>プレビュー</div>
            <img src={previewUrl} alt="AIスポーツ新聞" className="newspaper-preview" />
            <button className="primary mt12" style={{ width: '100%' }} onClick={share}>📤 この内容で保存・共有</button>
          </div>
        )}
      </div>
    </FullscreenView>
  );
}
