// ============================================================
// Capacitorネイティブラッパー用のブリッジ層
// Web(PWA)からは一切参照されない/no-opになるよう、常に isNativePlatform()
// でガードする。ネイティブビルド(iOS/Android)が無い開発中もこのファイルの
// import自体は安全(Capacitor.isNativePlatform()はブラウザではfalseを返す)。
// ============================================================
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

// ステータスバー・スプラッシュスクリーンの初期化(ネイティブのみ)。
// main.jsxから起動時に1回呼ぶ。失敗しても致命的ではないため握りつぶす。
export async function initNativeChrome() {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0d1117' });
  } catch {
    /* プラットフォーム未対応・権限なし等は無視 */
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }
}

// Androidの物理/ジェスチャー「戻る」ボタン。
// SPAなのでブラウザ履歴に依存せず、アプリ側で「ホームタブに戻る→それ以外で
// 押されたら最小化」という素朴なポリシーにする(誤操作でアプリごと終了しない)。
// 戻り値: 登録解除用のunsubscribe関数(ネイティブでなければ何もしないダミー)
export function registerBackButtonHandler(getIsHomeTab, goHome) {
  if (!isNative()) return () => {};
  let remove = () => {};
  import('@capacitor/app').then(({ App }) => {
    App.addListener('backButton', () => {
      if (!getIsHomeTab()) {
        goHome();
      } else {
        App.minimizeApp();
      }
    }).then((handle) => {
      remove = () => handle.remove();
    });
  });
  return () => remove();
}
