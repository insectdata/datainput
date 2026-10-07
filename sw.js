/* 画面のファイルを端末に保持して、圏外でも開けるようにする。
 * 業務ファイル（スマホ用.json）はここでは扱わない。あれは IndexedDB に入る。
 * 画面を更新したら VERSION を上げる。 */
const VERSION = "konchu-input-v50";
const TILES = "gsi-tiles";   // 地理院の地図（現地記録の画面で貯める）。版を上げても消さない
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./genchi.html", "./genchi.js", "./draw.html", "./draw.js", "./lib/leaflet/leaflet.js", "./lib/leaflet/leaflet.css"];

self.addEventListener("install", (e) => {
  // 公開サイト（GitHub Pages）は 10 分ほど古いファイルを返すことがあるので、版の印を付けて取りに行き、
  // ブラウザのキャッシュも通さない。保存は印なしの URL で（fetch 時は ignoreSearch で引く）
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    for (const u of SHELL) {
      const res = await fetch(new Request(u + "?v=" + VERSION, { cache: "reload" }));
      if (!res.ok) throw new Error(u + " " + res.status);
      await c.put(u, res);
    }
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 地理院の地図: 貯めてあればそれを使い、無ければ取りに行って貯める（圏外で見るため）
  // 環境省の植生図のタイル（他所から読めない形＝中身の見えない控え。画像として出すだけなので足りる）
  if (url.hostname === "www.biodic.go.jp" && url.pathname.startsWith("/kiso/vg/tile/")) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try { const res = await fetch(e.request); if (res.ok || res.type === "opaque") c.put(e.request.url, res.clone()); return res; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // 産総研の地質図の画像（凡例の Web API は貯めない。圏外は画面が貯めた画像の色から引く）
  if (url.hostname === "cyberjapandata.gsi.go.jp" || (url.hostname === "gbank.gsj.jp" && url.pathname.includes("/tiles/"))) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try { const res = await fetch(e.request.url, { mode: "cors" }); if (res.ok) c.put(e.request.url, res.clone()); return res; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // 画面のファイルは 端末の控えからすぐ出す（電波が弱くても待たない。祝 2026-10-04「切り替えがたまに遅い」）。
  // 新しい版は この sw.js が変わったときに裏で入れ替わり（install で新しい控えを作る）、画面に「新しい版があります」と出す
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
