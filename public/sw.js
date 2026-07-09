/* オフライン対応 Service Worker
 * 方針:
 *  - HTML(ナビゲーション)は network-first。オンラインなら常に最新版のHTMLを
 *    取得し、それが指す新しいハッシュ付きJS/CSSも自然に最新化される。
 *    オフライン時のみキャッシュにフォールバック。
 *  - ハッシュ付きJS/CSS等その他アセットは stale-while-revalidate
 *    (ファイル名が内容ごとに変わるためキャッシュ優先で問題ない)。
 *  - Firestore 等の外部APIリクエストはキャッシュ対象外(SDK側が
 *    オフラインキューを持つため素通しする)。
 */
const CACHE = 'aibase-v1'; // リブランド時にキャッシュ名を更新(旧キャッシュはactivateで削除される)
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 同一オリジンの GET のみキャッシュ(Firestore/LLM API 等は素通し)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isHTML = e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached); // オフライン時はキャッシュのみ
      return cached || fetched;
    })
  );
});
