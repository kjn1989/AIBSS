// フィールド上の守備位置の座標(FieldPad と同系統の配置)。value は POSITIONS の値。
// スタメン設定ウィザードと、代打後の守備位置確認の両方で使う共通定義。
export const FIELD_SPOTS = [
  { value: '左', left: '16%', top: '30%' },
  { value: '中', left: '50%', top: '16%' },
  { value: '右', left: '84%', top: '30%' },
  { value: '遊', left: '34%', top: '46%' },
  { value: '二', left: '66%', top: '46%' },
  { value: '三', left: '18%', top: '63%' },
  { value: '一', left: '82%', top: '63%' },
  { value: '投', left: '50%', top: '66%' },
  { value: '捕', left: '50%', top: '89%' },
  { value: 'DH', left: '89%', top: '90%', label: '指' },
  { value: '打', left: '11%', top: '90%', label: '打', shared: true }, // 全員打ち(打撃のみ)。複数人可
];
