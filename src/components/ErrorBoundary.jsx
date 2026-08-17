import React from 'react';
import { downloadBackup } from '../lib/backup.js';
import { translate } from '../lib/i18n.js';

// ============================================================
// 画面が落ちたときの受け皿
//
// 監査で見つかった穴。試合中に描画エラーが1回起きると、画面が真っ白になって
// 記録が続けられない。屋外で片手で使う道具としては、これがいちばん怖い。
// しかも状態は保存されているので、その状態が原因なら再読み込みしても同じ
// ところで落ちる。「再読み込みしてください」だけでは逃げ道にならない。
//
// だからここでは3つ出す:
//   1. 記録は消えていない、と言い切る(いちばん先に知りたいのはこれ)
//   2. バックアップの書き出し。再読み込みで直らない場合の唯一の逃げ道なので、
//      何よりも先に押せる場所に置く
//   3. 再読み込み
//
// タブごとに置くので、1つのタブが落ちても下のタブバーは生きている。
// 別のタブへ移れば記録は続けられる。
// ============================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, saved: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 原因を追える場所がここしかない。console には必ず残す
    // eslint-disable-next-line no-console
    console.error('[AI-BASE] 画面の描画に失敗しました', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    // タブを移ったり試合を切り替えたら、もう一度描画を試す
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, saved: false });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const lang = this.props.lang || 'ja';
    const t = (k, p) => translate(lang, k, p);
    return (
      <div className="crash" role="alert">
        <h2>{t('crash.title')}</h2>
        <p className="crash-safe">{t('crash.safe')}</p>
        <p className="small dim">{t('crash.what')}</p>
        <button
          className="primary"
          style={{ width: '100%' }}
          onClick={() => this.setState({ saved: downloadBackup(this.props.stateRef?.current) })}
        >
          {t('crash.backup')}
        </button>
        {this.state.saved && <p className="small crash-ok">{t('crash.backupDone')}</p>}
        <button style={{ width: '100%' }} onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </button>
        <p className="small dim mt8">{t('crash.otherTab')}</p>
        {/* 何が起きたかを見せる。問い合わせのときにこれが無いと追えない */}
        <details className="crash-detail">
          <summary>{t('crash.detail')}</summary>
          <pre>{String(error?.stack || error?.message || error)}</pre>
        </details>
      </div>
    );
  }
}

// ---- 受け皿そのものを試すための仕掛け ----
// 安全網はテストできないと、いざというときに壊れていても気づけない。
// URLに ?selftest=crash が付いているときだけ、ホームタブの描画を落とす。
// 手で打たない限り起きないし、他のタブは落とさないので、
// 「1つのタブが落ちても他は使える」ところまで通しで確かめられる。
export function CrashProbe({ tab }) {
  const on = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('selftest') === 'crash';
  if (on && tab === 'home') throw new Error('selftest: 受け皿の動作確認のため、わざと落としています');
  return null;
}
