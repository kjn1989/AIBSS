import React, { useState, useEffect, useRef } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { translate } from '../lib/i18n.js';
import { computeHighlights } from '../lib/highlights.js';
import { kindOf } from '../lib/editionKind.js';
import { generateNewspaper } from '../lib/gemini.js';
import { generateNewspaperImage, shareNewspaperImage } from '../lib/newspaperImage.js';
import FullscreenView from './FullscreenView.jsx';

// Gemini用の試合サマリー(人間可読テキスト)。
// 表示ではなくAIへの入力だが、記事を書かせる言語と揃えておく
// (日本語の材料から英語の記事を書かせると、固有名詞の扱いが揺れる)。
function buildSummary(game, h, teamName, lang) {
  const T = (k, p) => translate(lang, k, p);
  const lines = [
    T('np.sumDate', { date: game.date }),
    ...(game.season ? [T('np.sumSeason', { season: game.season })] : []),
    T('np.sumVs', { my: teamName, opp: game.opponent || T('np.oppFallback') }),
    T('np.sumScore', { my: game.myScore, opp: game.oppScore, result: h.resultLabel }),
  ];
  if (h.topBatter) {
    lines.push(T('np.sumMvp', {
      name: h.topBatter.name, h: h.topBatter.h, rbi: h.topBatter.rbi,
      hr: h.topBatter.hr ? T('np.sumMvpHr', { hr: h.topBatter.hr }) : '',
    }));
  }
  if (h.topPitcher) lines.push(T('np.sumPitcher', { name: h.topPitcher.name, line: h.topPitcher.line }));
  if (h.clutch) lines.push(T('np.sumClutch', { x: h.clutch.label }));
  if (h.extraBaseHits.length) lines.push(T('np.sumHighlights', { x: h.extraBaseHits.slice(0, 4).join(' / ') }));
  return lines.join('\n');
}

// APIキー未設定/失敗時のテンプレート記事。
// 文はつなげて1本の記事にするので、言語ごとに区切り方が違う
// (日本語は続けて書けるが、英語は文のあいだに空白が要る)。
function buildFallbackArticle(game, h, teamName, lang) {
  const T = (k, p) => translate(lang, k, p);
  const opp = game.opponent || T('np.oppFallback');
  const headKey = h.resultKey === 'win' ? 'np.fbHeadWin' : h.resultKey === 'lose' ? 'np.fbHeadLose' : 'np.fbHeadDraw';
  const parts = [T('np.fbOpen', { date: game.date, my: teamName, opp, myScore: game.myScore, oppScore: game.oppScore, result: h.resultLabel })];
  if (h.topBatter) parts.push(T('np.fbBatter', { name: h.topBatter.name, h: h.topBatter.h, rbi: h.topBatter.rbi }));
  if (h.topPitcher) parts.push(T('np.fbPitcher', { name: h.topPitcher.name, line: h.topPitcher.line }));
  if (h.clutch) parts.push(T('np.fbClutch', { x: h.clutch.label }));
  parts.push(T('np.fbClose'));
  return {
    headline: T(headKey, { team: teamName }),
    subhead: T('np.fbSubhead', { my: game.myScore, opp: game.oppScore, name: opp }),
    body: parts.join(T('np.fbJoin')),
    comment: '',
  };
}

// AIスポーツ新聞: 試合結果からAIが記事を書き、写真と合わせて新聞レイアウトのPNGを生成
export default function NewspaperView({ game, onClose }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const apiKey = state.settings.geminiApiKey;
  const teamName = state.settings.teamName || t('np.teamFallback');
  const h = computeHighlights(game, nameOf, lang);

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
    generateNewspaperImage({ article, game, teamName, photo, lang }).then((blob) => {
      if (cancelled || !blob) return;
      const u = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = u;
      setPreviewUrl(u);
    });
    return () => { cancelled = true; };
  }, [article, photo, game, teamName, lang]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPhoto = (file) => {
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.src = URL.createObjectURL(file);
  };

  const generate = async () => {
    setError('');
    if (!apiKey) {
      setArticle(buildFallbackArticle(game, h, teamName, lang));
      setSource('fallback');
      return;
    }
    setLoading(true);
    const r = await generateNewspaper({
      apiKey,
      summary: buildSummary(game, h, teamName, lang),
      edition: state.settings.edition,
      kind: kindOf(state.settings),
      season: game.season || '',
      lang,
    });
    setLoading(false);
    if (r && !r.error) {
      setArticle(r);
      setSource('ai');
    } else {
      setArticle(buildFallbackArticle(game, h, teamName, lang));
      setSource('error');
      setError(r?.error || t('np.errOffline'));
    }
  };

  const share = async () => {
    const blob = await generateNewspaperImage({ article, game, teamName, photo, lang });
    await shareNewspaperImage(blob, game, lang);
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('common.back')}</button>
        <h2>{t('np.title')}</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <p className="small dim" style={{ marginBottom: 10 }}>{t('np.desc')}</p>
          <div className="grid2">
            <label className="file-btn">
              {photo ? t('np.photoChange') : t('np.photoPick')}
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
              {loading ? t('np.writing') : article ? t('np.rewrite') : t('np.make')}
            </button>
          </div>
          {source === 'ai' && <p className="small mt8" style={{ color: 'var(--green)' }}>{t('np.byAi')}</p>}
          {source === 'error' && <p className="small mt8" style={{ color: 'var(--amber)' }}>{t('np.aiFailed')}{error && `(${error})`}</p>}
          {source === 'fallback' && <p className="small dim mt8">{t('np.noKey')}</p>}
        </div>

        {article && (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>{t('np.editTitle')}</div>
            <p className="small dim" style={{ marginBottom: 10 }}>{t('np.editNote')}</p>
            <label className="small dim">{t('np.headline')}</label>
            <input value={article.headline || ''} onChange={(e) => setArticle({ ...article, headline: e.target.value })} />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>{t('np.subhead')}</label>
            <input value={article.subhead || ''} onChange={(e) => setArticle({ ...article, subhead: e.target.value })} />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>{t('np.body')}</label>
            <textarea
              rows={7}
              value={article.body || ''}
              onChange={(e) => setArticle({ ...article, body: e.target.value })}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <label className="small dim mt8" style={{ display: 'block', marginTop: 8 }}>{t('np.comment')}</label>
            <input value={article.comment || ''} onChange={(e) => setArticle({ ...article, comment: e.target.value })} />
          </div>
        )}

        {previewUrl && (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>{t('np.preview')}</div>
            <img src={previewUrl} alt={t('np.title')} className="newspaper-preview" />
            <button className="primary mt12" style={{ width: '100%' }} onClick={share}>{t('np.share')}</button>
          </div>
        )}
      </div>
    </FullscreenView>
  );
}
