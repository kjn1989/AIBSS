import { useState } from 'react';
import { useT } from '../state/store.jsx';

// 長い説明は、ふだんは畳んでおいて「？」を押したときだけ出す。
// 画面ごとに説明文が並ぶと、必要な項目まで読み飛ばされる。
export default function Hint({ children, className = '' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <span className={`hint ${className}`}>
      <button type="button" className="hint-btn" aria-expanded={open} aria-label={t('hint.aria')} onClick={() => setOpen(!open)}>？</button>
      {open && <span className="hint-body small dim">{children}</span>}
    </span>
  );
}
