import React, { useEffect, useState } from 'react';
import { subscribePersistStatus, useT } from '../state/store.jsx';

// ============================================================
// 保存が失敗していることを知らせる帯。
//
// 端末の保存領域が一杯になると localStorage への書き込みが例外になる。
// 以前はそれを握りつぶしていたため、画面は普通に動くのに記録だけが
// 残らず、リロードした瞬間に試合が消えるという最悪の壊れ方をしていた。
// いまは IndexedDB を先に書いているので即座に失うわけではないが、
// 二重化が崩れた状態なので必ず知らせて、書き出しを促す。
// ============================================================
export default function PersistWarning() {
  const t = useT();
  const [status, setStatus] = useState({ ok: true, error: null });
  useEffect(() => subscribePersistStatus(setStatus), []);
  if (status.ok) return null;
  return (
    <div className="persist-warn" role="alert">
      <b>{t('persist.title')}</b>
      <span>{t(status.error === 'quota' ? 'persist.quota' : 'persist.unknown')}</span>
    </div>
  );
}
