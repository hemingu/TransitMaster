import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Actions 上のビルド（GitHub Pages へのデプロイ）ではリポジトリ名
  // (TransitMaster) をベースパスにする。ローカル開発・プレビューでは '/' のまま。
  base: process.env.GITHUB_ACTIONS ? '/TransitMaster/' : '/',
})
