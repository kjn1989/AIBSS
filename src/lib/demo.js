// ============================================================
// ダミーデータ生成(第1段階の動作確認・デモ用)
// 設定画面から投入/削除できる。実データと同一スキーマ。
// ============================================================
import { newPlayer, newGame, newAtBat, newPlayLog, newPitchingRecord, newPitch, uid } from './model.js';

const NAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田'];
const RESULT_POOL = [
  'single', 'single', 'single', 'single', 'double', 'double', 'triple', 'hr',
  'out', 'out', 'out', 'out', 'out', 'out', 'out', 'so', 'so', 'bb', 'bb', 'hbp', 'error', 'sacBunt', 'sacFly',
];
const DIRS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

// シード付き乱数(毎回同じデモデータになるように)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoData() {
  const rand = mulberry32(20260702);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const players = NAMES.map((n, i) => ({ ...newPlayer(n, String(i + 1)), id: 'demo-p' + i }));
  const games = [];

  for (let gi = 0; gi < 3; gi++) {
    const g = newGame({ opponent: ['レッドスターズ', 'ブルーウェーブス', 'グリーンホークス'][gi], isHome: gi % 2 === 0 });
    g.id = 'demo-g' + gi;
    g.date = `2026-0${4 + gi}-1${gi + 2}`;
    g.status = 'finished';
    g.lineup = players.slice(0, 9).map((p, i) => ({ order: i + 1, playerId: p.id, position: ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'][i] }));
    g.usedPlayerIds = players.slice(0, 9).map((p) => p.id);

    let myScore = 0;
    let oppScore = 0;
    // 7イニング分の打席を生成
    for (let inning = 1; inning <= 7; inning++) {
      let outs = 0;
      const runners = { 1: false, 2: false, 3: false };
      let batterIdx = ((inning - 1) * 4) % 9;
      // 相手の得点(ランダム)
      if (rand() < 0.3) oppScore += 1 + Math.floor(rand() * 2);

      while (outs < 3) {
        const p = players[batterIdx % 9];
        batterIdx++;
        const result = pick(RESULT_POOL);
        const scoreDiff = myScore - oppScore;
        const ab = newAtBat({
          gameId: g.id,
          playerId: p.id,
          order: (batterIdx % 9) + 1,
          snapshot: { runners: { ...runners }, outs, inning, isTop: !g.isHome, scoreDiff },
        });
        ab.id = uid();
        ab.result = result;
        ab.direction = ['bb', 'hbp', 'so'].includes(result) ? null : pick(DIRS);
        // 投球を模擬生成
        const nPitches = 1 + Math.floor(rand() * 6);
        for (let k = 0; k < nPitches - 1; k++) ab.pitches.push(newPitch(rand() < 0.5 ? 'ball' : 'strike'));
        ab.pitches.push(newPitch(['bb', 'hbp', 'so'].includes(result) ? (result === 'so' ? 'strike' : 'ball') : 'inplay'));
        ab.pitchCount = ab.pitches.length;
        ab.firstPitch = ab.pitches[0].type;
        ab.firstPitchHit = ab.pitchCount === 1 && ab.firstPitch === 'inplay' && ['single', 'double', 'triple', 'hr'].includes(result);

        // 走者の動きを簡易シミュレート
        let runs = 0;
        const isHit = ['single', 'double', 'triple', 'hr'].includes(result);
        const isOut = ['out', 'so'].includes(result);
        if (isHit || result === 'error' || result === 'bb' || result === 'hbp') {
          const bases = result === 'hr' ? 4 : result === 'triple' ? 3 : result === 'double' ? 2 : 1;
          for (let b = 3; b >= 1; b--) {
            if (runners[b]) {
              const nb = b + bases;
              runners[b] = false;
              if (nb >= 4) {
                runs++;
                g.playLogs.push(newPlayLog({ gameId: g.id, inning, isTop: !g.isHome, kind: 'run', text: '生還', payload: { playerId: players[(batterIdx + b) % 9].id } }));
              } else runners[nb] = true;
            }
          }
          if (bases >= 4) {
            runs++;
            g.playLogs.push(newPlayLog({ gameId: g.id, inning, isTop: !g.isHome, kind: 'run', text: '本塁打で生還', payload: { playerId: p.id } }));
          } else runners[Math.min(bases, 3)] = true;
        } else if (result === 'sacFly' && runners[3]) {
          runners[3] = false;
          runs++;
          outs++;
          g.playLogs.push(newPlayLog({ gameId: g.id, inning, isTop: !g.isHome, kind: 'run', text: '犠飛で生還', payload: { playerId: players[(batterIdx + 3) % 9].id } }));
        } else if (result === 'sacBunt') {
          for (let b = 3; b >= 1; b--) {
            if (runners[b] && b < 3) { runners[b + 1] = true; runners[b] = false; }
          }
          outs++;
        } else if (isOut) {
          outs++;
          const hadRunners = ab.snapshot.runners[1] || ab.snapshot.runners[2] || ab.snapshot.runners[3];
          if (result === 'out' && hadRunners) {
            ab.advSuccess = rand() < 0.4;
            if (ab.advSuccess) {
              for (let b = 3; b >= 1; b--) {
                if (runners[b] && b < 3 && !runners[b + 1]) { runners[b + 1] = true; runners[b] = false; }
              }
            }
          }
        }
        ab.rbi = runs - (result === 'error' ? runs : 0);
        ab.runsOnPlay = runs;
        // クラッチ判定
        if (runs > 0 && ab.rbi > 0) {
          const before = scoreDiff;
          const after = scoreDiff + runs;
          if (before < 0 && after > 0) ab.clutch = 'comeback';
          else if (before === 0 && after > 0) ab.clutch = myScore === 0 && oppScore === 0 ? 'first' : 'goahead';
          else if (before < 0 && after === 0) ab.clutch = 'tie';
        }
        myScore += runs;
        g.atBats.push(ab);
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning, isTop: !g.isHome, kind: 'atbat',
          text: `${p.name}: ${result}`, payload: { atBatId: ab.id, playerId: p.id, result },
        }));
        if (outs >= 3) break;
        // たまに盗塁
        if (runners[1] && rand() < 0.15) {
          runners[1] = false; runners[2] = true;
          g.playLogs.push(newPlayLog({ gameId: g.id, inning, isTop: !g.isHome, kind: 'sb', text: '盗塁成功', payload: { playerId: players[batterIdx % 9].id } }));
        }
      }
    }
    g.myScore = myScore;
    g.oppScore = oppScore;

    // 投手記録(先発+リリーフ)
    const starter = newPitchingRecord({ gameId: g.id, playerId: players[0].id, appearanceOrder: 1 });
    starter.outsRecorded = 15;
    starter.runs = Math.min(oppScore, 3);
    starter.earnedRuns = Math.max(0, starter.runs - (rand() < 0.3 ? 1 : 0));
    starter.hitsAllowed = 3 + Math.floor(rand() * 4);
    starter.walks = Math.floor(rand() * 3);
    starter.hitByPitch = rand() < 0.3 ? 1 : 0;
    starter.strikeouts = 3 + Math.floor(rand() * 5);
    starter.pitches = 70 + Math.floor(rand() * 30);
    starter.abFaced = 15 + starter.hitsAllowed; // アウト15+被安打(近似)
    starter.win = myScore > oppScore;

    const reliever = newPitchingRecord({ gameId: g.id, playerId: players[9 + (gi % 3)].id, appearanceOrder: 2 });
    reliever.outsRecorded = 6;
    reliever.runs = Math.max(0, oppScore - starter.runs);
    reliever.earnedRuns = reliever.runs;
    reliever.hitsAllowed = Math.floor(rand() * 3);
    reliever.walks = Math.floor(rand() * 2);
    reliever.strikeouts = 1 + Math.floor(rand() * 3);
    reliever.pitches = 20 + Math.floor(rand() * 15);
    reliever.abFaced = 6 + reliever.hitsAllowed;
    reliever.save = myScore > oppScore && myScore - oppScore <= 3;
    reliever.hold = !reliever.save && myScore > oppScore;
    g.pitchingRecords = [starter, reliever];
    games.push(g);
  }
  return { players, games };
}
