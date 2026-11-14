// ============================================================
// 使い方ムービー(基本編)を、実際のアプリを操作して収録する。
//
//   npm run build
//   node scripts/video/record.mjs                 # MP4 を作る
//   node scripts/video/record.mjs --shots         # 字幕ごとの静止画だけ(台本の確認用)
//   node scripts/video/record.mjs --out <dir>     # 出力先(既定: video-out/)
//
// 仕組み: dist/ に stage.html を置き、左にアプリ(iframe)、右に字幕を出すページを
// 1920x1080 で開く。Chrome の画面配信(CDP screencast)のコマ画像を保存し、
// ffmpeg で MP4 にする。アプリ本体には手を入れない(字幕もタップの印もステージ側)。
// 音声入力の章だけは、マイクの代わりに認識結果を流し込む(画面はスマホと同じ)。
//
// 日本語の字形をスマホに近づけるため、Noto Sans JP がシステムに入っていることを前提にする
// (無いと中国語字形のフォントに落ちる)。手順は scripts/video/prepare-fonts.py の冒頭。
// ============================================================
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots');
const outArg = args.indexOf('--out');
const OUT = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(root, 'video-out'));
const FRAMES = path.join(OUT, 'frames');
const PORT = 4390;
const URL_ = `http://localhost:${PORT}/`;

if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('dist/ がありません。先に npm run build を実行してください');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.copyFileSync(path.join(root, 'scripts/video/stage.html'), path.join(root, 'dist/_stage.html'));

function resolveChromium() {
  const base = '/opt/pw-browsers';
  const candidates = [path.join(base, 'chromium')];
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (d.startsWith('chromium-')) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  }
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'ja-JP' });
page.on('dialog', (d) => d.accept()); // 試合終了の確認
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

// 音声入力の章のための、マイクの代わり。最後に作られた認識器に結果を流す
await page.addInitScript(() => {
  window.__sr = [];
  class MockSR {
    constructor() { window.__sr.push(this); }
    start() {}
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = MockSR;
  window.webkitSpeechRecognition = MockSR;
  window.__say = (text, final) => {
    const r = window.__sr.at(-1);
    const item = [{ transcript: text }];
    item.isFinal = !!final;
    r?.onresult?.({ resultIndex: 0, results: [item] });
    if (final) r?.onend?.();
  };
});

await page.goto(URL_ + '_stage.html', { waitUntil: 'load' });
await page.evaluate(() => stage.card(' ')); // 準備中はカードで隠す
await page.waitForTimeout(1500);
const app = page.frameLocator('#app');
const appFrame = () => page.frames().find((f) => f !== page.mainFrame());

// ---- 収録 ----
const frames = [];
let cdp = null;
if (!SHOTS) {
  cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(FRAMES, `f${String(n++).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
}

// ---- 操作の部品 ----
const W = (ms) => page.waitForTimeout(SHOTS ? Math.min(ms, 250) : ms);
let shotNo = 0;
const CHAPTERS = ['選手登録', '試合開始', 'オーダー', '打席の記録', '音声入力', '守備側の記録', '試合終了', '結果と成績'];
const chapter = (i) => page.evaluate(([l, i]) => stage.chapters(l, i), [CHAPTERS, i]);

// 字幕を出して、読める時間だけ待つ
async function cap(kicker, title, body = '', hold = 2600) {
  await page.evaluate((c) => stage.caption(c), { kicker, title, body });
  await page.waitForTimeout(350);
  if (SHOTS) {
    shotNo += 1;
    await page.screenshot({ path: path.join(OUT, `s${String(shotNo).padStart(2, '0')}.png`) });
  }
  await W(hold);
}

const center = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('見えない要素を押そうとした');
  return [b.x + b.width / 2, b.y + b.height / 2];
};
// 押す場所に印を出してから押す
async function tap(loc, after = 700) {
  const [x, y] = await center(loc);
  await page.evaluate(([x, y]) => stage.tap(x, y), [x, y]);
  await page.waitForTimeout(160);
  await loc.click();
  await W(after);
}
async function tapAt(x, y, after = 700) {
  await page.evaluate(([x, y]) => stage.tap(x, y), [x, y]);
  await page.waitForTimeout(160);
  await page.mouse.click(x, y);
  await W(after);
}
async function typeIn(loc, text) {
  await tap(loc, 200);
  await loc.fill('');
  await loc.pressSequentially(text, { delay: SHOTS ? 0 : 110 });
  await W(500);
}
// 画面の中を滑らかにスクロールして、要素を見せる
async function reveal(loc, block = 'center') {
  await loc.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
  await W(900);
}
const toTop = async () => {
  await appFrame().evaluate(() => {
    document.querySelectorAll('.main').forEach((e) => e.scrollTo({ top: 0, behavior: 'smooth' }));
    scrollTo({ top: 0, behavior: 'smooth' });
  });
  await W(700);
};
// 早送りの区間は幕で隠し、その間のコマは仕上げで短く詰める(幕を数十秒見せても仕方がない)
const squeezes = [];
let squeezeFrom = null;
async function coverOn(title, body = '') {
  await page.evaluate(([t, b]) => stage.cover(t, b), [title, body]);
  await W(900); // 幕が下りきるところまでは普通に見せる
  squeezeFrom = frames.length;
}
async function coverOff(seconds = 1.6) {
  squeezes.push([squeezeFrom, frames.length, seconds]);
  await page.evaluate(() => stage.cover(null));
}
const nav = (label) => app.locator(`nav button:has-text("${label}")`);
const btn = (text) => app.locator(`button:has-text("${text}")`).first();
const exactBtn = (name) => app.getByRole('button', { name, exact: true }).first();
const sheetOk = () => app.locator('.sheet-actions button:has-text("確定")').first();
const padBtn = (label) => app.locator(`.result-pad button:has-text("${label}")`).first();
const chip = (pos) => app.locator(`.field-pad button.field-pos:has-text("${pos}")`).first();
const inningLabel = () => app.locator('.led-inn').first().innerText().then((s) => (s.match(/\d+回[表裏]/) || [''])[0]).catch(() => '');

// 早送り用(幕の裏で手早く進める)
async function quickPlay(label, pos = null) {
  await padBtn(label).click();
  await page.waitForTimeout(250);
  if (pos) {
    const c = app.locator('.pad-coach button');
    if (await c.count()) { await c.click(); await page.waitForTimeout(120); }
    await chip(pos).click();
    await page.waitForTimeout(750);
  }
  const ok = sheetOk();
  if (await ok.count()) { await ok.click(); await page.waitForTimeout(350); }
}
// 半回を終わらせる(3アウトまで凡打と三振を足す。三振だけだと投手成績が不自然になる)
const OUTS = [['凡打(アウト)', '遊'], ['三振'], ['凡打(アウト)', '中'], ['凡打(アウト)', '二']];
let outNo = 0;
async function closeHalf() {
  const start = await inningLabel();
  for (let i = 0; i < 4 && (await inningLabel()) === start; i++) {
    const [label, pos] = OUTS[outNo++ % OUTS.length];
    await quickPlay(label, pos || null);
  }
}

const t0 = Date.now();
if (cdp) {
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
}

// ============================================================
// 台本
// ============================================================

// ---- タイトル ----
await page.evaluate(() => stage.card(`
  <div class="eyebrow">HOW TO USE</div>
  <h1>AI-BASE DIAMOND</h1>
  <h2>使い方ガイド ── 基本の流れ</h2>
  <p>選手の登録から、試合の記録、成績を見るまで</p>`));
await W(4200);
await chapter(0);
await page.evaluate(() => stage.card(null));
await W(700);

// ---- 1. 選手登録 ----
await cap('STEP 1', 'チームと選手を登録', '右上の <em>⚙️</em> から設定を開きます。', 1600);
await tap(app.locator('button[aria-label="設定"]'), 900);
const teamName = app.locator('.card').filter({ hasText: 'チーム設定' }).locator('input').first();
await reveal(teamName);
await cap('STEP 1', 'チーム名を入れます', 'スコアボードや試合レポートに出る名前です。', 600);
await typeIn(teamName, 'グリーンホークス');
await W(700);
const addForm = app.locator('.add-form');
await reveal(addForm);
await cap('STEP 1', '選手は名前だけでOK', '背番号と投打は<em>任意</em>。あとから編集できます。', 600);
const roster = ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林', '佐藤'];
for (let i = 0; i < 2; i++) {
  await typeIn(addForm.locator('input[placeholder="選手名"]'), roster[i]);
  await typeIn(addForm.locator('input[placeholder="背番号"]'), String(i + 1));
  await tap(addForm.locator('button.primary'), 700);
}
await coverOn('残りの選手も同じように登録', '今回は10人を登録しました');
for (let i = 2; i < roster.length; i++) {
  await addForm.locator('input[placeholder="選手名"]').fill(roster[i]);
  await addForm.locator('input[placeholder="背番号"]').fill(String(i + 1));
  await addForm.locator('button.primary').click();
  await page.waitForTimeout(80);
}
await W(1600);
await reveal(app.locator('text=選手登録').first(), 'start');
await coverOff();
await cap('STEP 1', '登録できました', '登録した選手は一覧に並びます。<br>行をタップすると編集できます。', 2600);

// ---- 2. 試合開始 ----
await chapter(1);
await cap('STEP 2', '試合を始める', 'ホームの <em>新しい試合を開始</em> から。', 800);
await tap(nav('ホーム'), 800);
await tap(btn('新しい試合を開始'), 1000);
await cap('STEP 2', '決めるのは2つだけ', '<em>対戦相手</em> と <em>先攻・後攻</em>。<br>ほかは既定のままで大丈夫です。', 600);
await typeIn(app.locator('input[placeholder="対戦相手名"]'), 'レッドスターズ');
await tap(exactBtn('先攻'), 900);
await cap('STEP 2', '公式戦か練習試合か', '選んでおくと、あとで分けて集計できます（任意）。', 400);
await tap(exactBtn('公式戦'), 1200);
await reveal(app.locator('select').filter({ hasText: '草野球 7回制' }).first());
await cap('STEP 2', 'ルールはプリセットから', '回数・コールド・球数制限・時間制限。<br>連盟や大会に合わせて変えられます。', 2600);
const startBtn = app.locator('button:has-text("試合開始")').first();
await reveal(startBtn);
await tap(startBtn, 1200);
await cap('STEP 2', '今日のメンバーを選ぶ', '来ていない人を外しておくと、<br>打順の候補に出てこなくなります。', 2800);
await tap(app.locator('.sheet-actions button.primary'), 1200);

// ---- 3. オーダー ----
await chapter(2);
await toTop();
await cap('STEP 3', '打順と守備位置を決める', '<em>オーダー</em> タブで組みます。', 1000);
await tap(nav('オーダー'), 1000);
await cap('STEP 3', '打つ順にタップ', '「登録順に9人選択」でまとめて選ぶこともできます。', 600);
await tap(btn('登録順に9人選択'), 1200);
await tap(btn('次へ'), 1000);
await cap('STEP 3', '並べ替えもかんたん', '▲▼ やドラッグで打順を入れ替えます。', 1800);
await tap(btn('次へ'), 1000);
await cap('STEP 3', '守備位置はグラウンドの上で', '空いた位置は、打順に沿って自動で埋まります。', 2400);
await tap(btn('このオーダーで確定'), 1200);
await cap('STEP 3', '準備完了', '先発投手も自動で設定されました。', 2000);
await tap(nav('スコア入力'), 900);
await toTop();

// ---- 4. 打席の記録 ----
await chapter(3);
await cap('STEP 4', '1球ずつ、ボタンで記録', 'ボール・空振り・見逃し・ファウル。<br>球数は自動で数えます。', 600);
await tap(app.locator('.count-btns .ball'), 800);
await tap(app.locator('.count-btns .look'), 1200);
await cap('STEP 4', '打ったら、結果を選ぶ', 'ヒット、凡打、四球…', 400);
await tap(padBtn('ヒット'), 1400);
await cap('STEP 4', '打球が落ちたところを押す', 'フィールドの<em>どこでも</em>押せます。<br>方向と深さが一緒に記録されます。', 2400);
const coach = app.locator('.pad-coach button');
if (await coach.count()) await tap(coach, 700);
{
  // 中堅と右翼の間、少し深いところ
  const [cx, cy] = await center(chip('中'));
  const [rx, ry] = await center(chip('右'));
  await tapAt((cx + rx) / 2, (cy + ry) / 2 - 18, 1500);
}
await cap('STEP 4', '当たりの強さも残せます', 'ゴロ・ライナー・フライ × 強さ。<br>押さなければ、そのまま確定できます。', 400);
await tap(exactBtn('ライナー'), 1000);
await tap(sheetOk(), 1200);

await cap('STEP 4', '走者の進塁は自動で提案', '違っていたら、ここで直してから確定します。', 400);
await tap(padBtn('ツーベース'), 900);
await tap(chip('左'), 1500);
await reveal(app.locator('.sheet').last().locator('text=走者の動き').first());
await W(2200);
await tap(sheetOk(), 1200);

await cap('STEP 4', '得点も自動で入ります', 'スコアボードに反映され、打点も付きます。', 400);
await tap(padBtn('ヒット'), 900);
await tap(chip('右'), 1500);
await tap(sheetOk(), 1000);
await toTop();
await W(1600);

await cap('STEP 4', '三振・四球は自動で判定', '2ストライクから、もう1球ストライクで三振。', 400);
await tap(app.locator('.count-btns .swing'), 700);
await tap(app.locator('.count-btns .look'), 700);
await tap(app.locator('.count-btns .swing'), 1400);
await tap(btn('三振アウトで確定'), 1200);

// ---- 5. 音声入力 ----
await chapter(4);
await toTop();
await cap('STEP 5', '声でも記録できます', '🎙 を押して、実況するように話すだけ。', 600);
await tap(app.locator('button.voice-fab').first(), 1000);
const frame = appFrame();
for (const s of ['ライト', 'ライト前', 'ライト前ヒット']) {
  await frame.evaluate((s) => window.__say(s), s);
  await W(450);
}
await frame.evaluate(() => window.__say('ライト前ヒット', true));
await W(1200);
await cap('STEP 5', '確認して確定', '「はい」と言えば確定。<br>違えば「いいえ、〇〇」で言い直せます。', 2200);
await frame.evaluate(() => window.__say('はい', true));
await W(1800);
await toTop();
await cap('STEP 5', 'タップでも声でも、同じ記録になります', '手が離せないときは声で。', 1800);

await cap('', '3アウトで攻守交代', 'チェンジも自動です。', 400);
await tap(padBtn('凡打(アウト)'), 800);
await tap(chip('遊'), 1300);
await tap(sheetOk(), 900);
await tap(padBtn('凡打(アウト)'), 800);
await tap(chip('中'), 1300);
await tap(sheetOk(), 1200);
await toTop();
await W(1200);

// ---- 6. 守備側の記録 ----
await chapter(5);
await cap('STEP 6', '相手の攻撃も同じように', '相手打者の結果も記録できます。<br>次に当たるときの備えになります。', 600);
await tap(app.locator('.count-btns .ball'), 700);
await tap(padBtn('凡打(アウト)'), 800);
await tap(chip('左'), 1300);
await tap(sheetOk(), 1000);
await tap(padBtn('ヒット'), 800);
await tap(chip('中'), 1300);
await tap(sheetOk(), 1000);
await cap('STEP 6', '投手の球数も自動で', '投手ごとに数えて、制限に近づくと知らせます。', 400);
await tap(padBtn('三振'), 900);
const kOk = sheetOk();
if (await kOk.count()) await tap(kOk, 1000);
await tap(padBtn('凡打(アウト)'), 800);
await tap(chip('二'), 1300);
await tap(sheetOk(), 1200);
await toTop();

// ---- 早送り ----
await cap('', '5回まで早送りします', '記録のしかたは、ここまでと同じです。', 200);
await coverOn('5回まで早送り', '');
const halves = [
  // [自チームの攻撃, 相手の攻撃]
  [[['ヒット', '左'], ['凡打(アウト)', '二']], [['ツーベース', '右'], ['ヒット', '中'], ['凡打(アウト)', '遊']]],
  [[['四球'], ['ツーベース', '中'], ['ヒット', '右']], [['凡打(アウト)', '三']]],
  [[['凡打(アウト)', '中']], [['ヒット', '右'], ['ホームラン', '左']]],
  [[['ヒット', '中'], ['凡打(アウト)', '遊']], [['凡打(アウト)', '二']]],
];
for (const [ours, theirs] of halves) {
  for (const half of [ours, theirs]) {
    for (const [label, pos] of half) await quickPlay(label, pos || null);
    await closeHalf();
  }
}
await toTop();
await W(800);
await coverOff(2.0);
await W(600);

// ---- 7. 試合終了 ----
await chapter(6);
await cap('STEP 7', '試合を終える', '<em>試合終了</em> を押して確定します。<br>コールドや時間切れでも、勝手には終わりません。', 600);
const fin = btn('試合終了');
await reveal(fin);
await tap(fin, 1600);
await cap('STEP 7', 'ハイライトができあがり', '画像やテキストで、<br>チームのLINEにそのまま共有できます。', 3200);
await tap(app.locator('.sheet-overlay button:has-text("閉じる")').first(), 900);

// ---- 8. 結果と成績 ----
await chapter(7);
await cap('STEP 8', '試合レポート', 'スコア、決勝打、MVP、好投まで自動でまとまります。', 600);
await tap(nav('試合結果'), 1200);
await toTop();
await reveal(app.locator('text=試合レポート').first(), 'start');
await W(2400);
await toTop();
await cap('STEP 8', '試合の流れ', '1打席ごとに「勝つ確率」がどう動いたか。<br>どこで試合が動いたかが分かります。', 400);
await tap(btn('試合の流れを見る'), 2400);
await W(1600);
await tap(app.locator('.sheet-overlay button:has-text("閉じる")').first(), 900);
await cap('STEP 8', 'スコアシート', '紙のスコアブックと同じ形で。印刷もできます。', 400);
await tap(btn('スコアシートを開く'), 2600);
await W(1200);
await tap(btn('← 戻る'), 900);
await cap('STEP 8', '成績は自動で集計', '打率・出塁率・防御率…<br>試合が貯まるほど、チームの姿が見えてきます。', 400);
await tap(nav('成績'), 1400);
await toTop();
await W(1400);
await reveal(app.locator('table').first(), 'start');
await W(2200);
await toTop();

// ---- 終わり ----
await page.evaluate(() => stage.card(`
  <div class="eyebrow">AI-BASE DIAMOND</div>
  <h2 style="margin-top:0">iPhone・Android・PC のブラウザで、いますぐ使えます</h2>
  <div class="url">aibss.vercel.app</div>
  <p>くわしい使い方は「使い方ガイド」へ。<br>チームで記録を共有する方法も載っています。</p>`));
await W(5500);

if (cdp) await cdp.send('Page.stopScreencast');
const tEnd = Date.now();
await browser.close();
server.kill();
fs.rmSync(path.join(root, 'dist/_stage.html'), { force: true });

if (SHOTS) {
  console.log(`字幕ごとの静止画 ${shotNo} 枚: ${OUT}`);
  process.exit(0);
}

// ---- MP4 にする ----
// コマは画面が変わったときだけ来るので、次のコマまでの時間をそのコマの長さにする
// (届いた順に並んでいる。並べ替えると早送りの区間の番号がずれる)
const lastT = frames.at(-1).t + 1.0;
const dur = frames.map((f, i) => Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t : lastT) - f.t));
for (const [from, to, seconds] of squeezes) {
  const total = dur.slice(from, to).reduce((a, b) => a + b, 0);
  if (total > seconds) for (let i = from; i < to; i++) dur[i] *= seconds / total;
}
const list = ['ffconcat version 1.0'];
frames.forEach((f, i) => list.push(`file '${f.file}'`, `duration ${dur[i].toFixed(4)}`));
list.push(`file '${frames.at(-1).file}'`);
const listFile = path.join(OUT, 'frames.ffconcat');
fs.writeFileSync(listFile, list.join('\n'));
const mp4 = path.join(OUT, 'ai-base-diamond-howto-ja.mp4');
const r = spawnSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-movflags', '+faststart', mp4,
], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`${frames.length} コマ / 収録 ${((tEnd - t0) / 1000).toFixed(0)} 秒 → ${mp4}`);
