import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのビルドが動いているかを画面で確認できるようにする(「直したのに反映されない」の切り分け用)。
// Vercel等のCIでは環境変数のコミットハッシュを使い、無ければローカルのgitから取る。
function buildInfo() {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  if (!sha) {
    try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { sha = ''; }
  }
  return { sha: sha.slice(0, 7), time: new Date().toISOString().slice(0, 16).replace('T', ' ') };
}

// firebase / supabase を専用チャンクに分離してアプリ本体の初期ロードを軽くする
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { __BUILD_INFO__: JSON.stringify(buildInfo()) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
        },
      },
    },
  },
});
