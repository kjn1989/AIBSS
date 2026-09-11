// i18n辞書のキー整合チェック(相互アップデートの安全装置)
// ja と en のキー集合が完全一致しなければ exit 1 で失敗させる。
// npm test に組み込まれており、片方の言語だけキーを追加した状態では
// テストが通らない=リリースできない、を機械的に保証する。
// 実行: node scripts/check-i18n.mjs
import { MESSAGES, LANGS } from '../src/lib/i18n.js';
import fs from 'node:fs';
import path from 'node:path';

let failed = false;
const base = LANGS[0];
const baseKeys = new Set(Object.keys(MESSAGES[base]));

for (const lang of LANGS.slice(1)) {
  const keys = new Set(Object.keys(MESSAGES[lang] || {}));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  if (missing.length) {
    failed = true;
    console.error(`NG - [${lang}] に不足しているキー (${missing.length}件):`);
    for (const k of missing) console.error(`  - ${k}`);
  }
  if (extra.length) {
    failed = true;
    console.error(`NG - [${lang}] にだけ存在するキー (${extra.length}件):`);
    for (const k of extra) console.error(`  - ${k}`);
  }
  if (!missing.length && !extra.length) {
    console.log(`ok - ${base}/${lang} のキー整合 (${baseKeys.size}キー)`);
  }
}

// プレースホルダの整合({name}等が両言語で一致するか)も確認する
for (const key of baseKeys) {
  const ph = (s) => new Set([...(s.match(/\{[a-zA-Z0-9_]+\}/g) || [])]);
  const basePh = ph(MESSAGES[base][key]);
  for (const lang of LANGS.slice(1)) {
    const s = MESSAGES[lang]?.[key];
    if (s == null) continue; // 不足は上で検出済み
    const langPh = ph(s);
    const diff = [...basePh].filter((p) => !langPh.has(p)).concat([...langPh].filter((p) => !basePh.has(p)));
    if (diff.length) {
      failed = true;
      console.error(`NG - [${lang}] ${key} のプレースホルダ不一致: ${diff.join(', ')}`);
    }
  }
}

// ============================================================
// 同じキーを2回書いていないか
//
// JSのオブジェクトリテラルは後の定義が勝つので、二重定義は実行時には見えない。
// キー整合のチェックも通ってしまう(両言語に在るため)。実際に起きたのは
// AI選手名鑑の 'sc.title' が記録員カードの 'sc.title' と衝突して、
// 名鑑のヘッダーに「記録員の読み」と出た事故。
// 名前空間の取り合いは静かに壊れるので、ソースを直接見て弾く。
// ============================================================
{
  const src = fs.readFileSync(path.join('src', 'lib', 'i18n.js'), 'utf8');
  const lines = src.split('\n');
  // '  ja: {' / '  en: {' の行で言語ブロックを切る
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s{2}([a-z]{2}):\s*\{/);
    if (m) starts.push({ lang: m[1], line: i });
  });
  for (let b = 0; b < starts.length; b++) {
    const from = starts[b].line;
    const to = b + 1 < starts.length ? starts[b + 1].line : lines.length;
    const seen = new Map();
    const dup = [];
    for (let i = from; i < to; i++) {
      for (const m of lines[i].matchAll(/'([a-zA-Z][a-zA-Z0-9_.]*)':/g)) {
        const k = m[1];
        if (seen.has(k)) dup.push(`${k} (${starts[b].lang}: ${seen.get(k) + 1}行目 と ${i + 1}行目)`);
        else seen.set(k, i);
      }
    }
    if (dup.length) {
      failed = true;
      console.error(`NG - [${starts[b].lang}] キーの二重定義 (${dup.length}件):`);
      for (const d of dup) console.error(`  - ${d}`);
    } else {
      console.log(`ok - [${starts[b].lang}] キーの二重定義なし`);
    }
  }
}

// ============================================================
// ソースが使っているキーが、辞書に実在するか
//
// 未定義のキーは translate() が「キー名をそのまま」返す(i18n.js参照)。つまり
// 画面には sc.title のような文字列が出るだけで、例外にも日本語検査にも掛からない。
// キーの綴り間違いや、コンポーネントだけ足して辞書を忘れた場合を捕まえる。
// 動的なキー(t(`tag.${id}`) のようなテンプレート)は拾えないので、
// 静的な文字列リテラルだけを対象にする。
// ============================================================
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (/\.(jsx?|mjs)$/.test(e.name) && fp !== path.join('src', 'lib', 'i18n.js')) files.push(fp);
  }
})('src');

// t('key') / t("key") / translate(lang, 'key')
const USES = /(?:\bt\(|\btranslate\([^,)]+,\s*)['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;
const unknown = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(USES)) {
    const key = m[1];
    if (!key.includes('.')) continue; // 変数名等の誤検出を避ける(キーは必ず namespace.name)
    if (MESSAGES[base][key] != null) continue;
    if (!unknown.has(key)) unknown.set(key, f);
  }
}
if (unknown.size) {
  failed = true;
  console.error(`NG - 辞書に無いキーを使っている (${unknown.size}件):`);
  for (const [k, f] of unknown) console.error(`  - ${k}  (${f})`);
} else {
  console.log(`ok - ソースが使うキーはすべて辞書にある`);
}

process.exit(failed ? 1 : 0);
