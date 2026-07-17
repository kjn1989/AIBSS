// i18n辞書のキー整合チェック(相互アップデートの安全装置)
// ja と en のキー集合が完全一致しなければ exit 1 で失敗させる。
// npm test に組み込まれており、片方の言語だけキーを追加した状態では
// テストが通らない=リリースできない、を機械的に保証する。
// 実行: node scripts/check-i18n.mjs
import { MESSAGES, LANGS } from '../src/lib/i18n.js';

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

process.exit(failed ? 1 : 0);
