import React, { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { liveShareGet } from '../lib/officialCloud.js';
import { isArchived } from '../lib/year.js';
import RosterPasteSheet from './RosterPasteSheet.jsx';
import TeamKitSheet from './TeamKitSheet.jsx';

// 新しいチームの立ち上げチェックリスト(管理者だけ)。
// 「次に何をすればいいか」を上から順に見せ、済んだものに ✓ を付ける。全部済むか、閉じると出なくなる。
// 済んだかどうかはアプリが見て判断する(選手が居るか・観戦リンクがあるか・記録係が参加したか・案内を配ったか)
const key = (teamId, what) => `teamSetup:${what}:${teamId}`;
const readFlag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writeFlag = (k) => { try { localStorage.setItem(k, '1'); } catch { /* 保存できなくても動く */ } };

export default function TeamSetupChecklist({ teamId, members }) {
  const { state } = useStore();
  const t = useT();
  const [live, setLive] = useState(undefined);
  const [sent, setSent] = useState(() => readFlag(key(teamId, 'sent')));
  const [hidden, setHidden] = useState(() => readFlag(key(teamId, 'hidden')));
  const [paste, setPaste] = useState(false);
  const [kit, setKit] = useState(false);

  useEffect(() => {
    let alive = true;
    liveShareGet(teamId).then((tk) => alive && setLive(tk || null), () => alive && setLive(null));
    return () => { alive = false; };
  }, [teamId, kit]);

  const players = state.players.filter((p) => !isArchived(p) && !String(p.id).startsWith('demo-')).length;
  const scorers = (members || []).filter((m) => m.role === 'scorer').length;
  const steps = [
    { k: 'team', done: true, label: t('setup.team') },
    { k: 'players', done: players > 0, label: players > 0 ? t('setup.playersN', { n: players }) : t('setup.players'),
      act: players > 0 ? null : { label: t('setup.playersBtn'), on: () => setPaste(true) } },
    { k: 'kit', done: sent, label: t('setup.kit'), act: { label: t('setup.kitBtn'), on: () => setKit(true) } },
    { k: 'live', done: !!live, label: t('setup.live') },
    { k: 'scorer', done: scorers > 0, label: scorers > 0 ? t('setup.scorerN', { n: scorers }) : t('setup.scorer') },
  ];
  const allDone = steps.every((s) => s.done);
  const markSent = () => { writeFlag(key(teamId, 'sent')); setSent(true); };

  return (
    <>
      {!hidden && !allDone && (
        <div className="setup-list">
          <div className="setup-head">
            <b>{t('setup.title')}</b>
            <button className="small ghost" onClick={() => { writeFlag(key(teamId, 'hidden')); setHidden(true); }}>{t('setup.hide')}</button>
          </div>
          {steps.map((s, i) => (
            <div key={s.k} className={`setup-step${s.done ? ' done' : ''}`}>
              <span className="setup-n">{s.done ? '✓' : i + 1}</span>
              <span className="grow">{s.label}</span>
              {s.act && !s.done && <button className="small primary" onClick={s.act.on}>{s.act.label}</button>}
            </div>
          ))}
          <p className="small dim" style={{ margin: '6px 0 0' }}>{t('setup.note')}</p>
        </div>
      )}
      {/* 済んでからも、案内はいつでも作り直せる(記録員リンクは14日で切れるので) */}
      <button className="primary mt8 kit-open" style={{ width: '100%' }} onClick={() => setKit(true)}>
        {t('kit.open')}<span className="small">{t('kit.openSub')}</span>
      </button>
      {paste && <RosterPasteSheet onClose={() => setPaste(false)} />}
      {kit && <TeamKitSheet teamId={teamId} onClose={() => setKit(false)} onSent={markSent} />}
    </>
  );
}
