/* 画面のファイルを端末に保持して、圏外でも開けるようにする。
 * 業務ファイル（スマホ用.json）はここでは扱わない。あれは IndexedDB に入る。
 * 画面を更新したら VERSION を上げる。 */
const VERSION = "konchu-input-v30";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
