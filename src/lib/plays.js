// ============================================================
// プレイ確定支援: 結果種別と走者状況からデフォルトの進塁案を作る
// moves: [{ from: 1|2|3, to: 2|3|4|'out'|from(=とどまる) }]
// batterTo: 1|2|3|4|'out'|null(打者が塁に出ない結果)
// ============================================================
import { RESULTS } from './model.js';

export function proposeMoves(result, runners) {
  const on = { 1: !!runners[1], 2: !!runners[2], 3: !!runners[3] };
  const moves = [];
  const push = (from, to) => on[from] && moves.push({ from, to });

  switch (result) {
    case 'single':
      push(3, 4); push(2, 4); push(1, 2);
      return { moves, batterTo: 1 };
    case 'double':
      push(3, 4); push(2, 4); push(1, 3);
      return { moves, batterTo: 2 };
    case 'triple':
      push(3, 4); push(2, 4); push(1, 4);
      return { moves, batterTo: 3 };
    case 'hr':
      push(3, 4); push(2, 4); push(1, 4);
      return { moves, batterTo: 4 };
    case 'bb':
    case 'hbp':
    case 'interference': {
      // 押し出しのみ進塁
      if (on[1] && on[2] && on[3]) { push(3, 4); push(2, 3); push(1, 2); }
      else if (on[1] && on[2]) { push(2, 3); push(1, 2); }
      else if (on[1]) { push(1, 2); }
      return { moves, batterTo: 1 };
    }
    case 'error':
    case 'obstruction': // 走塁妨害: 打者走者は出塁が認められる(走者も1つ進塁を提案)
      push(3, 4); push(2, 3); push(1, 2);
      return { moves, batterTo: 1 };
    case 'fieldInterference': // 守備妨害: 打者(または走者)アウト。走者はとどまるを既定に
      return { moves: [], batterTo: 'out' };
    case 'sacBunt':
      push(3, 4); push(2, 3); push(1, 2);
      // 三塁走者はスクイズ時のみ生還だが、デフォルトは進塁させ手動調整可
      return { moves: moves.map((m) => (m.from === 3 ? { from: 3, to: 4 } : m)), batterTo: 'out' };
    case 'sacFly':
      push(3, 4);
      return { moves, batterTo: 'out' };
    case 'so':
      return { moves: [], batterTo: 'out' };
    case 'out':
    default:
      return { moves: [], batterTo: 'out' };
  }
}

// 打者の到達先候補(結果別)
export function batterDestOptions(result) {
  const def = RESULTS[result];
  if (!def) return [];
  switch (result) {
    case 'single': return [1, 2, 'out'];
    case 'double': return [2, 3, 'out'];
    case 'triple': return [3, 4, 'out'];
    case 'hr': return [4];
    case 'bb': case 'hbp': case 'interference': return [1];
    case 'error': return [1, 2, 3, 'out'];
    case 'obstruction': return [1, 2, 3]; // 走塁妨害: 進塁が認められた塁へ
    case 'fieldInterference': return ['out', 1]; // 守備妨害: 通常は打者アウト(保険で1塁も)
    case 'sacBunt': case 'sacFly': return ['out', 1];
    case 'so': return ['out', 1]; // 振り逃げ
    case 'out': return ['out', 1]; // 打撃妨害改訂等の保険
    default: return ['out'];
  }
}

// 走者の行き先候補
export function runnerDestOptions(from) {
  const opts = [];
  opts.push(from); // とどまる
  for (let b = from + 1; b <= 3; b++) opts.push(b);
  opts.push(4);
  opts.push('out');
  return opts;
}

export const DEST_LABEL = (from) => (to) => {
  if (to === 'out') return 'アウト';
  if (to === 4) return '生還';
  if (to === from) return 'そのまま';
  return `${['', '一', '二', '三'][to]}塁へ`;
};

// 進塁打の自動判定: 走者あり凡打で、走者が誰もアウトにならず1人以上進んだ
export function judgeAdvance(moves) {
  const anyOut = moves.some((m) => m.to === 'out');
  const anyAdvance = moves.some((m) => m.to !== 'out' && (m.to === 4 || m.to > m.from));
  return anyAdvance && !anyOut;
}
