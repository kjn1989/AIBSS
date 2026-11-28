import { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { parseRosterText, lineupPositions } from '../lib/rosterPaste.js';
import { normalizeName } from '../lib/matchup.js';
import { positionLabel } from '../lib/model.js';
import Sheet from './Sheet.jsx';

// 名簿を貼り付けて、選手をまとめて登録する(lib/rosterPaste.js)。
// game を渡すと(まだ打席の無い試合)、その並びで打順と守備位置も組む。
export default function RosterPasteSheet({ game = null, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseRosterText(text), [text]);
  // 先頭の数字の意味。読み取りの推定を初期値にして、違えば切り替えられる
  const [numbersAs, setNumbersAs] = useState(null);
  const numbersAre = numbersAs || parsed.numbersAre;
  const asLineup = !!game && (game.atBats?.length || 0) === 0;
  const known = new Set(state.players.filter((p) => !p.archivedAt).map((p) => normalizeName(p.name)));

  const rows = parsed.rows.map((r) => ({
    ...r,
    // 「背番号」と読むなら先頭の数字を背番号へ、「打順」と読むなら背番号にはしない
    number: numbersAre === 'uniform' ? r.number : (parsed.numbersAre === 'uniform' ? '' : r.number),
  }));
  const pos = lineupPositions(rows);
  // 打順の外の先発投手(「投手 藤田」)。打順に「投」が居なければ先発として登録する
  const pitcher = parsed.pitcher && !pos.includes('投') ? parsed.pitcher : null;
  const newCount = [...rows, ...(pitcher ? [pitcher] : [])].filter((r) => !known.has(normalizeName(r.name))).length;

  const save = (withLineup) => {
    dispatch({ type: 'IMPORT_ROSTER', rows, pitcher, gameId: withLineup ? game.id : null });
    onClose();
  };

  return (
    <Sheet title={t('paste.title')} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('paste.note')}</p>
      <textarea
        className="paste-area"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('paste.placeholder')}
      />
      {rows.length > 0 && (
        <>
          {parsed.numbersAre !== 'none' && (
            <>
              <label className="small dim mt8" style={{ display: 'block' }}>{t('paste.numbersLabel')}</label>
              <div className="toggle-row" style={{ marginBottom: 8 }}>
                <button className={numbersAre === 'order' ? 'active' : ''} onClick={() => setNumbersAs('order')}>{t('paste.asOrder')}</button>
                <button className={numbersAre === 'uniform' ? 'active' : ''} onClick={() => setNumbersAs('uniform')}>{t('paste.asUniform')}</button>
              </div>
            </>
          )}
          <div className="section-title">{t('paste.preview', { n: rows.length })}</div>
          <div className="paste-preview">
            {rows.map((r, i) => (
              <div className="row" key={r.name}>
                <span className="rank-badge">{i + 1}</span>
                <div className="grow">
                  <b>{r.name}</b>
                  {r.number && <span className="small dim" style={{ marginLeft: 6 }}>#{r.number}</span>}
                </div>
                <span className="small">{positionLabel(asLineup ? pos[i] : r.position, lang) || '—'}</span>
                <span className={`pill ${known.has(normalizeName(r.name)) ? '' : 'blue'}`} style={{ marginLeft: 8 }}>
                  {t(known.has(normalizeName(r.name)) ? 'paste.known' : 'paste.new')}
                </span>
              </div>
            ))}
            {pitcher && (
              <div className="row">
                <span className="rank-badge">{t('paste.pitcherBadge')}</span>
                <div className="grow"><b>{pitcher.name}</b><span className="small dim" style={{ marginLeft: 6 }}>{t('paste.pitcherOut')}</span></div>
                <span className="small">{positionLabel('投', lang)}</span>
                <span className={`pill ${known.has(normalizeName(pitcher.name)) ? '' : 'blue'}`} style={{ marginLeft: 8 }}>
                  {t(known.has(normalizeName(pitcher.name)) ? 'paste.known' : 'paste.new')}
                </span>
              </div>
            )}
          </div>
          <p className="small dim mt8">{t(asLineup ? 'paste.lineupNote' : 'paste.registerNote', { n: newCount })}</p>
          {asLineup && game.lineup.length > 0 && <div className="warn-box mt8">{t('paste.replaceNote')}</div>}
        </>
      )}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        {asLineup ? (
          <button className="primary" disabled={!rows.length} onClick={() => save(true)}>{t('paste.saveLineup')}</button>
        ) : (
          <button className="primary" disabled={!rows.length} onClick={() => save(false)}>{t('paste.saveRegister', { n: newCount })}</button>
        )}
      </div>
    </Sheet>
  );
}
