import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// firebase / supabase を専用チャンクに分離してアプリ本体の初期ロードを軽くする
export default defineConfig({
  plugins: [react()],
  base: './',
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
