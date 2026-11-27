import { useStore, useT } from '../state/store.jsx';
import { listProfiles } from '../lib/profiles.js';

// 進行中の試合が、観戦ページやほかの記録係に届いているかを、記録している画面に出す。
// 同じ名前のチームがこの端末に2つあり(片方はクラウド、片方はこの端末だけ)、
// この端末だけの方で試合を付けていたため、観戦ページが前の試合のまま、という事故があった。
// 届いていないときだけ出す(届いているときは「あなたが記録係です」の行がある)
export default function ShareStatus({ game }) {
  const { state } = useStore();
  const t = useT();
  if (!game || game.status !== 'ongoing' || String(game.id).startsWith('demo-')) return null;
  const linked = !!state.settings.officialTeamId;
  if (!linked) {
    // クラウドを一度も使っていない端末(1台で記録する人)には出さない
    const usesCloud = listProfiles().some((p) => p.officialTeamId);
    if (!usesCloud) return null;
    return <div className="warn-box mt8">{t('share.localOnly')}</div>;
  }
  if (state.cloudStatus === 'off') return <div className="warn-box mt8">{t('share.loggedOut')}</div>;
  if (state.cloudStatus === 'error') return <div className="warn-box mt8">{t('share.offline')}</div>;
  return null;
}
