// ============================================================
// チームに配る案内(LINEにそのまま貼れる文)
//
// 新しいチームの代表者が、記録係と観戦する人に送る文を、アプリが組み立てる。
// 送る相手で中身を分ける:
//   ・全員向け   … ライブ観戦リンクだけ(ログイン不要)
//   ・記録係向け … 共有のログイン情報 → その真下に記録員リンク(押して開く)
// ログイン情報をチーム全員のグループに流さないための分け方。
// パスワードはこの文を作るためだけに使い、保存しない。
// ============================================================

// 使い方ガイド(誰でも見られる公開ページ)
export const GUIDE_URL = 'https://claude.ai/artifact/D5WhjegaVAoyxyn51nYWHA';

const L = {
  ja: {
    allHead: '【{team}】試合のスコアをリアルタイムで見る(全員)',
    allBody: 'ログインもアプリのインストールも不要です。開くだけで、いまの試合のスコアと打席が見られます。応援スタンプも送れます。',
    allNext: '試合が変わっても同じリンクのままで見られます。',
    scorerHead: '【{team}】スコア記録係の方へ',
    login: '① ログイン情報(記録係みんなで共通)',
    email: 'メール: {v}',
    password: 'パスワード: {v}',
    open: '② このリンクを押して開き、上のログイン情報と自分の名前を入れて参加',
    openOwn: 'このリンクを押して開き、自分のアカウントでログインして、名前を入れて参加',
    expires: '(このリンクは {date} まで使えます。一度参加すれば、あとはアプリを開くだけです)',
    baton: '一度にスコアを付けられるのは1人です。交代するときは、次の人が自分のスマホで「記録を引き継ぐ」を押すだけ。',
    noChange: '※パスワードは変えないでください(みんなが入れなくなります)。',
    guide: '📘 使い方ガイド',
  },
  en: {
    allHead: '[{team}] Follow our games live (everyone)',
    allBody: 'No login or app install needed. Just open it to see the score and at-bats of the current game. You can send cheer stamps too.',
    allNext: 'The same link keeps working for the next games.',
    scorerHead: '[{team}] For scorers',
    login: '1. Login (shared by all scorers)',
    email: 'Email: {v}',
    password: 'Password: {v}',
    open: '2. Open this link, enter the login above and your name to join',
    openOwn: 'Open this link, log in with your own account and enter your name to join',
    expires: '(This link works until {date}. Once you have joined, just open the app.)',
    baton: 'Only one person scores at a time. To take over, the next person taps “Take over scoring” on their own phone.',
    noChange: 'Please do not change the password (everyone would be locked out).',
    guide: '📘 User guide',
  },
};

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

// 送る文を2通り作る。
//   team, liveUrl, scorerUrl, email, password, expiresAt(ms), lang, guideUrl
// 戻り値: { all, scorer }。リンクが無い側は '' を返す
export function buildTeamKit({ team = '', liveUrl = '', scorerUrl = '', email = '', password = '', expiresAt = null, lang = 'ja', guideUrl = GUIDE_URL } = {}) {
  const T = L[lang] || L.ja;
  const v = { team: team || (lang === 'en' ? 'Our team' : 'チーム') };
  const all = liveUrl
    ? [fill(T.allHead, v), liveUrl, T.allBody, T.allNext, '', T.guide, guideUrl].join('\n')
    : '';
  let scorer = '';
  if (scorerUrl) {
    const lines = [fill(T.scorerHead, v), ''];
    if (email || password) {
      lines.push(T.login);
      if (email) lines.push(fill(T.email, { v: email }));
      if (password) lines.push(fill(T.password, { v: password }));
      lines.push('');
    }
    lines.push(email || password ? T.open : T.openOwn, scorerUrl);
    if (expiresAt) {
      const d = new Date(expiresAt);
      const date = lang === 'en'
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `${d.getMonth() + 1}月${d.getDate()}日`;
      lines.push(fill(T.expires, { date }));
    }
    lines.push('', T.baton);
    if (password) lines.push(T.noChange);
    lines.push('', T.guide, guideUrl);
    scorer = lines.join('\n');
  }
  return { all, scorer };
}
