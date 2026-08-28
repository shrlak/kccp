import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from a GitHub Project Pages subpath (https://shrlak.github.io/kccp/), so assets,
// the router basename, and the PWA scope must all be prefixed with it — a root-based ('/')
// build 404s every asset under the subpath and renders blank.
//
// 저장소 이름이 kccp-attendance → kccp 로 바뀌면서 이 한 줄이 따라와야 했다. 안 고치면
// 빌드도 배포도 초록으로 끝나고 브라우저만 /kccp-attendance/… 를 찾다가 전부 404를 받는다:
// 화면은 하얗고 흔적은 콘솔에만 남는, 디버깅이 고약한 종류의 실패다. main.tsx의 basename과
// sw.ts의 스코프는 BASE_URL을 읽으므로 여기만 고치면 따라온다.
const base = '/kccp/'

const icons = [
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
]

// https://vite.dev/config/
export default defineConfig({
  base,
  build: {
    // The lazily-loaded heavyweights (SheetJS, Chart.js) legitimately exceed the default
    // 500 kB warning; the route chunks are what we actually watch, and they're far under it.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Two documents, one app. share.html is the iPhone home-screen entry — see the
      // comment at the top of that file for why it can't just be the /share SPA route.
      input: {
        main: resolve(__dirname, 'index.html'),
        share: resolve(__dirname, 'share.html'),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A hand-written worker (src/sw.ts) rather than a generated one: the Web Share Target
      // contract needs a `fetch` handler for the POST the OS sends when someone shares a
      // photo into the app, which generateSW can't express. Everything the generated worker
      // did (precache + auto-update) is reproduced there.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate', // fixes the stale-cache class of bug (legacy #37)
      includeAssets: ['icon-192.png', 'icon-512.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // SheetJS (~860 kB) and Chart.js (~200 kB) load only when someone exports or opens
        // 분석, so precaching them would re-download ~1 MB on every deploy for features most
        // sessions never touch. sw.ts runtime-caches them on first use instead.
        globIgnores: ['**/xlsx*', '**/chart-*'],
      },
      manifest: {
        name: 'KCCP 출석',
        short_name: 'KCCP 출석',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        icons,
        // Long-press the home-screen icon → jump straight to card registration or the
        // kiosk, skipping the landing page and the walk through the 새가족 tab.
        shortcuts: [
          { name: '새가족 카드 등록', short_name: '카드 등록', url: `${base}share`, icons },
          { name: '교회 키오스크', short_name: '키오스크', url: `${base}kiosk`, icons },
        ],
        // Web Share Target: registers the installed app in the phone's share sheet, so a
        // 새가족 카드 photo goes 사진 앱 → 공유 → KCCP 출석 without opening the site and
        // walking to 새가족 → 카드 사진 등록. The OS POSTs the files here; sw.ts answers.
        share_target: {
          action: `${base}share`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'photos',
                accept: ['image/*', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
              },
            ],
          },
        },
      },
    }),
    // vite-plugin-pwa injects its manifest link into *every* HTML entry, leaving
    // share.html declaring two manifests — and which one wins decides where the
    // home-screen icon lands, which is not something to bet an iPhone on. Strip the
    // injected one so share.html declares only its own. Must sit *after* VitePWA in
    // this array: both hooks are enforce/order 'post', so array order is what decides
    // who rewrites the HTML last.
    {
      name: 'kccp-share-manifest-only',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html: string, ctx: { filename?: string; path?: string }) {
          const id = ctx.filename ?? ctx.path ?? ''
          if (!id.endsWith('share.html')) return html
          return html.replace(/\s*<link rel="manifest" href="[^"]*\/manifest\.webmanifest"[^>]*>/g, '')
        },
      },
    },
  ],
})
