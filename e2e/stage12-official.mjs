// 第12段階: AI-BSS公式クラウド(Firebaseエミュレータ使用)
// 前提: `npx firebase-tools@13 emulators:start --only auth,firestore --project demo-aibss` が起動済み
// 検証: ログイン → チーム登録 → データ自動アップロード → 招待リンク発行 →
//        別ユーザーが参加 → データ同期 → 双方向反映
import { chromium } from 'playwright-core';

const EMU_CONFIG = JSON.stringify({
  apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-aibss', appId: 'demo-app', emulator: true,
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function newAppPage(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => {
    localStorage.clear();
    localStorage.setItem('bbscorer.officialConfig', cfg);
  }, EMU_CONFIG);
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

// ---- 監督(owner)側 ----
const ownerCtx = await browser.newContext();
const owner = await newAppPage(ownerCtx);
const errs = [];
owner.on('pageerror', (e) => errs.push('owner: ' + e));

await owner.click('[aria-label="設定"]');
// 選手を2人登録(アップロード対象データ)
for (const name of ['青木', '木村']) {
  await owner.fill('input[placeholder="選手名"]', name);
  await owner.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}

// 公式クラウドカード: ログインUIが出る
await owner.waitForSelector('text=Googleでログイン');
console.log('1. ログインUI表示: OK');

// エミュレータ用テストログイン(メール/パスワード)
await owner.evaluate(() => window.__aibssTestSignIn('coach@example.com'));
await owner.waitForSelector('text=このチームをクラウドに登録');
console.log('2. ログイン成功(coach@example.com): OK');

// チーム登録 → 同期開始
await owner.click('text=⬆ このチームをクラウドに登録');
await owner.waitForSelector('text=✅ 同期中', { timeout: 15000 });
console.log('3. チーム登録+同期開始: OK');
console.log('   自分のロール表示:', (await owner.textContent('.card:has(h2:has-text("公式クラウド")) .flex .small')).trim());

// 招待リンク発行(記録係)
await owner.click('text=🔗 記録係を招待');
await owner.waitForSelector('input[readonly]');
const inviteLink = await owner.inputValue('input[readonly]');
console.log('4. 招待リンク発行: OK', inviteLink.includes('?ct=') ? '(ct=トークン形式)' : '(!!形式異常)');

// ---- 記録係(scorer)側: 別ブラウザコンテキスト ----
const scorerCtx = await browser.newContext();
const scorer = await newAppPage(scorerCtx);
scorer.on('pageerror', (e) => errs.push('scorer: ' + e));

// 先にログインしてから招待リンクを開く(GoogleポップアップはヘッドレスでNGのため)
await scorer.evaluate(() => window.__aibssTestSignIn('recorder@example.com'));
await scorer.waitForTimeout(500);
await scorer.goto(inviteLink.replace(/^https?:\/\/[^/]+/, 'http://localhost:4173'), { waitUntil: 'networkidle' });
await scorer.waitForSelector('text=チームに参加 (AI-BSS公式クラウド)');
console.log('5. 招待リンク→参加オーバーレイ表示: OK');
await scorer.click('text=ログインして参加');
await scorer.waitForTimeout(2500); // 参加処理+リロード待ち
await scorer.waitForSelector('.app-header', { timeout: 10000 });

// 参加後: チーム名が同期され、選手データが取得されているはず
await scorer.waitForTimeout(2000); // 初回同期待ち
const headerSub = (await scorer.textContent('.app-header .sub')).trim();
console.log('6. 参加後のチーム名(マイチームのはず):', headerSub);
await scorer.click('[aria-label="設定"]');
await scorer.waitForSelector('text=青木', { timeout: 10000 });
console.log('7. 選手データが同期された(青木が見える): OK');

// ---- 双方向同期: scorerが選手を追加 → ownerに反映 ----
await scorer.fill('input[placeholder="選手名"]', '斎藤');
await scorer.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
await owner.waitForSelector('text=斎藤', { timeout: 15000 });
console.log('8. 双方向同期(斎藤がownerにも反映): OK');

// ---- メンバー一覧: ownerに2人見える ----
// (Firestoreのリアルタイム接続が張られたままなのでnetworkidleは使えない)
await owner.reload({ waitUntil: 'load' });
await owner.waitForSelector('[aria-label="設定"]');
await owner.click('[aria-label="設定"]');
await owner.waitForSelector('text=メンバー (2人)', { timeout: 15000 });
console.log('9. メンバー一覧2人(owner+scorer): OK');

// ---- セキュリティルール(拒否側): 部外者はチームデータを読めない ----
// エミュレータのREST APIで確認: 管理権限でチームIDを取得 → 部外者ユーザーのトークンでアクセス
const adminList = await (await fetch(
  'http://127.0.0.1:8080/v1/projects/demo-aibss/databases/(default)/documents/teams',
  { headers: { Authorization: 'Bearer owner' } } // エミュレータ管理バイパス(本番には存在しない)
)).json();
const teamDocName = adminList.documents?.[0]?.name;
const teamIdFromAdmin = teamDocName?.split('/').pop();

const signUp = await (await fetch(
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'outsider@example.com', password: 'aibss-test-pass', returnSecureToken: true }) }
)).json();

const probe = await fetch(
  `http://127.0.0.1:8080/v1/projects/demo-aibss/databases/(default)/documents/teams/${teamIdFromAdmin}/players`,
  { headers: { Authorization: `Bearer ${signUp.idToken}` } }
);
console.log('10. 部外者のチームデータ読取が拒否される(403が正):', probe.status === 403 ? 'OK' : `NG(status=${probe.status})`);

const writeProbe = await fetch(
  `http://127.0.0.1:8080/v1/projects/demo-aibss/databases/(default)/documents/teams/${teamIdFromAdmin}/players?documentId=hack`,
  { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${signUp.idToken}` }, body: JSON.stringify({ fields: { name: { stringValue: '侵入者' } } }) }
);
console.log('11. 部外者のチームデータ書込が拒否される(403が正):', writeProbe.status === 403 ? 'OK' : `NG(status=${writeProbe.status})`);

console.log('errors:', errs.length ? errs : 'none');
await browser.close();
