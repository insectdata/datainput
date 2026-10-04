/* 現地記録（重要種・確認種・環境を 地点・写真・GPS と一緒に記録する頁。試作品 2026-10-04）
 * 設計: 設計\現地記録の画面（写真・GPS・位置図）_2026-10-02.txt
 *   地点 … 位置は地点ごとに 1 度だけ測る（測り直す・位置を動かす・消す）。1 地点に記録と写真をいくつでも
 *   記録 … 区分（重要種・確認種・環境）・和名・個体数・方法・環境・確認された植物・メモ・写真
 *   地図 … 地理院（標準・航空写真）＋ 植生図 ＋ 業務の地図 ＋ 地点 ＋ 現在地。トラックは扱わない（ガーミンで取る）
 *          業務の地図は 業務ファイル（スマホ用.json）の genchiMap（業務フォルダの「地図」フォルダから作る）か、
 *          ☰ で読み込む ○○_現地記録用の地図.json（新しい方を使う）
 *   和名の索引は 種名の入力画面で読み込んだ業務ファイル（端末の konchu-input に入っている）を読むだけ
 * データは端末の IndexedDB（genchi-record）。書き出しは zip（地点の一覧.xlsx・入力データ.xlsx・シェープファイル・GPX・GeoJSON・
 * 写真・位置図（A4 縦。表題 業務名・季節・項目、重なった名前は引き出し線））。
 */
(() => {
"use strict";
const GENCHI_VERSION = "g18";
const $ = (s) => document.querySelector(s);
const el = (t, attrs = {}, ...kids) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
let toastTimer = null;
function toast(m, ms = 2600) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), ms); }
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
const KUBUN = ["重要種", "確認種", "要確認", "環境"];   // 要確認＝持ち帰って調べる（和名は仮でも空でもよい。集計の入力データに出さない）
const KCOLOR = { 重要種: "#c62828", 確認種: "#1565c0", 要確認: "#ef6c00", 環境: "#2e7d32" };
// 生息環境は 植生図の細分でなく おおまかな区分で（祝 2026-10-04）。植生図の凡例はこの区分に寄せて札の先頭に出す
const HABITATS = ["常緑広葉樹林", "落葉広葉樹林", "針葉樹林（植林）", "竹林", "低木林", "林縁", "イネ科草地", "広葉草地", "湿性草地", "ヨシ原",
  "河原", "水際", "水田", "畑", "果樹園", "水路", "池沼", "堤防法面", "人家周辺", "公園・緑地", "裸地・造成地"];
const METHODS = ["目視", "鳴き声", "捕獲", "トラップ", "無人撮影", "写真"];
// 確認したものの区分（成虫・幼虫・痕跡など。いくつでも）
const STAGES = ["成虫", "蛹", "幼虫", "卵", "成体", "幼体", "幼生", "成獣", "幼獣", "足跡", "糞", "食痕", "巣", "鳴き声", "死体", "脱皮殻"];
// メモの札（「イネ科植物 でスウィーピング」「セイタカアワダチソウ に訪花」のように 名詞＋動き で組む）
const MEMO_ACTS = ["でスウィーピング", "でビーティング", "で見つけ取り", "に訪花", "を吸蜜", "の葉上", "の樹幹", "の樹液", "の石下", "の朽木中",
  "で灯火に飛来", "の水中", "で鳴き声", "を目撃", "で捕獲"];
const MEMO_NOUNS = ["イネ科植物", "広葉草本", "樹林内", "林縁", "草地", "水際"];
function habitatOf(vegName) {
  const n = vegName || "";
  if (/植林|スギ|ヒノキ|マツ/.test(n)) return "針葉樹林（植林）";
  if (/竹|ササ/.test(n)) return "竹林";
  if (/シイ|カシ|タブ|ヤブツバキ|照葉|常緑/.test(n)) return "常緑広葉樹林";
  if (/クヌギ|コナラ|アカメガシワ|ヤナギ|ケヤキ|エノキ|ムクノキ|落葉|二次林/.test(n)) return "落葉広葉樹林";
  if (/ヨシ|ツルヨシ/.test(n)) return "ヨシ原";
  if (/ススキ|チガヤ|シバ|オギ|ネザサ|イネ科/.test(n)) return "イネ科草地";
  if (/水田/.test(n)) return "水田";
  if (/畑/.test(n)) return "畑";
  if (/果樹|茶/.test(n)) return "果樹園";
  if (/開放水域|水域/.test(n)) return "池沼";
  if (/自然裸地|河原/.test(n)) return "河原";
  if (/市街|住宅|工場|造成|道路/.test(n)) return /造成/.test(n) ? "裸地・造成地" : "人家周辺";
  if (/緑の多い|公園|ゴルフ/.test(n)) return "公園・緑地";
  if (/雑草|クズ|セイタカ|群落/.test(n)) return "広葉草地";
  return "";
}
const FIG_DEF = { 図の名前: "重要種等確認位置図", 項目: "陸上昆虫類", 背景: "標準地図", 植生: false, 拡大図: true };

// ---------------------------------------------------------------- 保存（IndexedDB）
const DB = { db: null };
function openDB() {
  return new Promise((ok, ng) => {
    const r = indexedDB.open("genchi-record", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("kv");
      d.createObjectStore("points", { keyPath: "id", autoIncrement: true });
      d.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => { DB.db = r.result; DB.db.onversionchange = () => DB.db.close(); ok(); };
    r.onerror = () => ng(r.error);
  });
}
const req = (store, mode, fn) => new Promise((ok, ng) => { const q = fn(DB.db.transaction(store, mode).objectStore(store)); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); });
const kvGet = (k) => req("kv", "readonly", (s) => s.get(k));
const kvSet = (k, v) => req("kv", "readwrite", (s) => s.put(v, k));
const putPoint = (p) => req("points", "readwrite", (s) => s.put(p));
const delPoint = (id) => req("points", "readwrite", (s) => s.delete(id));
const allPoints = () => req("points", "readonly", (s) => s.getAll());
const putPhoto = (p) => req("photos", "readwrite", (s) => s.put(p));
const getPhoto = (id) => req("photos", "readonly", (s) => s.get(id));
const delPhoto = (id) => req("photos", "readwrite", (s) => s.delete(id));

// 種名の入力画面の業務ファイル（konchu-input の kv）を読むだけ
function readMainBundle() {
  return new Promise((ok) => {
    const timer = setTimeout(() => ok({}), 5000);       // 開けないまま待ち続けない（ほかの画面が開いたままのときなど）
    const done0 = ok; ok = (v) => { clearTimeout(timer); done0(v); };
    const r = indexedDB.open("konchu-input");
    r.onblocked = () => ok({});
    // まだ種名の入力画面を開いていない端末では作らない（ここで空の入れ物を作ると 入力画面が保存できなくなる）
    r.onupgradeneeded = () => { r.transaction.abort(); };
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("kv")) { d.close(); ok({}); return; }
      const s = d.transaction("kv").objectStore("kv"), out = {}, keys = ["bundle", "axes", "masterBit"];
      let n = 0;
      const done = () => { if (++n === keys.length) { d.close(); ok(out); } };
      for (const k of keys) { const q = s.get(k); q.onsuccess = () => { out[k] = q.result; done(); }; q.onerror = done; }
    };
    r.onerror = () => ok({});
  });
}

// ---------------------------------------------------------------- 状態
const S = { bundle: null, axes: {}, masterBit: 1, mapdata: null, points: [], cur: null, editing: null, dirty: false,
  usage: {}, follow: false, allDays: false, listAll: false, listKubun: "", moving: false, fig: { ...FIG_DEF }, areas: [], jobPts: [] };
const today = () => ymd();
function skey(s) {
  let t = (s || "").normalize("NFKC").trim();
  t = t.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  t = t.replace(/[ 　・･\-‐—―_/／<>()（）]/g, "");
  return t.toLowerCase();
}
function marksOf(name) {
  const sp = S.byName && S.byName.get(name);
  const cols = (S.bundle && S.bundle.rdbCols) || [];
  const out = [];
  for (const [i, v] of (sp && sp[6]) || []) {
    const c = cols[i]; if (!c) continue;
    const alien = c[2] === "外来種";
    const head = alien ? "" : /^環境省/.test(c[1] || c[0]) ? "全" : (c[1] || c[0]).charAt(0);
    out.push({ text: head + v, alien, full: `${c[0]}: ${v}` });
  }
  return out;
}
const recLabel0 = (r) => r.区分 === "要確認" ? "要確認" + (r.和名 ? `: ${r.和名}?` : "") : r.和名 ? r.和名 + (marksOf(r.和名).length ? `（${marksOf(r.和名).map((m) => m.text).join("・")}）` : "") : (r.環境 ? "環境: " + r.環境.split(/[、,]/)[0] : "環境");
const recLabel = (r) => recLabel0(r) + (r.状態 ? " " + r.状態 : "");

// ---------------------------------------------------------------- 距離・方向・範囲
const R = 6371000;
function dist(a, b, c, d) { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; }
function bearing(a, b, c, d) { const r = Math.PI / 180, x = (d - b) * Math.cos((a + c) / 2 * r), y = c - a; const deg = (Math.atan2(x, y) / r + 360) % 360; return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][Math.round(deg / 45) % 8]; }
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function prepAreas() {
  S.areas = []; S.jobPts = [];
  if (!S.mapdata) return;
  for (const f of S.mapdata.地図.features) {
    const g = f.geometry, nm = f.properties.名前 || "";
    if (g.type === "Point") { S.jobPts.push({ name: nm, lon: g.coordinates[0], lat: g.coordinates[1] }); continue; }
    let ring = null;
    if (g.type === "Polygon") ring = g.coordinates[0];
    else if (g.type === "LineString") {
      const c = g.coordinates, a = c[0], b = c[c.length - 1];
      if (c.length > 3 && dist(a[1], a[0], b[1], b[0]) < 30) ring = c;
    }
    if (ring) S.areas.push({ name: nm, ring, buffer: /バッファ/.test(nm) });
  }
}
function whereIs(lat, lon) {
  const out = {};
  const main = S.areas.filter((a) => !a.buffer), buf = S.areas.filter((a) => a.buffer);
  if (main.length) {
    const inMain = main.find((a) => inRing(lon, lat, a.ring));
    if (inMain) out.範囲 = `${inMain.name}の中`;
    else if (buf.some((a) => inRing(lon, lat, a.ring))) out.範囲 = "範囲の外（バッファの中）";
    else out.範囲 = "範囲の外";
  }
  let best = null;
  for (const p of S.jobPts) { const d = dist(lat, lon, p.lat, p.lon); if (!best || d < best.d) best = { ...p, d }; }
  if (best && best.d < 5) out.近く = `${best.name} のすぐそば`;
  else if (best) out.近く = `${best.name} まで ${best.d < 1000 ? Math.round(best.d) + " m" : (best.d / 1000).toFixed(1) + " km"} ${bearing(best.lat, best.lon, lat, lon)}`;
  return out;
}

// ---------------------------------------------------------------- 地図
let map, baseStd, basePhoto, vegLayer, jobLayer, ptLayer, meMarker, meCircle, watchId = null, lastFix = null;
const GSI = { 標準地図: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", 航空写真: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg" };
const ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>';
// 環境省 生物多様性センター 現存植生図2024 ラスタタイル（G空間情報センター。公共データ利用規約 第1.0版。縮尺 15 まで）。
// 業務の地図に植生図が無いときに重ねる。画像なので凡例名は引けず、位置図にも描けない（そちらは業務ファイルの植生図）
const VEG_TILE = "https://www.biodic.go.jp/kiso/vg/tile/veg2024raster/{z}/{x}/{y}.png";
const VEG_ATTR = '植生: <a href="https://www.biodic.go.jp/" target="_blank">環境省生物多様性センター</a> 現存植生図2024';
const TILES = { ...GSI, 植生図: VEG_TILE };
let vegTiles = null;
const vegNow = () => vegLayer || vegTiles;     // いま使う植生（業務ファイルの植生図が先）
function vegColor(p) {
  const n = p.凡例名 || "";
  if (/市街|住宅|造成|工場|道路|人工/.test(n)) return "#bdbdbd";
  if (/水田/.test(n)) return "#b3e5fc";
  if (/畑|果樹|茶/.test(n)) return "#ffe082";
  if (/植林/.test(n)) return "#1b5e20";
  if (/竹/.test(n)) return "#9e9d24";
  if (/開放水域|水域/.test(n)) return "#4fc3f7";
  if (/雑草|草地|群落|ヨシ|オギ|ススキ|クズ/.test(n)) return "#c5e1a5";
  return "#66bb6a";
}
function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([33.0, 130.7], 13);
  baseStd = L.tileLayer(GSI.標準地図, { maxZoom: 20, maxNativeZoom: 18, attribution: ATTR });
  basePhoto = L.tileLayer(GSI.航空写真, { maxZoom: 20, maxNativeZoom: 18, attribution: ATTR });
  baseStd.addTo(map);
  ptLayer = L.layerGroup().addTo(map);
  $("#t-layer").onclick = () => {
    const photo = map.hasLayer(baseStd);
    map.removeLayer(photo ? baseStd : basePhoto); (photo ? basePhoto : baseStd).addTo(map);
    $("#t-layer").textContent = photo ? "地図" : "写真";
  };
  vegTiles = L.tileLayer(VEG_TILE, { maxNativeZoom: 15, maxZoom: 20, opacity: 0.5, attribution: VEG_ATTR });
  $("#t-veg").onclick = () => {
    const v = vegNow(), on = map.hasLayer(v);
    if (on) map.removeLayer(v); else { v.addTo(map); if (v.bringToBack && v === vegLayer) v.bringToBack(); }
    $("#t-veg").classList.toggle("on", !on);
    if (!on && v === vegTiles) toast("環境省の植生図（タイル）を重ねました。凡例名は業務ファイルの植生図があるときだけ引けます", 3500);
  };
  $("#t-gps").onclick = () => setFollow(!S.follow);
  $("#t-fit").onclick = () => fitJob();
  $("#t-day").onclick = () => { S.allDays = !S.allDays; $("#t-day").textContent = S.allDays ? "全部の日" : "今日だけ"; drawPoints(); };
  // 地図の真ん中の＋（map.getCenter() と同じ所。離れた場所に地点を落とすとき）
  map.getContainer().append(el("div", { id: "cross" }));
  const setCross = (onn) => { document.body.classList.toggle("cross", onn); $("#t-cross").classList.toggle("on", onn); $("#btn-cross").style.display = onn ? "" : "none"; kvSet("cross", onn); };
  $("#t-cross").onclick = () => setCross(!document.body.classList.contains("cross"));
  S.setCross = setCross;
}
function fitJob() {
  const b = S.mapdata && S.mapdata.範囲;
  if (b) map.fitBounds([[b[1], b[0]], [b[3], b[2]]]);
  else if (S.points.length) map.fitBounds(L.latLngBounds(S.points.map((p) => [p.lat, p.lon])).pad(0.3));
}
function applyMapdata(md) {
  S.mapdata = md || null;
  if (vegLayer) map.removeLayer(vegLayer);
  if (jobLayer) map.removeLayer(jobLayer);
  vegLayer = jobLayer = null;
  prepAreas();
  if (vegTiles) map.removeLayer(vegTiles);
  // 植生図: 業務ファイルの植生図 → 端末に保存した環境省の植生図（ジオポータル）→ 環境省のタイル（画像。凡例名は引けない）
  const mdVeg = md && md.植生図 && md.植生図.features.length ? md.植生図 : null;
  S.vegFC = mdVeg || (S.vegSaved && S.vegSaved.features.length ? S.vegSaved : null);
  if (S.vegFC) vegLayer = L.geoJSON(S.vegFC, {
    style: (f) => ({ color: "#555", weight: 0.5, fillColor: vegColor(f.properties), fillOpacity: 0.35 }),
    onEachFeature: (f, ly) => ly.on("click", (e) => {
      if (S.moving) return;
      const p = f.properties, pl = ((md && md.凡例の植物) || {})[String(p.凡例コード)];
      L.popup().setLatLng(e.latlng).setContent(`<b>${p.凡例名}</b>` + (pl ? `<br>主な植物（調査地点 ${pl.調査地点数}）: ${pl.植物.slice(0, 6).map((x) => `${x[0]}(${Math.round(x[1])}%)`).join("・")}` : "<br>調査の地点なし")).openOn(map);
    }),
  });
  if ($("#t-veg").classList.contains("on")) (vegLayer || vegTiles).addTo(map);
  if (!md) { $("#map-info").textContent = "まだ入っていません（業務ファイルに地図が無い）" + (S.vegSaved ? `。保存した植生図 ${S.vegSaved.features.length} ポリゴン` : ""); if (vegLayer && map.hasLayer(vegLayer)) vegLayer.bringToBack(); return; }
  jobLayer = L.geoJSON(md.地図, {
    style: (f) => (f.geometry.type === "Point" ? {} : { color: f.properties.色 || "#1565c0", weight: 3, fill: false, dashArray: /バッファ/.test(f.properties.名前) ? "6 6" : null }),
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: "#333", weight: 1.5, fillColor: "#ffd600", fillOpacity: 1 })
      .bindTooltip(f.properties.名前, { permanent: true, direction: "right", className: "lbl", offset: [6, 0] }),
    onEachFeature: (f, ly) => { if (f.geometry.type !== "Point") ly.bindTooltip(f.properties.名前, { sticky: true }); },
  }).addTo(map);
  if (vegLayer && map.hasLayer(vegLayer)) vegLayer.bringToBack();
  $("#map-info").textContent = `${md.業務}（作成 ${md.作成}・地図 ${md.地図.features.length}・植生図 ${(md.植生図 || { features: [] }).features.length}）` + (S.vegSaved ? `。保存した植生図 ${S.vegSaved.features.length}` : "");
}
function vegAt(lat, lon) {
  if (!S.vegFC) return null;
  for (const f of S.vegFC.features) {
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const pg of polys) if (inRing(lon, lat, pg[0]) && !pg.slice(1).some((h) => inRing(lon, lat, h))) return f.properties;
  }
  return null;
}
function vegNear(lat, lon) {
  const out = [], d = 40 / 111000;
  for (const [a, b] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
    const p = vegAt(lat + a, lon + b / Math.cos(lat * Math.PI / 180));
    if (p && !out.includes(p.凡例名)) out.push(p.凡例名);
  }
  return out;
}

// ---------------------------------------------------------------- 現在地
// 位置が取れないわけを日本語で（地図の範囲とは関係ない）
function geoWhy(e) {
  if (!e) return "位置が取れません";
  if (e.code === 1) return "位置情報の使用が許可されていません。① Android の設定 → アプリ → Chrome → 権限 → 位置情報（正確な位置情報もオン） ② Chrome のアドレスバー左 → 権限 → 位置情報を許可（ブロックならリセット）";
  if (e.code === 2) return "位置が分かりません。端末の位置情報（GPS）がオフか、PC など GPS の無い機械です";
  if (e.code === 3) return "時間内に位置をつかめませんでした（屋内・建物のすき間など）。空の見える所で もう一度";
  return "位置が取れません: " + (e.message || "");
}
function setFollow(on) {
  S.follow = on;
  $("#t-gps").classList.toggle("on", on);
  if (on) {
    if (!navigator.geolocation) return toast("この端末では位置を取れません");
    let low = false;
    const fail = (e) => {
      // 正確な位置（GPS）が取れないときは 大まかな位置（Wi-Fi など）で取り直す。許可が無いときはやめる
      if (!low && e && e.code !== 1) { low = true; navigator.geolocation.clearWatch(watchId); watchId = navigator.geolocation.watchPosition(onFix, fail, { enableHighAccuracy: false, maximumAge: 30000, timeout: 30000 }); toast("GPS が取れないので大まかな位置で探しています…", 3500); return; }
      toast(geoWhy(e), 6000);
      if (e && e.code === 1) setFollow(false);
    };
    watchId = navigator.geolocation.watchPosition(onFix, fail, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  } else if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}
function onFix(pos) {
  lastFix = pos;
  const ll = [pos.coords.latitude, pos.coords.longitude];
  if (!meMarker) {
    meCircle = L.circle(ll, { radius: pos.coords.accuracy, color: "#1e88e5", weight: 1, fillOpacity: 0.12 }).addTo(map);
    meMarker = L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: "#1e88e5", fillOpacity: 1 }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 17));
  } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(pos.coords.accuracy); }
  const w = whereIs(ll[0], ll[1]);
  $("#here-info").textContent = [`誤差 ${Math.round(pos.coords.accuracy)} m`, w.範囲, w.近く].filter(Boolean).join("　");
  $("#here-info").style.display = "block";
  if (S.follow && !S.cur) map.panTo(ll);
}
function measure() {
  return new Promise((ok) => {
    if (!navigator.geolocation) { ok(null); return; }
    toast("位置を測っています…");
    navigator.geolocation.getCurrentPosition((p) => ok(p), (e) => {
      const recent = lastFix && Date.now() - lastFix.timestamp < 60000 ? lastFix : null;
      if (!recent) toast(geoWhy(e) + "。地図の真ん中に置くので「位置を動かす」で直してください", 6000);
      ok(recent);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  });
}

// ---------------------------------------------------------------- 地点
function ptColor(p) {
  if (p.recs.some((r) => r.区分 === "重要種")) return KCOLOR.重要種;
  if (p.recs.some((r) => r.区分 === "要確認")) return KCOLOR.要確認;
  if (p.recs.some((r) => r.区分 === "確認種")) return KCOLOR.確認種;
  return p.recs.length ? KCOLOR.環境 : "#757575";
}
function drawPoints() {
  ptLayer.clearLayers();
  for (const p of S.points) {
    if (!S.allDays && p.day !== today() && !(S.cur && S.cur.id === p.id)) continue;
    const old = p.day !== today();
    const icon = L.divIcon({ className: "", html: `<span class="num" style="background:${ptColor(p)};${old ? "opacity:.6" : ""}">${p.no}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([p.lat, p.lon], { icon, draggable: S.moving && S.cur && S.cur.id === p.id });
    const names = p.recs.filter((r) => r.和名).map((r) => r.和名);
    if (names.length) m.bindTooltip((old ? p.day.slice(5) + " " : "") + names.slice(0, 2).join("・") + (names.length > 2 ? " ほか" : ""), { permanent: true, direction: "right", className: "lbl", offset: [10, 0] });
    m.on("click", () => { if (!leaveOk()) return; openPoint(p); });
    m.on("dragend", async () => {
      const ll = m.getLatLng();
      p.lat = ll.lat; p.lon = ll.lng; p.moved = (p.moved || 0) + 1; p.how = "手で置いた";
      p.veg = (vegAt(p.lat, p.lon) || {}).凡例名 || "";
      await putPoint(p); toast(`地点 ${p.no} の位置を直しました`); openPoint(p);
    });
    ptLayer.addLayer(m);
  }
}
function leaveOk() {
  if (!S.dirty) return true;
  if (!confirm("入力の途中です。保存せずに閉じますか？（保存するなら「やめる」で戻って OK を押す）")) return false;
  S.dirty = false; S.editing = null; return true;
}
async function newPoint(preset, atCross) {
  if (!leaveOk()) return;
  const pos = atCross ? null : await measure();
  let lat, lon, acc = null, how;
  if (atCross) { const c = map.getCenter(); lat = c.lat; lon = c.lng; how = "地図の＋の位置"; }
  else if (pos) { lat = pos.coords.latitude; lon = pos.coords.longitude; acc = Math.round(pos.coords.accuracy); how = "GPS"; }
  else { const c = map.getCenter(); lat = c.lat; lon = c.lng; how = "地図の中心（位置が取れなかった）"; }   // 知らせ（取れないわけ）は measure が出す
  const no = S.points.filter((p) => p.day === today()).reduce((m, p) => Math.max(m, p.no), 0) + 1;
  const p = { 業務: jobName(), no, day: today(), time: Date.now(), lat, lon, acc, how, alt: pos && pos.coords.altitude != null ? Math.round(pos.coords.altitude) : null,
    veg: (vegAt(lat, lon) || {}).凡例名 || "", recs: [] };
  p.id = await putPoint(p);
  S.points.push(p);
  drawPoints();
  map.setView([lat, lon], Math.max(map.getZoom(), 17));
  if (preset) openForm(p, -1, preset); else openPoint(p, true);
  // 入力欄が地図の下を覆うので、落とした点が見える高さまで地図をずらす
  setTimeout(() => {
    const h = $("#panel").offsetHeight, size = map.getSize(), want = Math.max(40, (size.y - h) / 2);
    const pt = map.latLngToContainerPoint([lat, lon]);
    if (pt.y > want) map.panBy([0, pt.y - want], { animate: false });
  }, 0);
  return p;
}
function openPoint(p, startForm) {
  S.cur = p; S.dirty = false; S.editing = null;
  const pan = $("#panel");
  pan.innerHTML = "";
  const w = whereIs(p.lat, p.lon);
  const head = el("h3", {}, el("span", { class: "num", style: `background:${ptColor(p)}` }, p.no), `地点 ${p.no}`,
    el("small", { style: "font-weight:400;color:var(--muted)" }, `${p.day} ${hm(new Date(p.time))}`),
    el("button", { class: "x", onclick: closePanel, "aria-label": "閉じる" }, "×"));
  const meta = el("div", { class: "meta" }, `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}　${p.acc != null ? "誤差 " + p.acc + " m" : p.how}` +
    (p.moved ? "（手で直した）" : "") + (p.veg ? `　植生: ${p.veg}` : "") + (w.範囲 ? `　${w.範囲}` : "") + (w.近く ? `　${w.近く}` : ""));
  const tools = el("div", { class: "row" },
    el("button", { class: "btn sec small", onclick: () => remeasure(p) }, "測り直す"),
    el("button", { class: "btn sec small", onclick: () => toggleMove(p) }, S.moving ? "位置を決めた" : "位置を動かす"),
    el("button", { class: "btn sec small", onclick: () => showFigure(p.day, p) }, "位置図"),
    el("button", { class: "btn warn small", onclick: () => removePoint(p) }, "地点を消す"));
  // GPS のプロット番号と使った GPS（ガーミンなどで取った地点の番号。機種は前に書いたものを入れておく。祝 2026-10-04）
  if (p.gps機種 == null) p.gps機種 = S.gpsModel || "";
  const saveGps = async () => { await putPoint(p); if (p.gps機種) { S.gpsModel = p.gps機種; kvSet("gpsModel", p.gps機種); } };
  const gps = el("div", { class: "two", style: "margin:2px 0" },
    el("div", {}, el("label", {}, "GPS のプロット番号"), el("input", { type: "text", value: p.gps番号 || "", placeholder: "例 031", onchange: (e) => { p.gps番号 = e.target.value.trim(); saveGps(); } })),
    el("div", {}, el("label", {}, "使った GPS"), el("input", { type: "text", value: p.gps機種 || "", placeholder: "例 eTrex Touch", list: "gps-models",
      onchange: (e) => { p.gps機種 = e.target.value.trim(); saveGps(); } }),
      el("datalist", { id: "gps-models" }, ...["eTrex Touch", "GPSMAP", "スマホの GPS", "Geographica"].map((v) => el("option", { value: v })))));
  const ul = el("ul", { class: "recs" });
  p.recs.forEach((r, i) => {
    const ms = marksOf(r.和名);
    const t = el("div", { class: "t" }, el("span", { class: "kb " + r.区分 }, r.区分), r.和名 ? r.和名 + (r.区分 === "要確認" ? "?" : "") : r.区分 === "要確認" ? "（名前は持ち帰って調べる）" : (r.環境 || "（環境）"),
      ...ms.map((m) => el("span", { class: "tag" + (m.alien ? " alien" : ""), title: m.full }, m.text)),
      r.個体数 ? el("small", { style: "color:var(--muted)" }, ` ${r.個体数}`) : null,
      r.状態 ? el("small", { style: "color:var(--muted)" }, ` ${r.状態}`) : null,
      r.方法 ? el("small", { style: "color:var(--muted)" }, ` ${r.方法}`) : null,
      r.メモ ? el("div", { class: "meta" }, r.メモ) : null);
    const th = el("div", { class: "thumbs" });
    for (const pid of (r.photos || []).slice(0, 3)) thumbImg(pid).then((im) => im && th.append(im));
    ul.append(el("li", { onclick: () => openForm(p, i) }, t, th));
  });
  const shot = el("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, style: "display:none" });
  shot.onchange = async (e) => {          // 地点・環境・写真だけ（てるをくん 2026-10-04）。撮るとすぐ 環境 の記録として保存
    const ids = [];
    for (const fl of e.target.files) { const pid = await savePhoto(fl, "近景"); if (pid) ids.push(pid); }
    e.target.value = "";
    if (!ids.length) return;
    p.recs.push({ 区分: "環境", 和名: "", 個体数: "", 方法: "", 環境: habitatOf(p.veg) || "", 植物: "", メモ: "", photos: ids, time: Date.now(),
      季節: S.axes["季節"] || "", 調査地点: S.axes["地点"] || "", その他: S.axes["その他"] || "" });
    await putPoint(p); drawPoints(); openPoint(p); toast(`地点 ${p.no} に 環境の写真 ${ids.length} 枚を保存しました`);
  };
  pan.append(head, meta, tools, ...(S.fields.GPS !== false ? [gps] : []), ul, el("div", { class: "row" }, el("button", { class: "btn", onclick: () => openForm(p, -1) }, "＋ 記録を足す"),
    el("button", { class: "btn sec", onclick: () => shot.click() }, "📷 環境の写真だけ"), shot));
  pan.style.display = "block";
  if (startForm) openForm(p, -1);
}
function closePanel() {
  if (!leaveOk()) return;
  $("#panel").style.display = "none"; S.cur = null;
  if (S.moving) { S.moving = false; }
  drawPoints();
}
async function remeasure(p) {
  const pos = await measure();
  if (!pos) return toast("位置が取れませんでした");
  p.lat = pos.coords.latitude; p.lon = pos.coords.longitude; p.acc = Math.round(pos.coords.accuracy); p.how = "GPS（測り直し）";
  p.veg = (vegAt(p.lat, p.lon) || {}).凡例名 || "";
  await putPoint(p); drawPoints(); map.panTo([p.lat, p.lon]); openPoint(p); toast(`地点 ${p.no} を測り直しました（誤差 ${p.acc} m）`);
}
function toggleMove(p) {
  S.moving = !S.moving;
  drawPoints(); openPoint(p);
  if (S.moving) toast("点を指で押さえて動かし、「位置を決めた」を押します", 4000);
}
async function removePoint(p) {
  if (!confirm(`地点 ${p.no} と、その記録 ${p.recs.length} 件・写真を消します。よいですか？`)) return;
  for (const r of p.recs) for (const pid of r.photos || []) await delPhoto(pid);
  await delPoint(p.id);
  S.points = S.points.filter((x) => x.id !== p.id);
  S.dirty = false; closePanel(); toast(`地点 ${p.no} を消しました`);
}

// ---------------------------------------------------------------- 記録の入力欄
// 写真の種類（個体・近景・遠景・環境）。重要種の場所は近景・遠景を何枚も撮る（祝 2026-10-04）
const PHOTO_KINDS = ["個体", "近景", "遠景"];
async function thumbImg(pid) {
  const ph = await getPhoto(pid); if (!ph) return null;
  return el("span", { class: "th", onclick: (e) => { e.stopPropagation(); showBig(pid); } },
    el("img", { src: ph.thumb, alt: "" }), ph.種類 ? el("b", {}, ph.種類) : null);
}
// 札は 欄ごとに数を決め、使った回数の多い順に上から取る（少ないものは表から外れる。各人のクセが残る。祝 2026-10-04）。
// 回数は 保存したときに欄の言葉（「、」で区切る）を数える。手で書いた言葉も 2 回以上で札の候補になる。長押しで札を外す（-1）
const CHIP_N = { 状態: 7, 環境: 14, 植物: 14, メモ名: 10, メモ動: 10, メモ句: 6 };
const cnt = (field, w) => S.usage[field + ":" + w] || 0;
function bump(field, w) { const k = field + ":" + w; if ((S.usage[k] || 0) < 0) S.usage[k] = 0; S.usage[k] = (S.usage[k] || 0) + 1; }   // 外した札も また書けば 1 から数え直す
function pool(field, base, pinned) {
  const N = CHIP_N[field] || 12, pin = [...new Set(pinned)].filter((w) => cnt(field, w) >= 0);
  const pre = field + ":";
  const learned = Object.keys(S.usage).filter((k) => k.startsWith(pre) && S.usage[k] >= 2).map((k) => k.slice(pre.length));
  const order = new Map([...base].map((w, i) => [w, i]));
  const rest = [...new Set([...base, ...learned])].filter((w) => !pin.includes(w) && cnt(field, w) >= 0)
    .sort((a, b) => (cnt(field, b) - cnt(field, a)) || ((order.has(a) ? order.get(a) : 999) - (order.has(b) ? order.get(b) : 999)));
  return pin.concat(rest).slice(0, N);       // どの欄も決めた数ちょうど（多いと似た札を押しまちがえる）
}
function longPress(btn, field, w) {           // 長押しで札を外す
  let tm = null;
  const start = () => { tm = setTimeout(() => { tm = null; if (confirm(`「${w}」の札を外しますか（また書けば戻ります）`)) { S.usage[field + ":" + w] = -1; kvSet("usage", S.usage); btn.remove(); } }, 650); };
  const stop = () => { if (tm) clearTimeout(tm); tm = null; };
  btn.addEventListener("pointerdown", start); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}
function chipRow(words, target, onChange, field) {
  const box = el("div", { class: "chips" });
  for (const w of words) {
    const b = el("button", { type: "button", onclick: () => {
      const v = target.value.trim();
      if (!v.split(/[、,]/).map((x) => x.trim()).includes(w)) target.value = v ? v + "、" + w : w;
      onChange(target.value);
    } }, w);
    if (field) longPress(b, field, w);
    box.append(b);
  }
  return box;
}
const byUse = (arr) => [...new Set(arr)];
// 前回と同じ: 近い（200 m 以内の）別の地点の、いちばん新しい記録の 環境・植物。無ければ最後に保存した記録
function lastLike(p) {
  const cands = [];
  for (const q of S.points) {
    if (q.id === p.id) continue;
    for (const r of q.recs) if (r.環境 || r.植物) cands.push({ r, d: dist(p.lat, p.lon, q.lat, q.lon), t: r.time || q.time });
  }
  if (!cands.length) return null;
  const near = cands.filter((c) => c.d <= 200).sort((a, b) => b.t - a.t);
  return (near[0] || cands.sort((a, b) => b.t - a.t)[0]).r;
}
function openForm(p, idx, preset) {
  openPoint(p);
  const r = idx >= 0 ? JSON.parse(JSON.stringify(p.recs[idx])) : { 区分: "重要種", 和名: "", 個体数: "", 方法: S.axes["採集方法"] || "", 環境: "", 植物: "", メモ: "", photos: [], ...(preset || {}) };
  S.editing = { p, idx, r };
  const dirty = () => { S.dirty = true; };
  const f = el("form", { oninput: dirty, onsubmit: (e) => { e.preventDefault(); saveForm(); } });
  const seg = el("div", { class: "seg" });
  const nameBox = el("div", {});
  for (const k of KUBUN) seg.append(el("button", { type: "button", class: k + (r.区分 === k ? " on" : ""), onclick: () => {
    r.区分 = k; dirty(); [...seg.children].forEach((b) => b.classList.toggle("on", b.textContent === k)); nameBox.style.display = k === "環境" ? "none" : "";
    nameLabel.textContent = k === "要確認" ? "和名（仮の名前でよい。○○属の一種 など。空でもよい）" : "和名";
    onlyBox.style.display = k === "重要種" ? "" : "none"; if (q.value) q.oninput();
  } }, k));
  // 和名（索引から。旧名でも引ける）
  const q = el("input", { type: "search", placeholder: S.bundle ? "和名（カタカナ・ひらがな）" : "業務ファイルが無いので自由に書く", value: r.和名, autocomplete: "off" });
  const nameLabel = el("label", {}, r.区分 === "要確認" ? "和名（仮の名前でよい。○○属の一種 など。空でもよい）" : "和名");
  const hits = el("ul", { class: "hits", style: "display:none" });
  const chosen = el("div", { class: "meta" });
  const showChosen = () => { const ms = marksOf(r.和名); chosen.textContent = r.和名 ? `→ ${r.和名}` + (ms.length ? "　" + ms.map((m) => m.text).join("・") : "") : ""; };
  // 区分が重要種のときは 業務の対象の重要種だけを候補に（祝 2026-10-04。切り替えで全部からも）
  // 他県の重要種と取り違えないよう、切り替えは置かない（祝 2026-10-04「指定したものだけで」）
  const rdbNames = ((S.bundle && S.bundle.rdbCols) || []).filter((c) => c[2] !== "外来種").map((c) => c[1] || c[0]);
  const targetOnly = () => r.区分 === "重要種" && rdbNames.length > 0;
  const onlyBox = el("div", { class: "meta" }, rdbNames.length ? `候補は業務で指定した重要種だけ（${rdbNames.join("・")}）。載っていない種は「確認種」か「要確認」で` : "業務ファイルに重要種の指定がありません");
  onlyBox.style.display = r.区分 === "重要種" ? "" : "none";
  q.oninput = () => { r.和名 = q.value.trim(); showChosen(); searchName(q.value, hits, (sp) => { r.和名 = sp[0]; q.value = sp[0]; hits.style.display = "none"; showChosen(); dirty(); }, targetOnly()); };
  showChosen();
  nameBox.style.display = r.区分 === "環境" ? "none" : "";
  // 種名の入力画面で数えた種（📍から来た）は、書き出しの入力データ（集計）に出さない（二重に数えない）
  const counted = el("label", { style: "color:var(--ink);font-size:13px;display:flex;gap:6px;align-items:center" },
    el("input", { type: "checkbox", onchange: (e) => { r.数え済み = e.target.checked; dirty(); } }),
    "種名の入力画面で数えた（集計の入力データに出さない）");
  counted.querySelector("input").checked = !!r.数え済み;
  const on = (k) => FIXED.has(k) || S.fields[k] !== false;           // ☰ の「入力欄に出す項目」（業務ごと。発注者・調査項目で変わる。祝 2026-10-04）
  nameBox.append(...[nameLabel, onlyBox, q, hits, chosen, on("数え済み") ? counted : null,
    (on("個体数") || on("方法")) ? el("div", { class: "two" },
      on("個体数") ? el("div", {}, el("label", {}, "個体数"), el("input", { type: "text", inputmode: "numeric", value: r.個体数, oninput: (e) => { r.個体数 = e.target.value; } })) : null,
      on("方法") ? el("div", {}, el("label", {}, "方法"), methodInput(r)) : null) : null].filter(Boolean));
  // 確認したもの（成虫・蛹・幼虫・卵・成体・幼体・幼生・成獣・幼獣・足跡・糞・食痕 など。いくつでも。押すと入・切。よく使うものが前）
  const stageBox = el("div", { class: "chips" });
  const stages = new Set((r.状態 || "").split("・").filter(Boolean));
  // 札は ちょうど 7 個の入れ替え制（よく使う順。選んでいるものも上位に無ければ札に出さない＝似た札の押しまちがいを防ぐ）＋自由記入（2 回以上で札に。祝 2026-10-04）
  const stageOrder = pool("状態", STAGES, []);
  const stageSel = el("div", { class: "meta" });
  const setStages = () => { r.状態 = STAGES.filter((x) => stages.has(x)).concat([...stages].filter((x) => !STAGES.includes(x))).join("・"); dirty(); drawStages(); };
  const stageFree = el("input", { type: "text", placeholder: "札に無いもの（例 若齢幼虫・交尾中）", style: "flex:1;min-width:0" });
  const addFree = () => { const v = stageFree.value.trim(); if (!v) return; for (const s of v.split(/[・、,，]/).map((x) => x.trim()).filter(Boolean)) stages.add(s); stageFree.value = ""; setStages(); };
  stageFree.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } });
  const drawStages = () => {
    stageBox.innerHTML = "";
    for (const s of stageOrder) {
      const b = el("button", { type: "button", class: stages.has(s) ? "on" : "", onclick: () => { stages.has(s) ? stages.delete(s) : stages.add(s); setStages(); } }, s);
      longPress(b, "状態", s); stageBox.append(b);
    }
    // 札に出ていないものを選んでいるときは 文字で出す
    const hidden = [...stages].filter((s) => !stageOrder.includes(s));
    stageSel.innerHTML = "";
    if (hidden.length) stageSel.append(`選んだもの（札の外）：${hidden.join("・")}　`, el("button", { type: "button", class: "btn sec small", onclick: () => { stages.clear(); setStages(); } }, "選び直す"));
  };
  drawStages();
  const stageFreeRow = el("div", { class: "row" }, stageFree, el("button", { type: "button", class: "btn sec small", onclick: addFree }, "足す"));
  // 生息環境（おおまかな区分。植生図の凡例をその区分に寄せて先頭に）・周囲の植物
  const env = el("textarea", { rows: 2, placeholder: "札を押すと入る。書き足しもできる", oninput: (e) => { r.環境 = e.target.value; } }); env.value = r.環境 || "";
  const near = vegNear(p.lat, p.lon), sug = [...new Set(near.map(habitatOf).filter(Boolean))];
  const envChips = chipRow(pool("環境", HABITATS, sug), env, (v) => { r.環境 = v; dirty(); }, "環境");
  const pl = el("textarea", { rows: 2, placeholder: "周囲で確認した植物の札を押す。札に無い植物は書く", oninput: (e) => { r.植物 = e.target.value; } }); pl.value = r.植物 || "";
  const legend = vegAt(p.lat, p.lon), lp = legend && ((S.mapdata && S.mapdata.凡例の植物) || {})[String(legend.凡例コード)];
  const lpNames = lp ? lp.植物.map((x) => x[0]) : [];
  const plChips = chipRow(pool("植物", lpNames.slice(6), lpNames.slice(0, 6)), pl, (v) => { r.植物 = v; dirty(); }, "植物");
  const prev = lastLike(p);
  const same = prev ? el("button", { type: "button", class: "btn sec small", onclick: () => {
    env.value = prev.環境 || ""; pl.value = prev.植物 || ""; r.環境 = env.value; r.植物 = pl.value; dirty(); toast("前回の環境・植物を入れました");
  } }, "前回と同じ") : null;
  // メモ（必ず書く欄。祝 2026-10-04）。名詞の札＋動きの札で「イネ科植物でスウィーピング」「セイタカアワダチソウに訪花」と組める
  const memo = el("textarea", { rows: 3, placeholder: "例 イネ科植物でスウィーピングで捕獲／セイタカアワダチソウに訪花", oninput: (e) => { r.メモ = e.target.value; } }); memo.value = r.メモ || "";
  const memoAdd = (w, noun) => {
    let v = memo.value.replace(/\s+$/, "");
    if (noun && v && !/[、。]$/.test(v)) v += "、";
    memo.value = v + w; r.メモ = memo.value; dirty();
    bump(noun ? "メモ名" : "メモ動", w); kvSet("usage", S.usage);
  };
  const plantNames = [...(r.植物 || "").split(/[、,]/).map((x) => x.trim()).filter(Boolean), ...(lp ? lp.植物.slice(0, 8).map((x) => x[0]) : [])];
  const mk = (field, cls, words, noun) => el("div", { class: "chips" }, ...words.map((w) => { const b = el("button", { type: "button", class: cls, onclick: () => memoAdd(w, noun) }, w); longPress(b, field, w); return b; }));
  const memoNouns = mk("メモ名", "noun", pool("メモ名", [...MEMO_NOUNS, ...plantNames], []), true);
  const memoActs = mk("メモ動", "act", pool("メモ動", MEMO_ACTS, []), false);
  // よく書くメモ（保存したメモを「、」「。」で分けた一続き。2 回以上書いたもの）
  const phrases = pool("メモ句", [], []);
  const memoPhr = phrases.length ? el("div", { class: "chips" }, ...phrases.map((w) => { const b = el("button", { type: "button", class: "phr", onclick: () => memoAdd(w, true) }, w); longPress(b, "メモ句", w); return b; })) : null;
  // デジカメの画像番号（スマホで撮らないとき）
  const cam = el("input", { type: "text", value: r.カメラ番号 || "", placeholder: "例 DSC_1234〜1240", oninput: (e) => { r.カメラ番号 = e.target.value; } });
  // 写真
  const th = el("div", { class: "thumbs" });
  const drawThumbs = () => { th.innerHTML = ""; for (const pid of r.photos) thumbImg(pid).then((im) => im && th.append(im)); };
  drawThumbs();
  // 撮る: 個体・近景・遠景（何度でも）。選ぶ: 端末の写真（種類は下の札で。あとで大きく見て付け替えられる）
  let kind = r.区分 === "環境" ? "近景" : "個体";
  const file = el("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, style: "display:none" });
  const gal = el("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
  gal.onchange = file.onchange = async (e) => {
    for (const fl of e.target.files) { const pid = await savePhoto(fl, kind); if (pid) { r.photos.push(pid); dirty(); } }
    e.target.value = ""; drawThumbs();
  };
  const shootRow = el("div", { class: "row" },
    ...PHOTO_KINDS.map((k) => el("button", { type: "button", class: "btn sec", onclick: () => { kind = k; file.click(); } }, "📷 " + k)),
    el("button", { type: "button", class: "btn sec small", onclick: () => { kind = r.区分 === "環境" ? "近景" : "個体"; gal.click(); } }, "写真を選ぶ"), file, gal);
  const part = (k, ...xs) => (on(k) ? xs : []);
  f.append(seg, nameBox,
    ...part("状態", el("label", {}, "確認したもの（いくつでも。長押しで札を外す）"), stageBox, stageSel, stageFreeRow),
    ...part("メモ", el("label", {}, "メモ（確認の状況。札は 名前＋動き で組める。長押しで札を外す）"), ...(memoPhr ? [memoPhr] : []), memoNouns, memoActs, memo),
    ...part("環境", el("label", {}, "生息環境" + (near.length ? `（植生図: ${near.join("・")}）` : "")), el("div", { class: "row" }, same), envChips, env),
    ...part("植物", el("label", {}, "周囲で確認された植物" + (lp ? `（${legend.凡例名} の主な植物。調査地点 ${lp.調査地点数}）` : legend ? `（${legend.凡例名}。調査の地点なし）` : "")), plChips, pl),
    ...part("写真", el("label", {}, "写真（スマホ）"), th, shootRow),
    ...part("カメラ", el("label", {}, "デジカメの画像番号"), cam),
    el("div", { class: "row" }, el("button", { type: "submit", class: "btn" }, "OK（保存）"),
      el("button", { type: "button", class: "btn sec", onclick: () => { if (leaveOk()) openPoint(p); } }, "やめる"),
      idx >= 0 ? el("button", { type: "button", class: "btn warn", onclick: () => removeRec(p, idx) }, "この記録を消す") : null));
  $("#panel").append(f);
  if (preset && preset.和名) { S.dirty = true; return; }
  if (idx < 0 && r.区分 !== "環境") setTimeout(() => q.focus(), 50);
}
function methodInput(r) {
  const opts = [...new Set(((S.bundle && S.bundle.axes && S.bundle.axes["採集方法"]) || []).concat(METHODS))]
    .sort((a, b) => (S.usage["方法:" + b] || 0) - (S.usage["方法:" + a] || 0));   // よく使うものが上
  const id = "ml" + Math.random().toString(36).slice(2);
  const inp = el("input", { type: "text", list: id, value: r.方法 || "", placeholder: "選ぶか書く", oninput: (e) => { r.方法 = e.target.value; } });
  const dl = el("datalist", { id }); for (const o of [...new Set(opts)]) dl.append(el("option", { value: o }));
  return el("span", {}, inp, dl);
}
// 業務の対象の重要種（調査設定「重要種」シートで ○ を付けた RL に載る種。外来種だけの印は入れない）
const isTarget = (sp) => marksOf(sp[0]).some((m) => !m.alien);
function searchName(raw, ul, pick, onlyTarget) {
  ul.innerHTML = "";
  if (!S.bundle || !raw.trim()) { ul.style.display = "none"; return; }
  const q = skey(raw), pre = [], mid = [];
  for (const sp of S.bundle.species) {
    if (!(sp[4] & S.masterBit)) continue;
    if (onlyTarget && !isTarget(sp)) continue;
    if (sp[5].startsWith(q)) pre.push(sp); else if (mid.length < 100 && sp[5].includes(q)) mid.push(sp);
  }
  const used = (sp) => S.usage["種:" + sp[0]] || 0;
  pre.sort((a, b) => used(b) - used(a));
  const list = pre.slice(0, 30).concat(mid.slice(0, Math.max(0, 30 - pre.length)));
  const oldHit = new Map();
  buildOlds();
  if (q.length >= 2) for (const o of S.olds) {
    if (!o.k.startsWith(q)) continue;
    for (const i of o.t) { const sp = S.bundle.species[i]; if (sp && !(onlyTarget && !isTarget(sp))) { oldHit.set(sp, o.n); if (!list.includes(sp)) list.push(sp); } }
    if (list.length > 40) break;
  }
  for (const sp of list) {
    const ms = marksOf(sp[0]);
    ul.append(el("li", { onclick: () => { S.usage["種:" + sp[0]] = used(sp) + 1; kvSet("usage", S.usage); pick(sp); } }, sp[0],
      ...ms.map((m) => el("span", { class: "tag" + (m.alien ? " alien" : "") }, m.text)),
      el("small", {}, `${sp[2] || ""}${oldHit.has(sp) ? "　旧名 " + oldHit.get(sp) : ""}`)));
  }
  if (!list.length) ul.append(el("li", {}, onlyTarget ? "業務で指定した重要種に候補なし（重要種でなければ「確認種」、分からなければ「要確認」）" : "候補なし（このまま書いた名前で保存できます）"));
  ul.style.display = "block";
}
async function savePhoto(file, kind) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const fit = (max) => { const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c; };
    const big = await new Promise((ok) => fit(1600).toBlob(ok, "image/jpeg", 0.85));
    const thumb = fit(200).toDataURL("image/jpeg", 0.7);
    return await putPhoto({ blob: big, thumb, time: file.lastModified || Date.now(), name: file.name, 種類: kind || "" });
  } catch (e) { toast("写真を読めませんでした: " + (e.message || e)); return null; }
}
async function saveForm() {
  const { p, idx, r } = S.editing;
  r.和名 = (r.和名 || "").trim();
  if ((r.区分 === "重要種" || r.区分 === "確認種") && !r.和名) return toast("和名を入れてください（分からないときは「要確認」、地点・写真だけなら「環境」）");
  // 重要種は 業務で指定した RL に載る種だけ（候補に出なければ重要種ではない。祝 2026-10-04）
  if (r.区分 === "重要種" && S.bundle && (S.bundle.rdbCols || []).some((c) => c[2] !== "外来種")) {
    const sp = S.byName && S.byName.get(r.和名);
    if (!sp || !isTarget(sp)) return toast(`「${r.和名}」は業務で指定した重要種にありません。候補から選ぶか、区分を「確認種」「要確認」に`, 5000);
  }
  if (r.区分 !== "環境" && !(r.メモ || "").trim() && !confirm("メモが空です。このまま保存しますか？（確認の状況を書いておくと あとで役に立ちます）")) return;
  r.季節 = r.季節 || S.axes["季節"] || ""; r.調査地点 = r.調査地点 || S.axes["地点"] || ""; r.その他 = r.その他 || S.axes["その他"] || "";
  r.time = r.time || Date.now();
  // 使った回数（札・選ぶ欄の並びに使う）
  if (r.方法) S.usage["方法:" + r.方法] = (S.usage["方法:" + r.方法] || 0) + 1;
  for (const s of (r.状態 || "").split("・").filter(Boolean)) bump("状態", s);
  // 欄の言葉を数える（手で書いた言葉も。2 回以上で札の候補）
  const words = (s, re) => [...new Set((s || "").split(re).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 24))];
  for (const w of words(r.環境, /[、,，\n]/)) bump("環境", w);
  for (const w of words(r.植物, /[、,，\n]/)) bump("植物", w);
  for (const w of words(r.メモ, /[、。,，\n]/)) bump("メモ句", w);
  kvSet("usage", S.usage);
  if (idx >= 0) p.recs[idx] = r; else p.recs.push(r);
  await putPoint(p); S.dirty = false; drawPoints(); openPoint(p);
  toast(`地点 ${p.no} に ${r.和名 || "環境"} を保存しました`);
}
async function removeRec(p, idx) {
  const r = p.recs[idx];
  if (!confirm(`「${r.和名 || "環境"}」の記録と写真 ${(r.photos || []).length} 枚を消します。よいですか？`)) return;
  for (const pid of r.photos || []) await delPhoto(pid);
  p.recs.splice(idx, 1); await putPoint(p); S.dirty = false; drawPoints(); openPoint(p);
}
async function showBig(pid) {
  const ph = await getPhoto(pid); if (!ph) return;
  const url = URL.createObjectURL(ph.blob);
  $("#big-img").src = url; $("#big").style.display = "flex";
  $("#big-del").style.display = S.editing ? "" : "none";
  // 種類を付け替える（個体・近景・遠景）
  const kb = $("#big-kind"); kb.innerHTML = "";
  for (const k of PHOTO_KINDS) kb.append(el("button", { class: "btn small " + (ph.種類 === k ? "" : "sec"), onclick: async () => {
    ph.種類 = k; await putPhoto(ph); [...kb.children].forEach((b) => b.className = "btn small " + (b.textContent === k ? "" : "sec"));
    const f = $("#panel form .thumbs") || null; if (f && S.editing) { f.innerHTML = ""; for (const x of S.editing.r.photos) thumbImg(x).then((im) => im && f.append(im)); }
  } }, k));
  $("#big-close").onclick = () => { $("#big").style.display = "none"; URL.revokeObjectURL(url); };
  $("#big-del").onclick = async () => {
    const r = S.editing.r; r.photos = r.photos.filter((x) => x !== pid); S.dirty = true;
    $("#big").style.display = "none"; URL.revokeObjectURL(url); toast("外しました（OK で保存）");
    const f = $("#panel form .thumbs"); if (f) { f.innerHTML = ""; for (const x of r.photos) thumbImg(x).then((im) => im && f.append(im)); }
  };
}

// ---------------------------------------------------------------- 一覧
function renderList() {
  const box = $("#list"); box.innerHTML = "";
  const bar = el("div", { class: "row", style: "position:sticky;top:0;background:var(--bg);padding:2px 0;z-index:2" },
    el("button", { class: "btn small " + (S.listAll ? "sec" : ""), onclick: () => { S.listAll = false; renderList(); } }, "今日だけ"),
    el("button", { class: "btn small " + (S.listAll ? "" : "sec"), onclick: () => { S.listAll = true; renderList(); } }, "すべて"),
    ...["", ...KUBUN].map((k) => el("button", { class: "btn small " + (S.listKubun === k ? "" : "sec"), onclick: () => { S.listKubun = k; renderList(); } }, k || "全区分")));
  box.append(bar);
  let pts = [...S.points].sort((a, b) => b.time - a.time);
  if (!S.listAll) pts = pts.filter((p) => p.day === today());
  if (S.listKubun) pts = pts.filter((p) => p.recs.some((r) => r.区分 === S.listKubun));
  if (!pts.length) box.append(el("p", { class: "meta", style: "text-align:center" }, S.points.length ? "当てはまる地点がありません（「すべて」で前の日も出ます）" : "まだ地点がありません。地図で「ここを記録」を押してください。"));
  let day = null;
  for (const p of pts) {
    if (p.day !== day) { day = p.day; box.append(el("div", { class: "meta", style: "margin:6px 2px 2px;font-weight:600" }, day)); }
    const img = el("div", {});
    const first = p.recs.flatMap((r) => r.photos || [])[0];
    if (first) getPhoto(first).then((ph) => ph && img.append(el("img", { src: ph.thumb, alt: "" })));
    const recs = S.listKubun ? p.recs.filter((r) => r.区分 === S.listKubun) : p.recs;
    const t = el("div", { class: "t" }, el("b", {}, `${p.no}. `), hm(new Date(p.time)), p.veg ? el("span", { class: "meta" }, "　" + p.veg) : null,
      el("div", {}, ...recs.map((r) => el("span", { style: "margin-right:6px" }, el("span", { class: "kb " + r.区分 }, r.区分[0]), recLabel(r)))),
      p.recs.length ? null : el("div", { class: "meta" }, "（記録なし）"));
    box.append(el("div", { class: "pt", onclick: () => { showTab("map"); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 18)); openPoint(p); } }, img, t));
  }
}
function showTab(t) {
  if (t === "list" && !leaveOk()) return;
  const m = t === "map";
  $("#tab-map").classList.toggle("on", m); $("#tab-list").classList.toggle("on", !m);
  $("#list").style.display = m ? "none" : "block";
  for (const id of ["#tools", "#btn-here"]) $(id).style.display = m ? "" : "none";
  $("#btn-cross").style.display = m && document.body.classList.contains("cross") ? "" : "none";
  if (!m) { $("#panel").style.display = "none"; S.cur = null; renderList(); } else { drawPoints(); setTimeout(() => map.invalidateSize(), 50); }
}

// ---------------------------------------------------------------- 地図を貯める（圏外用）
function tileXY(lon, lat, z) {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return [x, y];
}
// 範囲 b=[西,南,東,北] を 縮尺 z0〜z1、地図の種類 kinds で貯める。保存した範囲は地図に点線の枠で出す
function tileUrls(b, z0, z1, kinds) {
  const urls = [];
  for (let z = z0; z <= z1; z++) {
    const [x0, y1] = tileXY(b[0], b[1], z), [x1, y0] = tileXY(b[2], b[3], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const k of kinds) if (k !== "植生図" || z <= 15) urls.push(TILES[k].replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  return urls;
}
async function saveTiles(b, z0, z1, kinds, label, info) {
  const urls = tileUrls(b, z0, z1, kinds);
  const mb = Math.round(urls.reduce((a, u) => a + (u.endsWith(".jpg") ? 45 : 20), 0) / 1024);
  if (urls.length > 6000) return toast(`${urls.length} 枚になり多すぎます。地図を拡大して範囲を狭めるか、縮尺の深さを浅くしてください`, 5000);
  if (!confirm(`地理院の地図を ${urls.length} 枚（およそ ${mb || 1} MB。${kinds.join("・")}、縮尺 ${z0}〜${z1}）貯めます。電波のよい所で。よいですか？`)) return;
  const c = await caches.open("gsi-tiles");
  let done = 0, ng = 0;
  const work = async () => {
    while (urls.length) {
      const u = urls.shift();
      try { if (!(await c.match(u))) { const veg = u.includes("biodic.go.jp"); const res = await fetch(u, { mode: veg ? "no-cors" : "cors" }); if (res.ok || res.type === "opaque") await c.put(u, res); else ng++; } } catch (e) { ng++; }
      done++; if (done % 20 === 0) info.textContent = `貯めています… ${done} 枚`;
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  info.textContent = `貯めました（${done} 枚${ng ? `、取れなかった ${ng} 枚` : ""}）。圏外でもこの範囲は見られます。`;
  const areas = (await kvGet("savedAreas")) || [];
  areas.push({ b, z0, z1, kinds, label, at: Date.now() });
  await kvSet("savedAreas", areas); drawSaved(areas); storageInfo();
}
async function cacheArea() {
  const b = S.mapdata && S.mapdata.範囲;
  if (!b) return toast("業務の地図が入っていません。地図を動かして「いま画面に出ている範囲を保存」を使ってください", 5000);
  await saveTiles(b, 13, 18, ["標準地図", "航空写真"], S.mapdata.業務 + " の範囲", $("#cache-info"));
}
// いま画面に出ている範囲を保存（業務の地図が無い調査地でも。電波のあるうちに下準備。祝 2026-10-04）
async function cacheView() {
  const bd = map.getBounds(), b = [bd.getWest(), bd.getSouth(), bd.getEast(), bd.getNorth()];
  const z0 = Math.max(10, Math.min(map.getZoom(), 18)), z1 = Math.min(18, Math.max(z0, z0 + parseInt($("#view-depth").value, 10)));
  const kinds = ($("#view-kind").value === "両方" ? ["標準地図", "航空写真"] : [$("#view-kind").value]).concat($("#view-veg").checked ? ["植生図"] : []);
  $("#dlg-menu").close();
  toast("この範囲を貯めます（終わるまで画面を開いたままに）", 4000);
  await saveTiles(b, z0, z1, kinds, `${ymd()} の保存`, $("#view-info"));
  let msg = $("#view-info").textContent;
  if ($("#view-veg").checked) { const n = await saveVeg(b, $("#view-info")); if (n) msg += `　植生図 ${n} ポリゴンも保存（凡例名つき）`; $("#view-info").textContent = msg; }
  toast(msg, 5000);
}
// 環境省ジオポータル（ArcGIS。現存植生図2024 全国 8 ブロック。CC-BY 4.0）から 範囲の植生図を 形と凡例名つきで取る（祝 2026-10-04）
const VEG_FS = (n) => `https://svr-moej.gisservice.jp/arcgis/rest/services/Hosted/veg2024bk${n}/FeatureServer/0/query`;
async function fetchVegBox(b) {
  const qs = new URLSearchParams({ geometry: b.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "*", maxAllowableOffset: "0.00001", geometryPrecision: "6", f: "geojson" });
  const res = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => fetch(VEG_FS(n) + "?" + qs, { mode: "cors" }).then((r) => r.json()).catch(() => null)));
  const out = [];
  let over = false;
  for (const d of res) {
    if (!d || !d.features) continue;
    if (d.properties && d.properties.exceededTransferLimit) over = true;
    for (const f of d.features) {
      const p = f.properties || {};
      out.push({ type: "Feature", id: p.fid, properties: { 凡例コード: String(p.凡例コード || ""), 凡例名: p.凡例名 || "", 植生自然度: String(p.植生自然度 || ""), 植生区分: p.植生区分 || "", 大区分コード: "" }, geometry: f.geometry });
    }
  }
  return { features: out, over };
}
async function saveVeg(b, info) {
  info.textContent = "植生図を取っています…";
  const got = await fetchVegBox(b);
  if (!got.features.length) { info.textContent = "植生図を取れませんでした（電波・範囲を確かめる）"; return 0; }
  const old = (await kvGet("vegSaved")) || { type: "FeatureCollection", features: [] };
  const byId = new Map(old.features.map((f) => [f.id, f]));
  for (const f of got.features) byId.set(f.id, f);
  S.vegSaved = { type: "FeatureCollection", features: [...byId.values()] };
  await kvSet("vegSaved", S.vegSaved);
  applyMapdata(S.mapdata);
  if (got.over) toast("植生図が多すぎて一部しか取れませんでした。拡大して範囲を狭めてください", 5000);
  return got.features.length;
}
let savedLayer = null;
function drawSaved(areas) {
  if (savedLayer) map.removeLayer(savedLayer);
  savedLayer = L.layerGroup(areas.map((a) => L.rectangle([[a.b[1], a.b[0]], [a.b[3], a.b[2]]], { color: "#7b1fa2", weight: 3, dashArray: "10 6", fill: false, interactive: false }))).addTo(map);
}
async function storageInfo() {
  const box = $("#storage-info"); if (!box) return;
  try {
    const e = await navigator.storage.estimate(), n = ((await kvGet("savedAreas")) || []).length;
    box.textContent = `保存した範囲 ${n}・端末の使用 およそ ${Math.round((e.usage || 0) / 1048576)} MB`;
  } catch (err) { box.textContent = ""; }
}
async function clearTiles() {
  if (!confirm("貯めた地理院の地図をすべて端末から消します（記録・写真は消えません）。よいですか？")) return;
  await caches.delete("gsi-tiles"); await kvSet("savedAreas", []); await kvSet("vegSaved", null); S.vegSaved = null; applyMapdata(S.mapdata);
  drawSaved([]); storageInfo(); toast("貯めた地図（植生図も）を消しました");
}

// ---------------------------------------------------------------- 位置図（A4 縦 1240×1754。150 dpi）
const FW = 1240, FH = 1754, FM = 48, MAPY = FM + 186, MAPH = 1100, MAPW = FW - 2 * FM;
const TS = 256;
function wpx(lon, lat, z) { const n = TS * 2 ** z, s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; }
async function loadTile(u) {
  const res = await fetch(u, { mode: "cors" });
  if (!res.ok) throw new Error(res.status);
  return createImageBitmap(await res.blob());
}
function seasonOf(pts) {
  const c = {};
  for (const p of pts) for (const r of p.recs) if (r.季節) c[r.季節] = (c[r.季節] || 0) + 1;
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || S.axes["季節"] || "";
}
function jobName() { return (S.bundle && S.bundle.case) || (S.mapdata && S.mapdata.業務) || "現地記録"; }
async function drawFigure(day, focus) {
  const fig = S.fig;
  const pts = S.points.filter((p) => p.day === day).sort((a, b) => a.no - b.no);
  const cv = document.createElement("canvas"); cv.width = FW; cv.height = FH;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, FW, FH);
  const font = (px, bold) => `${bold ? "bold " : ""}${px}px "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif`;
  // 表題の帯（業務名・図の名前・季節・項目・調査日）
  g.strokeStyle = "#333"; g.lineWidth = 2; g.strokeRect(FM, FM, MAPW, 170);
  g.fillStyle = "#222"; g.textBaseline = "top"; g.textAlign = "left";
  g.font = font(26, true); g.fillText(jobName(), FM + 16, FM + 14);
  g.font = font(42, true); g.textAlign = "center";
  g.fillText(focus ? `${fig.図の名前}（地点 ${focus.no}）` : fig.図の名前, FW / 2, FM + 56);
  g.font = font(26); g.fillText(`季節：${seasonOf(pts) || "－"}　　項目：${fig.項目 || "－"}　　調査日：${day}`, FW / 2, FM + 118);
  // 範囲と縮尺
  let bb = null;
  const add = (lon, lat) => { if (!bb) bb = [lon, lat, lon, lat]; else { bb[0] = Math.min(bb[0], lon); bb[1] = Math.min(bb[1], lat); bb[2] = Math.max(bb[2], lon); bb[3] = Math.max(bb[3], lat); } };
  let z;
  if (focus) { add(focus.lon, focus.lat); z = 18; }
  else {
    for (const p of pts) add(p.lon, p.lat);
    for (const a of S.areas) for (const c of a.ring) add(c[0], c[1]);
    for (const p of S.jobPts) add(p.lon, p.lat);
    if (!bb) return null;
    z = 18;
    while (z > 10) {
      const [ax, ay] = wpx(bb[0], bb[3], z), [bx, by] = wpx(bb[2], bb[1], z);
      if (bx - ax <= MAPW - 120 && by - ay <= MAPH - 120) break;
      z--;
    }
  }
  const [cx, cy] = wpx((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, z);
  const ox = cx - MAPW / 2, oy = cy - MAPH / 2;
  const P = (lon, lat) => { const [x, y] = wpx(lon, lat, z); return [x - ox + FM, y - oy + MAPY]; };
  g.save(); g.beginPath(); g.rect(FM, MAPY, MAPW, MAPH); g.clip();
  g.fillStyle = "#eee"; g.fillRect(FM, MAPY, MAPW, MAPH);
  // 背景（地理院）
  let noBg = 0, nTile = 0;
  const tmpl = GSI[fig.背景] || GSI.標準地図;
  const jobs = [];
  for (let tx = Math.floor(ox / TS); tx <= Math.floor((ox + MAPW) / TS); tx++)
    for (let ty = Math.floor(oy / TS); ty <= Math.floor((oy + MAPH) / TS); ty++) {
      nTile++;
      jobs.push(loadTile(tmpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty)).then((im) => g.drawImage(im, tx * TS - ox + FM, ty * TS - oy + MAPY)).catch(() => { noBg++; }));
    }
  await Promise.all(jobs);
  // 植生図
  const vegUsed = new Map();
  if (fig.植生 && S.vegFC) {
    g.globalAlpha = 0.38;
    for (const f of S.vegFC.features) {
      const gm = f.geometry, polys = gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates;
      g.beginPath();
      let vis = false;
      for (const pg of polys) for (const ring of pg) ring.forEach((c, i) => { const [x, y] = P(c[0], c[1]); if (x > FM && x < FM + MAPW && y > MAPY && y < MAPY + MAPH) vis = true; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.fillStyle = vegColor(f.properties); g.fill("evenodd");
      if (vis) vegUsed.set(f.properties.凡例名, vegColor(f.properties));
    }
    g.globalAlpha = 1;
  }
  // 業務の地図（範囲・線）
  const lineLegend = new Map();
  if (S.mapdata) for (const f of S.mapdata.地図.features) {
    const gm = f.geometry; if (gm.type === "Point") continue;
    const rings = gm.type === "Polygon" ? gm.coordinates : [gm.coordinates];
    const dash = /バッファ/.test(f.properties.名前) ? [16, 10] : [];
    g.strokeStyle = f.properties.色 || "#1565c0"; g.lineWidth = 4; g.setLineDash(dash);
    for (const ring of rings) { g.beginPath(); ring.forEach((c, i) => { const [x, y] = P(c[0], c[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    g.setLineDash([]);
    lineLegend.set(f.properties.名前, { color: f.properties.色 || "#1565c0", dash });
  }
  // 名前を置く（ぶつからない所を探し、離れたら引き出し線）
  const occ = [];
  const hit = (a) => occ.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) ||
    a.x < FM + 4 || a.y < MAPY + 4 || a.x + a.w > FM + MAPW - 4 || a.y + a.h > MAPY + MAPH - 4;
  const placeLabel = (x, y, text, px, rad0) => {
    g.font = font(px, true);
    const w = g.measureText(text).width + 10, h = px + 8;
    for (const rad of [rad0, rad0 + 26, rad0 + 60, rad0 + 100, rad0 + 150, rad0 + 210]) for (const ang of [0, -40, 40, -90, 90, 180, -140, 140]) {
      const a = ang * Math.PI / 180, ax = x + rad * Math.cos(a), ay = y + rad * Math.sin(a);
      const box = { x: Math.cos(a) >= -0.01 ? ax : ax - w, y: ay - h / 2, w, h };
      if (Math.abs(Math.sin(a)) > 0.95) box.x = ax - w / 2;
      if (hit(box)) continue;
      occ.push(box);
      return { box, lead: rad > rad0 + 1 };
    }
    return null;
  };
  // 業務の点（トラップなど）
  const jobPtsDrawn = [];
  for (const p of S.jobPts) {
    const [x, y] = P(p.lon, p.lat);
    if (x < FM || x > FM + MAPW || y < MAPY || y > MAPY + MAPH) continue;
    g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = "#ffd600"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#333"; g.stroke();
    occ.push({ x: x - 9, y: y - 9, w: 18, h: 18 });
    jobPtsDrawn.push({ x, y, name: p.name });
  }
  // 記録の点
  const shown = focus ? S.points.filter((p) => { const [x, y] = P(p.lon, p.lat); return x > FM && x < FM + MAPW && y > MAPY && y < MAPY + MAPH; }) : pts;
  const dots = shown.map((p) => { const [x, y] = P(p.lon, p.lat); occ.push({ x: x - 16, y: y - 16, w: 32, h: 32 }); return { p, x, y }; });
  for (const d of jobPtsDrawn) {
    const L1 = placeLabel(d.x, d.y, d.name, 18, 12);
    if (L1) { g.fillStyle = "rgba(255,255,255,.8)"; g.fillRect(L1.box.x, L1.box.y, L1.box.w, L1.box.h); g.fillStyle = "#333"; g.textAlign = "left"; g.textBaseline = "middle"; g.font = font(18, true); g.fillText(d.name, L1.box.x + 5, L1.box.y + L1.box.h / 2); }
  }
  const numberOnly = [];
  for (const d of dots) {
    const text = `${d.p.day !== day ? d.p.day.slice(5) + " " : ""}${d.p.no} ${d.p.recs.map(recLabel).join("・") || "（記録なし）"}`;
    const short = text.length > 40 ? text.slice(0, 39) + "…" : text;
    const L2 = placeLabel(d.x, d.y, short, 20, 20);
    if (!L2) { numberOnly.push(d.p.no); continue; }
    const b = L2.box;
    if (L2.lead) {
      const tx = Math.max(b.x, Math.min(d.x, b.x + b.w)), ty = Math.max(b.y, Math.min(d.y, b.y + b.h));
      g.strokeStyle = "#333"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(tx, ty); g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(b.x, b.y, b.w, b.h); g.strokeStyle = ptColor(d.p); g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h);
    g.fillStyle = "#111"; g.textAlign = "left"; g.textBaseline = "middle"; g.font = font(20, true); g.fillText(short, b.x + 5, b.y + b.h / 2);
  }
  for (const d of dots) {
    const big = focus && d.p.id === focus.id;
    g.beginPath(); g.arc(d.x, d.y, big ? 18 : 14, 0, 7); g.fillStyle = ptColor(d.p); g.fill(); g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
    g.fillStyle = "#fff"; g.font = font(big ? 18 : 15, true); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(d.p.no), d.x, d.y + 1);
  }
  if (noBg === nTile) { g.fillStyle = "#666"; g.font = font(28, true); g.textAlign = "center"; g.fillText("背景なし（この範囲の地図を貯めていない・取れない）", FW / 2, MAPY + 40); }
  // 方位・縮尺
  g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(FM + MAPW - 70, MAPY + 12, 56, 80);
  g.fillStyle = "#222"; g.beginPath(); g.moveTo(FM + MAPW - 42, MAPY + 20); g.lineTo(FM + MAPW - 56, MAPY + 62); g.lineTo(FM + MAPW - 42, MAPY + 54); g.lineTo(FM + MAPW - 28, MAPY + 62); g.closePath(); g.fill();
  g.font = font(22, true); g.textAlign = "center"; g.textBaseline = "top"; g.fillText("N", FM + MAPW - 42, MAPY + 64);
  const mpp = 156543.03392 * Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180) / 2 ** z;
  const len = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000].filter((m) => m / mpp <= 260).pop() || 10, lp = len / mpp;
  g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(FM + 12, MAPY + MAPH - 58, lp + 90, 46);
  g.fillStyle = "#222"; g.fillRect(FM + 24, MAPY + MAPH - 26, lp, 6); g.fillRect(FM + 24, MAPY + MAPH - 34, 3, 14); g.fillRect(FM + 21 + lp, MAPY + MAPH - 34, 3, 14);
  g.font = font(20, true); g.textAlign = "left"; g.textBaseline = "bottom"; g.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, FM + 30 + lp, MAPY + MAPH - 18);
  g.restore();
  g.strokeStyle = "#333"; g.lineWidth = 2; g.strokeRect(FM, MAPY, MAPW, MAPH);
  // 凡例（左下）
  const LY = MAPY + MAPH + 16;
  g.textAlign = "left"; g.textBaseline = "middle"; g.font = font(22, true); g.fillStyle = "#222"; g.fillText("凡　例", FM + 8, LY + 14);
  let ly = LY + 46;
  const LYMAX = FH - FM - 56;                       // ここより下は出典などの行
  const legRow = (draw, text) => {
    if (ly > LYMAX) return false;
    draw(FM + 26, ly); g.fillStyle = "#222"; g.font = font(19); g.textAlign = "left";
    let s = text; while (g.measureText(s).width > 400 && s.length > 4) s = s.slice(0, -2) + "…";
    g.fillText(s, FM + 56, ly); ly += 28; return true;
  };
  for (const k of KUBUN) if (shown.some((p) => p.recs.some((r) => r.区分 === k))) legRow((x, y) => { g.beginPath(); g.arc(x, y, 10, 0, 7); g.fillStyle = KCOLOR[k]; g.fill(); }, { 環境: "環境の記録", 確認種: "確認種", 要確認: "要確認（持ち帰って調べる）", 重要種: "重要種（番号は地点）" }[k]);
  if (jobPtsDrawn.length) legRow((x, y) => { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = "#ffd600"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#333"; g.stroke(); }, "調査地点（トラップ等）");
  for (const [nm, st] of lineLegend) legRow((x, y) => { g.strokeStyle = st.color; g.lineWidth = 4; g.setLineDash(st.dash); g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.stroke(); g.setLineDash([]); }, nm);
  if (vegUsed.size) {
    // 記録した地点の凡例を先に。入りきらない分は「ほか N 凡例」
    const atPts = new Set(shown.map((p) => p.veg).filter(Boolean));
    const vs = [...vegUsed].sort((a, b) => (atPts.has(b[0]) ? 1 : 0) - (atPts.has(a[0]) ? 1 : 0));
    const room = Math.floor((LYMAX - ly) / 28) + 1;
    const take = vs.length > room ? vs.slice(0, Math.max(0, room - 1)) : vs;
    for (const [nm, col] of take) legRow((x, y) => { g.globalAlpha = 0.55; g.fillStyle = col; g.fillRect(x - 12, y - 9, 24, 18); g.globalAlpha = 1; g.strokeStyle = "#777"; g.lineWidth = 1; g.strokeRect(x - 12, y - 9, 24, 18); }, "植生: " + nm);
    if (take.length < vs.length) legRow(() => {}, `植生 ほか ${vs.length - take.length} 凡例`);
  }
  // 地点の表（右下）
  const TX = FM + 470, TW = MAPW - 470;
  g.font = font(22, true); g.fillStyle = "#222"; g.textAlign = "left"; g.fillText("確認した種など", TX + 8, LY + 14);
  const lines = [];
  for (const p of (focus ? [focus] : pts)) for (const r of p.recs) lines.push(`${p.no}　${r.区分}　${recLabel(r)}${r.個体数 ? "　" + r.個体数 : ""}`);
  const rowsMax = Math.floor((LYMAX - (LY + 46)) / 26), cols = lines.length > rowsMax ? 2 : 1, cw = TW / cols;
  g.font = font(18);
  lines.slice(0, rowsMax * cols).forEach((t, i) => {
    const c = Math.floor(i / rowsMax), r = i % rowsMax;
    let s = t; while (g.measureText(s).width > cw - 16 && s.length > 4) s = s.slice(0, -2) + "…";
    g.fillText(s, TX + 8 + c * cw, LY + 46 + r * 26);
  });
  if (lines.length > rowsMax * cols) g.fillText(`ほか ${lines.length - rowsMax * cols} 件（地点の一覧.xlsx）`, TX + 8, LY + 46 + rowsMax * 26);
  if (numberOnly.length) { g.fillStyle = "#666"; g.font = font(17); g.fillText(`※名前が重なるため番号だけの地点: ${numberOnly.join("・")}（名前は右の表）`, FM + 8, FH - FM - 32); }
  // 出典
  g.fillStyle = "#444"; g.font = font(17); g.textAlign = "left"; g.textBaseline = "bottom";
  g.fillText(`出典：国土地理院（地理院タイル ${fig.背景}）${fig.植生 && vegUsed.size ? "／植生：環境省 現存植生図2024" : ""}／座標：WGS84／作成：${new Date().toLocaleString()}　昆虫調査 現地記録`, FM, FH - FM + 8);
  return cv;
}
async function showFigure(day, focus) {
  toast("位置図を作っています…", 6000);
  const cv = await drawFigure(day || today(), focus || null);
  if (!cv) return toast("その日の地点がありません");
  $("#fig-img").src = cv.toDataURL("image/jpeg", 0.85);
  $("#fig-name").textContent = focus ? `地点 ${focus.no} の位置図（${focus.day}）` : `全体図（${day}）`;
  $("#dlg-fig").showModal();
}

// ---------------------------------------------------------------- 書き出し（zip・Excel・シェープファイル）
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const le16 = (n) => [n & 255, (n >> 8) & 255], le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const head = new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0, ...le32(crc), ...le32(data.length), ...le32(data.length), ...le16(nm.length), 0, 0, ...nm]);
    parts.push(head, data);
    central.push(new Uint8Array([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0, ...le32(crc), ...le32(data.length), ...le32(data.length), ...le16(nm.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(off), ...nm]));
    off += head.length + data.length;
  }
  const cdLen = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...le16(files.length), ...le16(files.length), ...le32(cdLen), ...le32(off), 0, 0]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function colName(i) { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function xlsx(sheetName, header, rows) {
  const enc = new TextEncoder();
  const cell = (r, c, v) => { const ref = colName(c) + r; if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`; if (v === "" || v == null) return ""; return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`; };
  let sh = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>`;
  sh += `<row r="1">` + header.map((h, i) => cell(1, i, h)).join("") + `</row>`;
  rows.forEach((r, i) => { sh += `<row r="${i + 2}">` + r.map((v, c) => cell(i + 2, c, v)).join("") + `</row>`; });
  sh += `</sheetData></worksheet>`;
  return zipStore([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Yu Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sh],
  ].map(([n, s]) => [n, enc.encode(s)]));
}
// 点のシェープファイル（WGS84・日本語は UTF-8 で .cpg を付ける。項目名は 10 バイトまで）
function shapefile(rows, fields) {
  const enc = new TextEncoder();
  const n = rows.length, xs = rows.map((r) => r.lon), ys = rows.map((r) => r.lat);
  const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const header = (len) => { const b = new DataView(new ArrayBuffer(100)); b.setInt32(0, 9994); b.setInt32(24, len / 2); b.setInt32(28, 1000, true); b.setInt32(32, 1, true); bb.forEach((v, i) => b.setFloat64(36 + i * 8, v, true)); return new Uint8Array(b.buffer); };
  const shp = new Uint8Array(100 + n * 28), shx = new Uint8Array(100 + n * 8);
  shp.set(header(shp.length)); shx.set(header(shx.length));
  const dv = new DataView(shp.buffer), dx = new DataView(shx.buffer);
  rows.forEach((r, i) => {
    const o = 100 + i * 28;
    dv.setInt32(o, i + 1); dv.setInt32(o + 4, 10); dv.setInt32(o + 8, 1, true); dv.setFloat64(o + 12, r.lon, true); dv.setFloat64(o + 20, r.lat, true);
    dx.setInt32(100 + i * 8, o / 2); dx.setInt32(104 + i * 8, 10);
  });
  // dbf
  const fl = fields.map(([name, type, len, dec]) => ({ name, type, len, dec: dec || 0 }));
  const recLen = 1 + fl.reduce((a, f) => a + f.len, 0), hLen = 32 + 32 * fl.length + 1;
  const dbf = new Uint8Array(hLen + recLen * n + 1);
  const d = new Date(), hv = new DataView(dbf.buffer);
  dbf[0] = 3; dbf[1] = d.getFullYear() - 1900; dbf[2] = d.getMonth() + 1; dbf[3] = d.getDate();
  hv.setUint32(4, n, true); hv.setUint16(8, hLen, true); hv.setUint16(10, recLen, true);
  fl.forEach((f, i) => {
    const o = 32 + i * 32, nm = enc.encode(f.name).slice(0, 10);
    dbf.set(nm, o); dbf[o + 11] = f.type.charCodeAt(0); dbf[o + 16] = f.len; dbf[o + 17] = f.dec;
  });
  dbf[hLen - 1] = 0x0D;
  const cut = (s, len) => { let b = enc.encode(String(s ?? "")); if (b.length <= len) return b; let t = String(s); while (enc.encode(t).length > len) t = t.slice(0, -1); return enc.encode(t); };
  rows.forEach((r, i) => {
    let o = hLen + i * recLen; dbf[o++] = 0x20;
    fl.forEach((f) => {
      const v = r.values[f.name];
      if (f.type === "N") {
        const s = v === "" || v == null || isNaN(v) ? "" : Number(v).toFixed(f.dec);
        const b = enc.encode(s.padStart(f.len, " ").slice(-f.len)); dbf.set(b, o);
      } else { const b = cut(v, f.len); dbf.fill(0x20, o, o + f.len); dbf.set(b, o); }
      o += f.len;
    });
  });
  dbf[dbf.length - 1] = 0x1A;
  const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  return [["shp", shp], ["shx", shx], ["dbf", dbf], ["prj", enc.encode(prj)], ["cpg", enc.encode("UTF-8")]];
}
async function exportAll() {
  if (!S.points.length) return toast("書き出す地点がありません");
  toast("書き出しの用意をしています…（位置図も作ります）", 8000);
  const job = jobName();
  const enc = new TextEncoder(), files = [], rows = [], input = [], feats = [], shpRows = [];
  const pts = [...S.points].sort((a, b) => a.time - b.time);
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="昆虫調査 現地記録" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  for (const p of pts) {
    const tag = `${p.day.replace(/-/g, "")}_${pad(p.no)}`;
    const w = whereIs(p.lat, p.lon);
    const names = p.recs.map((r) => r.和名 || r.環境 || r.区分).filter(Boolean);
    gpx += `<wpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.alt != null ? `<ele>${p.alt}</ele>` : ""}<time>${new Date(p.time).toISOString()}</time><name>${xml(`${p.day.slice(5)} ${p.no} ${names.slice(0, 2).join("・")}`)}</name><desc>${xml(names.join("、"))}</desc></wpt>\n`;
    feats.push({ type: "Feature", properties: { 日: p.day, 地点: p.no, 植生: p.veg, 範囲: w.範囲 || "", 記録: names.join("、") }, geometry: { type: "Point", coordinates: [+p.lon.toFixed(7), +p.lat.toFixed(7)] } });
    const recs = p.recs.length ? p.recs : [{ 区分: "", photos: [] }];
    let k = 0;
    for (const r of recs) {
      const sp = S.byName && S.byName.get(r.和名);
      const phNames = [];
      for (const pid of r.photos || []) {
        const ph = await getPhoto(pid); if (!ph) continue;
        const nm = `${tag}_${pad(++k)}_${(r.和名 || r.区分 || "地点").replace(/[\\/:*?"<>|]/g, "")}${ph.種類 ? "_" + ph.種類 : ""}.jpg`;
        files.push(["写真/" + nm, new Uint8Array(await ph.blob.arrayBuffer())]); phNames.push(nm);
      }
      const rank = marksOf(r.和名).map((m) => m.full).join("、");
      rows.push([p.day, p.no, r.区分 || "", r.和名 || "", sp ? sp[1] : "", sp ? sp[2] : "", rank, r.個体数 || "", r.状態 || "", r.方法 || "", r.メモ || "", r.環境 || "", r.植物 || "",
        +p.lat.toFixed(7), +p.lon.toFixed(7), p.acc != null ? p.acc : "", p.how + (p.moved ? "（手で直した）" : ""), hm(new Date(p.time)),
        r.季節 || "", r.調査地点 || "", p.veg || "", w.範囲 || "", w.近く || "", phNames.join("、"), r.カメラ番号 || "", p.gps番号 || "", p.gps機種 || "", r.数え済み ? "○" : ""]);
      shpRows.push({ lat: p.lat, lon: p.lon, values: { 日: p.day, 地点: p.no, 区分: r.区分 || "", 和名: r.和名 || "", 学名: sp ? sp[1] : "", 科: sp ? sp[2] : "", 重要種: rank,
        個体数: r.個体数 || "", 状態: r.状態 || "", 方法: r.方法 || "", 環境: r.環境 || "", 植物: r.植物 || "", メモ: r.メモ || "", 誤差: p.acc, 植生: p.veg || "", 範囲: w.範囲 || "", 写真: phNames.join("、"),
        カメラ: r.カメラ番号 || "", GPS番号: p.gps番号 || "", GPS機種: p.gps機種 || "" } });
      if (r.和名 && (r.区分 === "重要種" || r.区分 === "確認種") && !r.数え済み) input.push([r.和名, parseInt(r.個体数, 10) || 1, r.方法 || "", r.調査地点 || "", r.その他 || "", r.季節 || "",
        [r.状態, r.メモ, `現地記録 地点${p.no}`].filter(Boolean).join(" "), p.day]);
    }
  }
  gpx += "</gpx>\n";
  const shp = shapefile(shpRows, [["日", "C", 10], ["地点", "N", 4], ["区分", "C", 9], ["和名", "C", 90], ["学名", "C", 90], ["科", "C", 45],
    ["重要種", "C", 150], ["個体数", "C", 30], ["状態", "C", 60], ["方法", "C", 45], ["環境", "C", 200], ["植物", "C", 200], ["メモ", "C", 254], ["誤差", "N", 6],
    ["植生", "C", 90], ["範囲", "C", 60], ["写真", "C", 254], ["カメラ", "C", 60], ["GPS番号", "C", 20], ["GPS機種", "C", 40]]);
  for (const [ext, data] of shp) files.push([`シェープファイル/現地記録_地点.${ext}`, data]);
  // 位置図（日ごとの全体図と、地点ごとの拡大図）
  const days = [...new Set(pts.map((p) => p.day))];
  for (const day of days) {
    const cv = await drawFigure(day, null);
    if (cv) files.push([`位置図/全体図_${day.replace(/-/g, "")}.png`, new Uint8Array(await (await new Promise((ok) => cv.toBlob(ok, "image/png"))).arrayBuffer())]);
    if (S.fig.拡大図) for (const p of pts.filter((q) => q.day === day && q.recs.length)) {
      const c2 = await drawFigure(day, p);
      if (c2) files.push([`位置図/${day.replace(/-/g, "")}_${pad(p.no)}_位置図.png`, new Uint8Array(await (await new Promise((ok) => c2.toBlob(ok, "image/png"))).arrayBuffer())]);
    }
  }
  files.unshift(
    ["地点の一覧.xlsx", xlsx("地点の一覧", ["日", "地点", "区分", "和名", "学名", "科", "重要種・外来種", "個体数", "確認したもの", "方法", "メモ", "生息環境", "周囲の植物",
      "緯度", "経度", "誤差m", "位置の取り方", "時刻", "季節", "調査地点", "植生図の凡例", "範囲", "近くの調査地点", "写真", "デジカメの画像番号", "GPS のプロット番号", "使った GPS", "入力画面で数えた"], rows)],
    ["入力データ.xlsx", xlsx("入力データ", ["和名", "個体数", "採集方法", "地点", "その他", "季節", "備考", "採集日"], input)],
    ["地点.gpx", enc.encode(gpx)],
    ["地点.geojson", enc.encode(JSON.stringify({ type: "FeatureCollection", features: feats }))],
    ["説明.txt", enc.encode([`現地記録の書き出し（${job}、${new Date().toLocaleString()}）`,
      "地点の一覧.xlsx … 記録ごとの行（位置・植生図の凡例・範囲の中か外か・写真の名前）",
      "入力データ.xlsx … 業務の 入力 フォルダに置くと 1_入力データをまとめる で集計に入る（7 列＋採集日。重要種・確認種の記録。",
      "                 種名の入力画面で数えた記録（📍から来た・地点の一覧の「入力画面で数えた」○）は二重にならないよう入れていない）",
      "シェープファイル … 現地記録_地点（点。WGS84。日本語は UTF-8、.cpg 付き。QGIS・ArcGIS で開ける）",
      "地点.gpx … ガーミンなどに入れられる。地点.geojson … QGIS などで開ける",
      "位置図 … A4 縦（150 dpi）。日ごとの全体図と、地点ごとの拡大図（写真と同じ 日付_地点 の名前）",
      "写真 … 長辺 1600。名前は 日付_地点_番号_和名",
      `背景の地図の出典: 国土地理院。植生: 環境省 現存植生図2024`].join("\r\n") + "\r\n")]);
  const name = `${job}_現地記録_${stamp()}.zip`;
  const blob = new Blob([zipStore(files)], { type: "application/zip" });
  const file = new File([blob], name, { type: "application/zip" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); toast("書き出しました: " + name); return; } catch (e) { if (e && e.name === "AbortError") return toast("共有をやめました"); }
  }
  const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  toast("書き出しました: " + name);
}

// ---------------------------------------------------------------- 起動
function pickMap(fromBundle, fromFile) {
  if (fromBundle && fromFile) return (fromFile.作成 || "") > (fromBundle.作成 || "") && fromFile.業務 === fromBundle.業務 ? fromFile : fromBundle;
  return fromBundle || fromFile || null;
}
// 入力欄に出す項目（業務ごと。発注者・調査項目で記入する欄が変わる。祝 2026-10-04）
// 地図・写真・和名・個体数は いつも出す（祝 2026-10-04「固定でもよい」）。ここに無い項目は選べない
const FIELDS = [["方法", "方法"], ["状態", "確認したもの（成虫・幼虫・足跡 など）"], ["メモ", "メモ"], ["環境", "生息環境"],
  ["植物", "周囲で確認された植物"], ["カメラ", "デジカメの画像番号"], ["GPS", "GPS のプロット番号・使った GPS"], ["数え済み", "入力画面で数えた（印）"]];
const FIXED = new Set(["個体数", "写真"]);
function fieldsForm() {
  const box = $("#fields-box"); box.innerHTML = "";
  for (const [k, label] of FIELDS) {
    const cb = el("input", { type: "checkbox", onchange: async () => { S.fields[k] = cb.checked; await kvSet("fields:" + jobName(), S.fields); if (S.cur && !S.editing) openPoint(S.cur); } });
    cb.checked = S.fields[k] !== false;
    box.append(el("label", { class: "chk" }, cb, " " + label));
  }
}
function figForm() {
  const f = S.fig;
  $("#fig-title").value = f.図の名前; $("#fig-koumoku").value = f.項目; $("#fig-bg").value = f.背景;
  $("#fig-veg").checked = !!f.植生; $("#fig-zoom").checked = !!f.拡大図;
  const save = () => { S.fig = { 図の名前: $("#fig-title").value.trim() || FIG_DEF.図の名前, 項目: $("#fig-koumoku").value.trim(), 背景: $("#fig-bg").value, 植生: $("#fig-veg").checked, 拡大図: $("#fig-zoom").checked }; kvSet("fig", S.fig); };
  for (const id of ["#fig-title", "#fig-koumoku", "#fig-bg", "#fig-veg", "#fig-zoom"]) $(id).onchange = save;
  const days = [...new Set(S.points.map((p) => p.day))].sort().reverse();
  const sel = $("#fig-day"); sel.innerHTML = "";
  for (const d of days.length ? days : [today()]) sel.append(el("option", { value: d }, d));
}
function buildOlds() { if (!S.olds && S.bundle) S.olds = (S.bundle.olds || []).map(([n, t]) => ({ k: skey(n), n, t })); }
async function boot() {
  await openDB();
  initMap();
  const mb = await readMainBundle();
  S.bundle = mb.bundle || null; S.axes = mb.axes || {}; S.masterBit = mb.masterBit || 1;
  if (S.bundle) {
    S.byName = new Map(S.bundle.species.map((sp) => [sp[0], sp]));
    S.olds = null; setTimeout(buildOlds, 400);   // 旧名の検索キーは 地図が出てから裏で作る（切り替えを待たせない。祝 2026-10-04）
    $("#title").textContent = "現地記録　" + S.bundle.case;
  } else { S.olds = []; toast("種名の入力画面で 業務ファイル を読み込むと、和名を索引から選べます", 4000); }
  S.usage = (await kvGet("usage")) || {};
  S.fig = { ...FIG_DEF, ...((await kvGet("fig")) || {}) };
  S.gpsModel = (await kvGet("gpsModel")) || "";
  S.fields = (await kvGet("fields:" + jobName())) || {};
  // 地点は業務ごと（祝 2026-10-04）。いま開いている業務の地点だけを扱う（地図・一覧・位置図・書き出し）。
  // 業務名の無い前の地点は、いま開いている業務のものとする（入力画面の記録と同じ考え）
  const all = (await allPoints()) || [];
  for (const p of all) if (!p.業務) { p.業務 = jobName(); await putPoint(p); }
  S.points = all.filter((p) => p.業務 === jobName());
  S.others = all.length - S.points.length;
  S.vegSaved = (await kvGet("vegSaved")) || null;
  applyMapdata(pickMap(S.bundle && S.bundle.genchiMap, await kvGet("mapdata")));
  drawPoints();
  // 入力画面と行き来しても、最後に見ていた所に戻る（祝 2026-10-04「画面を切り替えながら作業したい」）
  const view = await kvGet("view");
  if (view && view.業務 === jobName()) map.setView([view.lat, view.lon], view.z); else fitJob();
  map.on("moveend", () => { const c = map.getCenter(); kvSet("view", { 業務: jobName(), lat: c.lat, lon: c.lng, z: map.getZoom() }).catch(() => {}); });   // 頁を離れる途中は保存できないので捨てる
  $("#go-input").onclick = (e) => { if (!leaveOk()) e.preventDefault(); };
  // 種名の入力画面の 📍 から: その場で地点を測り、和名と区分を入れた入力欄を開く（入力画面で数えた印つき）
  if (location.hash === "#list") { history.replaceState(null, "", location.pathname); showTab("list"); }
  const qs = new URL(location.href).searchParams, add = qs.get("add");
  if (add) {
    history.replaceState(null, "", location.pathname);       // 読み直しで二度足さない
    const ms = marksOf(add);
    const kubun = ms.some((m) => !m.alien) ? "重要種" : "確認種";
    toast(`${add} の地点を測っています…`);
    await newPoint({ 和名: add, 区分: kubun, 数え済み: qs.get("from") === "input" });
  }
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  $("#btn-here").onclick = () => newPoint();
  $("#btn-cross").onclick = () => newPoint(null, true);
  if (await kvGet("cross")) S.setCross(true);
  $("#tab-map").onclick = () => showTab("map");
  $("#tab-list").onclick = () => showTab("list");
  $("#btn-menu").onclick = () => {
    const n = S.points.length, r = S.points.reduce((a, p) => a + p.recs.length, 0);
    $("#rec-info").textContent = `この業務（${jobName()}）: 地点 ${n}・記録 ${r}` + (S.others ? `（ほかの業務の地点 ${S.others} は隠れています。その業務の業務ファイルを読み込むと出ます）` : "");
    $("#ver").textContent = `現地記録 ${GENCHI_VERSION}（試作品）　業務ファイル: ${S.bundle ? S.bundle.case : "なし"}${S.bundle && S.bundle.genchiMap ? "（地図入り）" : ""}`;
    figForm(); fieldsForm(); storageInfo();
    $("#dlg-menu").showModal();
  };
  $("#btn-close-menu").onclick = () => $("#dlg-menu").close();
  $("#btn-cache").onclick = () => cacheArea();
  $("#btn-cache-view").onclick = () => cacheView();
  $("#btn-clear-tiles").onclick = () => clearTiles();
  drawSaved((await kvGet("savedAreas")) || []);
  $("#btn-export").onclick = () => { $("#dlg-menu").close(); exportAll(); };
  $("#btn-fig").onclick = () => { $("#dlg-menu").close(); showFigure($("#fig-day").value, null); };
  $("#fig-close").onclick = () => $("#dlg-fig").close();
  $("#btn-clear").onclick = async () => {
    const old = S.points.filter((p) => p.day !== today());
    if (!old.length) return toast("今日より前の地点はありません");
    if (!confirm(`今日より前の地点 ${old.length} と、その記録・写真を端末から消します。書き出しは済みましたか？`)) return;
    for (const p of old) { for (const r of p.recs) for (const pid of r.photos || []) await delPhoto(pid); await delPoint(p.id); }
    S.points = S.points.filter((p) => p.day === today()); drawPoints(); $("#dlg-menu").close(); toast(`${old.length} 地点を消しました`);
  };
  $("#file-map").onchange = async (e) => {
    try {
      const md = JSON.parse(await e.target.files[0].text());
      if (md.種類 !== "現地記録用の地図") throw new Error("現地記録用の地図のファイルではありません");
      await kvSet("mapdata", md); applyMapdata(md); fitJob(); $("#dlg-menu").close(); toast(`業務の地図「${md.業務}」を読み込みました`);
    } catch (err) { toast("読み込めませんでした: " + (err.message || err)); }
    e.target.value = "";
  };
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    // 新しい版が裏で入ったら 上に知らせる。押すまで読み直さない（入力の途中で画面を変えない。祝 2026-10-04）
    const hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadCtl || document.getElementById("new-ver")) return;
      const d = document.createElement("div"); d.id = "new-ver";
      d.textContent = "新しい版があります（押すと切り替え）";
      const hd = document.querySelector("header");   // 上のタブ（入力｜地図｜一覧）にかぶせない
      d.style.cssText = "position:fixed;left:8px;right:8px;top:" + ((hd ? hd.getBoundingClientRect().bottom : 0) + 4) + "px;z-index:5000;background:#1565c0;color:#fff;padding:8px 10px;border-radius:6px;text-align:center;font-size:15px;box-shadow:0 2px 6px rgba(0,0,0,.3)";
      d.onclick = () => location.reload();
      document.body.append(d);
    });
  }
}
window.__genchi = { S, newPoint, openPoint, exportAll, vegAt, drawFigure, whereIs, shapefile, map: () => map };
boot();
})();
