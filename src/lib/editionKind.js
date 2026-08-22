// エディションの中の区分。
//
//   ブカツ(中高大) … 中学 / 高校 / 大学   (学年管理と同じ settings.schoolType)
//   草野球         … 草野球 / 社会人・クラブ (settings.adultType)
//   少年野球       … 小学校のみ(選ばせない)
//
// 同じエディションでも、回数もコールドも球数制限も違う。呼び名も違う。
// ルールの既定・AIスポーツ新聞の言い方・ヘッダーの表示は、どれも
// 「エディション + 区分」で決まる。
//
// 保存先が2つ(schoolType / adultType)に分かれているのは、schoolType が
// 学年と卒業の判定にも使われている既存の設定で、そこに社会人の区分を
// 混ぜられないため。呼ぶ側が毎回どちらを見るか分岐しなくて済むよう、
// 読み書きはここに集める。
import { defaultSchoolType } from './year.js';

export const ADULT_TYPES = ['kusa', 'shakaijin'];
export const DEFAULT_ADULT_TYPE = 'kusa';

// そのエディションで選べる区分。1つしかないエディションでは選ばせない
export function kindsFor(edition) {
  if (edition === '草野球') return [...ADULT_TYPES];
  if (edition === 'ブカツ(中高大)') return ['junior', 'high', 'university'];
  if (edition === '少年野球') return ['elementary'];
  return [];
}

export function defaultKindFor(edition) {
  if (edition === '草野球') return DEFAULT_ADULT_TYPE;
  return defaultSchoolType(edition);
}

// いま選ばれている区分。未設定ならエディションの既定
export function kindOf(settings) {
  const ed = settings?.edition || '草野球';
  if (ed === '草野球') return settings?.adultType || DEFAULT_ADULT_TYPE;
  return settings?.schoolType || defaultSchoolType(ed);
}

// 区分を変えるときに書き換える設定のキー
export function kindPatch(edition, kind) {
  return edition === '草野球' ? { adultType: kind } : { schoolType: kind };
}

// 表示名のi18nキー。学校区分と社会人区分で辞書が分かれている
export const kindLabelKey = (kind) => (ADULT_TYPES.includes(kind) ? `adult.${kind}` : `school.${kind}`);
