// 表示言語をどう決めるか。
//
// ---- なぜ端末単位にするのか ----
// 以前は settings.lang、つまり**チーム(プロフィール)単位**の設定だった。
// 言語は人の属性でチームの属性ではないので、これは次の形で壊れていた:
//   ・招待リンクで2チーム目に参加すると、新しいプロフィールの設定は既定から
//     始まるので日本語に戻る(英語で使っていた人が、参加した瞬間に日本語になる)
//   ・チームを切り替えるだけで言語が変わる
// そこで言語は端末に1つだけ持ち、プロフィールをまたいで共有する。
//
// ---- 決める順番 ----
//   1. URLの ?lang=  … 共有リンクが運んできた言語。リンクを作った人の言語で開く
//   2. 端末に保存された選択
//   3. いま開いているチームの settings.lang … 端末単位に移す前の既存ユーザーの引き継ぎ
//   4. 端末の言語から推定(下記)
// 1で来たものも保存する。受け取った人が次に開いたときも同じ言語で開くため。
//
// ---- 推定の規則 ----
// navigator.languages に日本語があれば日本語、無ければ英語。
// 外したときの戻しやすさが非対称なのでこうしている。日本語話者が英語画面に
// 当たっても、言語カードは設定タブの2番目で見出しが「🌐 言語 / Language」と
// 両言語なので1タップで戻せる。逆に日本語話者でない人が日本語画面に当たると、
// そこへ辿り着くまで全部日本語になる。
// なお推定が効くのは保存された選択が無いときだけなので、既存ユーザーには影響しない。
import { LANGS, DEFAULT_LANG } from './i18n.js';

export const LANG_KEY = 'bbscorer.lang';

const valid = (v) => (LANGS.includes(v) ? v : null);

export function storedLang() {
  try {
    return valid(localStorage.getItem(LANG_KEY));
  } catch {
    return null; // プライベートモード等で読めなくても既定で続ける
  }
}

export function saveLang(lang) {
  const v = valid(lang);
  if (!v) return;
  try {
    localStorage.setItem(LANG_KEY, v);
  } catch {
    /* 保存できなくてもその場の表示は効く */
  }
}

// URLの ?lang=。共有リンク(招待・観戦)が運んでくる
export function langFromUrl(search) {
  try {
    return valid(new URLSearchParams(search ?? window.location.search).get('lang'));
  } catch {
    return null;
  }
}

// 端末の言語からの推定。日本語があれば日本語、無ければ英語
export function detectLang(languages) {
  const list = languages
    || (typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language]));
  const tags = (list || []).filter(Boolean).map((x) => String(x).toLowerCase());
  if (tags.some((x) => x === 'ja' || x.startsWith('ja-'))) return 'ja';
  return tags.length ? 'en' : DEFAULT_LANG;
}

// 上の1〜4を順に見て決める。純関数にして、テストから順番そのものを確かめられるようにする
export function resolveLang({ url = null, stored = null, profile = null, languages = null } = {}) {
  return valid(url) || valid(stored) || valid(profile) || detectLang(languages);
}
