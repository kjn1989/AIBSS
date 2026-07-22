import React, { useEffect } from 'react';
import { useStore, useT } from '../state/store.jsx';

// 誤削除のセーフティ: 選手・試合・メンバーを削除した直後に「元に戻す」を数秒だけ表示。
// タップで直前の削除を復元(クラウド接続時はpushで再アップロードされ整合)。
export default function UndoSnackbar() {
  const { state, dispatch } = useStore();
  const t = useT();
  const d = state.lastDeleted;

  useEffect(() => {
    if (!d) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_DELETED' }), 6000);
    return () => clearTimeout(timer);
  }, [d]);

  if (!d) return null;
  return (
    <div className="undo-snackbar" role="status">
      <span className="undo-msg">{t('undo.deleted', { label: d.label || '' })}</span>
      <button className="undo-btn" onClick={() => dispatch({ type: 'RESTORE_DELETED' })}>{t('undo.restore')}</button>
    </div>
  );
}
