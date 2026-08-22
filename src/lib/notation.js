// スコアシートの表記(右安・四球・三振 …)。
//
// 印刷用のスコアシートだけで使っていたが、スコア入力の画面でも「いま何が
// 起きたか」を同じ言葉で出したいので、共通の置き場に出した。
// 同じプレイが画面ごとに違う書き方になると、見比べたときに別のことに見える。
import { RESULTS, DIRECTIONS } from './model.js';

export function shortLabel(ab, edition, lang, t) {
  if (lang === 'en') {
    const d = ab.direction ? t(`dir.${ab.direction}`) : '';
    switch (ab.result) {
      case 'single': return `${d}1B`;
      case 'double': return `${d}2B`;
      case 'triple': return `${d}3B`;
      case 'hr': return `${d}HR`;
      case 'out': return `${d}${{ ground: 'GO', fly: 'FO', liner: 'LO', dp: 'DP' }[ab.outType] || 'GO'}`;
      case 'so': return ab.soType === 'looking' ? 'ꓘ' : 'K';
      case 'bb': return ab.intentional ? 'IBB' : 'BB';
      case 'hbp': return 'HBP';
      case 'error': return `${d}E`;
      case 'sacBunt': return 'SAC';
      case 'sacFly': return `${d}SF`;
      case 'interference': return 'INT';
      case 'obstruction': return 'OBS';
      case 'fieldInterference': return 'FINT';
      default: return RESULTS[ab.result]?.short || '';
    }
  }
  const dir = ab.direction ? DIRECTIONS[ab.direction][0] : '';
  const dpShort = edition === '少年野球' ? 'ゲ' : '併';
  switch (ab.result) {
    case 'single': return `${dir}安`;
    case 'double': return `${dir}2`;
    case 'triple': return `${dir}3`;
    case 'hr': return `${dir}本`;
    case 'out': return `${dir}${{ ground: 'ゴ', fly: '飛', liner: '直', dp: dpShort }[ab.outType] || 'ゴ'}`;
    case 'so': return ab.soType === 'looking' ? '見三振' : '三振';
    case 'bb': return ab.intentional ? '敬遠' : '四球';
    case 'hbp': return '死球';
    case 'error': return `${dir}エ`;
    case 'sacBunt': return '犠打';
    case 'sacFly': return `${dir}犠飛`;
    case 'interference': return '打妨';
    case 'obstruction': return '走妨';
    case 'fieldInterference': return '守妨';
    default: return RESULTS[ab.result]?.short || '';
  }
}
