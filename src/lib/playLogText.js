// ============================================================
// プレイログの文を、出すときに組み立てる
//
// ログの text は記録した時点の日本語で保存されている。これは表示用の文である
// と同時に、集計の内部キーでもある(matchup.js / ownScout.js が
// l.text === '盗塁死' のように数えている)。だから保存を翻訳してはいけない。
// 翻訳した瞬間、英語で記録した試合の相手スカウティングが静かに空になる。
//
// 代わりに、出すときに payload から組み直す。payload には result・direction・
// outType・失策・好守・得点まで入っているので、記録した言語に関係なく
// 読み手の言語で書き直せる。
//
// payload に材料が無いログ(古い記録・交代ログなど)は、保存された文を
// そのまま出す。訳せないものを訳したふりはしない。
// ============================================================
import { playLabel } from './voiceParser.js';
import { positionLabel } from './model.js';
import { logTextOf } from './oppBox.js';

// 保存されている文の言語。これと同じ言語で読むなら、組み直す必要は無い。
// 組み直すと「遊撃凡打(アウト)」が「遊撃ゴロ・アウト」に変わるなど、
// 困っていない読み手の画面まで動いてしまう。
const STORED_LANG = 'ja';

// 走者イベントの text は内部キーそのもの。読み替え表だけ持つ
const RUNNER_KEY = {
  盗塁死: 'cs', 暴投: 'wp', 捕逸: 'pb', 牽制死: 'pickoff', 牽制: 'pickoffSafe', ボーク: 'balk',
};
const SB_DOUBLE = '盗塁(重盗)';
const COURTESY = /^臨時代走:/;

const multiOutKey = (n) => (n >= 3 ? 'log.tp' : n === 2 ? 'log.dp' : null);

// 打席・守備に共通の後置き(失策 / 好守 / 併殺 / 得点)
function suffixes(p, { t, lang, runsKey }) {
  const out = [];
  if (p.playError) out.push(t('log.err', { pos: positionLabel(p.playError.pos, lang) }));
  if (p.finePlay) out.push(t('log.fine', { pos: positionLabel(p.finePlay.pos, lang) }));
  const mo = multiOutKey(p.outsOnPlay || 0);
  if (mo) out.push(t(mo));
  if (p.runs) out.push(t(runsKey, { n: p.runs }));
  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * @param game  試合(相手の名前を引くのに使う)
 * @param log   playLog
 * @param ctx   { lang, t, nameOf, edition, omitWho }
 *              omitWho: 打者名・相手打者の見出しを付けない(名前を別の欄に出す画面用)
 * @returns     表示用の文
 */
export function renderPlayLog(game, log, ctx = {}) {
  const { lang = 'ja', t, nameOf, edition, omitWho = false } = ctx;
  const text = log?.text || '';
  // t が無ければ何もできない。保存された文をそのまま返す
  if (!t) return text;
  // 保存と同じ言語なら、保存された文がそのまま正しい(相手名の差し替えだけ効かせる)
  if (lang === STORED_LANG) return logTextOf(game, log);
  const p = log?.payload || {};

  switch (log?.kind) {
    case 'atbat': {
      if (!p.result) return text;
      const label = playLabel(p.result, p.direction, p.outType, p.soType, edition, lang,
        { hitAngle: p.hitAngle, intentional: p.intentional });
      const name = omitWho ? '' : (nameOf && nameOf(p.playerId)) || '';
      // batterTo は payload に無いので、保存された文の固定語から拾う
      const d3k = text.includes('振り逃げ') ? ' ' + t('log.dropped3') : '';
      return `${name ? name + ' ' : ''}${label}${suffixes(p, { t, lang, runsKey: 'log.runsFor' })}${d3k}`;
    }
    case 'defense': {
      // payload が無い古い守備ログ。記号→名前の差し替えだけは効かせる
      if (!p.result) return logTextOf(game, log);
      const label = playLabel(p.result, p.direction, p.outType, p.soType, edition, lang,
        { hitAngle: p.hitAngle, intentional: p.intentional });
      const who = omitWho ? '' : oppHead(game, p.letter, p.order, { t }) + ': ';
      return `${who}${label}${suffixes(p, { t, lang, runsKey: 'log.runsAgainst' })}`;
    }
    case 'sb':
      return t(text === SB_DOUBLE ? 'log.sbDouble' : 'log.sb');
    case 'runner': {
      const key = RUNNER_KEY[text];
      if (key) return t(`log.${key}`);
      // 臨時代走は名前が文に焼き込まれているので、payload から組み直す
      if (COURTESY.test(text) && p.playerId && p.courtesyFor && nameOf) {
        return t('log.courtesy', { name: nameOf(p.playerId), for: nameOf(p.courtesyFor) });
      }
      return text;
    }
    case 'run':
      return t('log.run');
    case 'change':
      return t('log.change');
    case 'flow':
      return t(p.dir === 'down' ? 'log.flowDown' : 'log.flowUp');
    case 'note':
      return p.memo ? `📝 ${t('log.memo')}: ${p.memo}` : text;
    default:
      return text;
  }
}

// 相手打者の見出し。名前が入っていればそちらを使う
function oppHead(game, letter, order, { t }) {
  const name = letter && game?.oppNames?.[letter];
  return name ? t('log.oppNamed', { name, order }) : t('log.oppBatter', { letter, order });
}

