/* 画面のファイルを端末に保持して、圏外でも開けるようにする。
 * 業務ファイル（スマホ用.json）はここでは扱わない。あれは IndexedDB に入る。
 * 画面を更新したら VERSION を上げる。 */
const VERSION = "konchu-input-v31";
const TILES = "gsi-tiles";   // 地理院の地図（現地記録の画面で貯める）。版を上げても消さない
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./genchi.html", "./genchi.js", "./lib/leaflet/leaflet.js", "./lib/leaflet/leaflet.css"];

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
  if (url.hostname === "cyberjapandata.gsi.go.jp") {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try { const res = await fetch(e.request.url, { mode: "cors" }); if (res.ok) c.put(e.request.url, res.clone()); return res; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // 画面のファイルは 先に取りに行き（新しい版をその場で出す。2026-10-04 祝「前の前の画面が出る」）、
  // 電波が無い・4 秒で返らないときは 端末の控えを出す（圏外で使うため）
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request, { cache: "no-cache" }).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
      return res;
    });
    if (!hit) return net;
    const late = new Promise((ok) => setTimeout(() => ok(hit), 4000));
    return Promise.race([net.catch(() => hit), late]);
  }));
});
