/* 業務の地図を描く（PC 向け。2026-10-04 祝の依頼）
 * 点（トラップ・調査地点）・線（ルート）・範囲（事業範囲）を描き、m 指定のバッファを作り、
 * 業務フォルダの「地図」に置く KML・ガーミン用 GPX・GeoJSON に書き出す。いまある KML・GPX・GeoJSON も読める。
 * バッファは 地図を細かい升目に分けて図形までの距離を測り、その m の所を等高線のようにつないで作る
 * （凹んだ範囲・くねった線・複数の図形の重なりでも崩れない）。
 * 描いている途中のものはブラウザ（localStorage）に残す。
 */
(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const c of kids) if (c != null) e.append(c); return e; };
const COLORS = { 赤: "#e53935", 緑: "#2e9e44", 青: "#1565c0", 黄: "#f9a825", 紫: "#8e24aa", 橙: "#ef6c00", 黒: "#333333" };
const GARMIN = { 赤: "Red", 緑: "Green", 青: "Blue", 黄: "Yellow", 紫: "Magenta", 橙: "DarkYellow", 黒: "Black" };
const S = { feats: [], sel: new Set(), mode: null, draft: [], editing: null, next: 1 };
let map, group, draftLayer, vxLayer;

function status(msg) { const s = $("#status"); s.textContent = msg || ""; s.style.display = msg ? "block" : "none"; }
function save() { try { localStorage.setItem("draw:state", JSON.stringify({ feats: S.feats, job: $("#job").value, next: S.next })); } catch (e) { /* 残せない端末 */ } }
function load() { try { const d = JSON.parse(localStorage.getItem("draw:state") || "null"); if (d) { S.feats = d.feats || []; $("#job").value = d.job || ""; S.next = d.next || 1; } } catch (e) { /* 無視 */ } }
function guess(name, type) {
  if (/バッファ/.test(name)) return { kind: "バッファ", color: "緑" };
  if (/事業|範囲|区域/.test(name)) return { kind: "範囲", color: "赤" };
  if (/ルート|踏査|道/.test(name)) return { kind: "ルート", color: "紫" };
  if (type === "Point") return { kind: /St|ST|トラップ|ピット|ライト/.test(name) ? "トラップ" : "調査地点", color: "黄" };
  return { kind: type === "LineString" ? "線" : "範囲", color: type === "LineString" ? "青" : "赤" };
}
function addFeat(type, coords, name, kind, color) {
  const g = guess(name || "", type);
  const f = { id: S.next++, type, coords, name: name || "", kind: kind || g.kind, color: color || g.color };
  S.feats.push(f); return f;
}

// ---------------------------------------------------------------- 描画
function render() {
  group.clearLayers();
  for (const f of S.feats) {
    const col = COLORS[f.color] || "#1565c0", sel = S.sel.has(f.id), dash = f.kind === "バッファ" ? "8 6" : null;
    let ly;
    if (f.type === "Point") {
      ly = L.marker([f.coords[1], f.coords[0]], { draggable: true, icon: L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${col};border:2px solid ${sel ? "#1565c0" : "#333"};box-shadow:${sel ? "0 0 0 3px #90caf9" : "none"}"></div>` }) });
      ly.on("dragend", () => { const p = ly.getLatLng(); f.coords = [p.lng, p.lat]; save(); });
      if (f.name) ly.bindTooltip(f.name, { permanent: true, direction: "right", className: "lbl", offset: [8, 0] });
    } else {
      const ll = (ring) => ring.map((c) => [c[1], c[0]]);
      const st = { color: col, weight: sel ? 5 : 3, dashArray: dash, fillOpacity: f.kind === "バッファ" ? 0 : 0.08 };
      if (f.type === "LineString") ly = L.polyline(ll(f.coords), st);
      else if (f.type === "Polygon") ly = L.polygon(f.coords.map(ll), st);
      else ly = L.polygon(f.coords.map((pg) => pg.map(ll)), st);
      if (f.name) ly.bindTooltip(f.name, { sticky: true });
    }
    ly.on("click", (e) => { if (S.mode) return; L.DomEvent.stopPropagation(e); pick(f.id, e.originalEvent && (e.originalEvent.ctrlKey || e.originalEvent.metaKey)); });
    group.addLayer(ly);
  }
  renderList(); drawVertices(); save();
}
function renderList() {
  const ul = $("#list"); ul.innerHTML = "";
  if (!S.feats.length) ul.append(el("li", { class: "hint" }, "まだありません。上で描くか、KML などを読み込みます。"));
  for (const f of S.feats) {
    const t = { Point: "点", LineString: "線", Polygon: "範囲", MultiPolygon: "範囲" }[f.type];
    ul.append(el("li", { class: S.sel.has(f.id) ? "sel" : "", onclick: (e) => pick(f.id, e.ctrlKey || e.metaKey) },
      el("span", { class: "sw", style: `background:${COLORS[f.color] || "#999"}` }), el("span", {}, f.name || "（名前なし）"), el("span", { class: "k" }, `${f.kind}・${t}`)));
  }
  const one = S.sel.size === 1 ? S.feats.find((f) => S.sel.has(f.id)) : null;
  $("#sel-box").style.display = one ? "" : "none";
  if (one) { $("#s-name").value = one.name; $("#s-kind").value = one.kind; $("#s-color").value = one.color; $("#s-edit").disabled = one.type === "Point" || one.type === "MultiPolygon"; $("#s-edit").textContent = S.editing === one.id ? "頂点を直し終える" : "頂点を直す"; }
}
function pick(id, add) {
  if (!add) S.sel.clear();
  S.sel.has(id) && add ? S.sel.delete(id) : S.sel.add(id);
  if (S.editing && !S.sel.has(S.editing)) S.editing = null;
  render();
}
function drawVertices() {
  vxLayer.clearLayers();
  const f = S.feats.find((x) => x.id === S.editing); if (!f) return;
  const ring = f.type === "Polygon" ? f.coords[0] : f.coords;
  const closed = f.type === "Polygon";
  const n = closed ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    const m = L.marker([ring[i][1], ring[i][0]], { draggable: true, icon: L.divIcon({ className: "", html: '<div class="vx"></div>', iconSize: [12, 12] }) });
    m.on("drag", () => { const p = m.getLatLng(); ring[i] = [p.lng, p.lat]; if (closed && i === 0) ring[ring.length - 1] = [p.lng, p.lat]; renderShapesOnly(); });
    m.on("dragend", () => render());
    vxLayer.addLayer(m);
  }
}
function renderShapesOnly() { const keep = S.editing; S.editing = null; group.clearLayers(); render(); S.editing = keep; }

// ---------------------------------------------------------------- 描く
function setMode(m) {
  S.mode = m; S.draft = []; draftLayer.clearLayers();
  for (const [id, mm] of [["#m-point", "point"], ["#m-line", "line"], ["#m-poly", "poly"]]) $(id).classList.toggle("on", m === mm);
  for (const id of ["#d-done", "#d-undo", "#d-cancel"]) $(id).disabled = !m;
  if (m) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  map.getContainer().style.cursor = m ? "crosshair" : "";
  status(m === "point" ? "地図を押して点を置きます（続けて置ける）。終わるときは「描き終える」か Esc" : m === "line" ? "地図を押して線を描きます。ダブルクリックか「描き終える」で終わり" : m === "poly" ? "地図を押して囲みます。最初の点（赤い丸）を押すと閉じます" : "");
}
function drawDraft() {
  draftLayer.clearLayers();
  if (!S.draft.length) return;
  draftLayer.addLayer(L.polyline(S.draft, { color: "#1565c0", weight: 2, dashArray: "4 4" }));
  S.draft.forEach((p, i) => {
    const m = L.marker(p, { icon: L.divIcon({ className: "", html: `<div class="vx${i === 0 && S.mode === "poly" ? " first" : ""}"></div>`, iconSize: [12, 12] }) });
    if (i === 0 && S.mode === "poly") m.on("click", (e) => { L.DomEvent.stopPropagation(e); finish(); });
    draftLayer.addLayer(m);
  });
}
function onMapClick(e) {
  if (!S.mode) { if (S.sel.size) { S.sel.clear(); S.editing = null; render(); } return; }
  if (S.mode === "point") {
    const n = S.feats.filter((f) => f.type === "Point").length + 1;
    const f = addFeat("Point", [e.latlng.lng, e.latlng.lat], `${$("#p-prefix").value}${n}`, $("#p-kind").value, "黄");
    S.sel = new Set([f.id]); render(); return;
  }
  S.draft.push(e.latlng); drawDraft();
}
function finish() {
  if (S.mode === "line" && S.draft.length >= 2) {
    const f = addFeat("LineString", S.draft.map((p) => [p.lng, p.lat]), "ルート", "ルート", "紫"); S.sel = new Set([f.id]);
  } else if (S.mode === "poly" && S.draft.length >= 3) {
    const ring = S.draft.map((p) => [p.lng, p.lat]); ring.push(ring[0]);
    const f = addFeat("Polygon", [ring], "事業範囲", "範囲", "赤"); S.sel = new Set([f.id]);
  }
  setMode(null); render();
  if (S.sel.size === 1) { $("#s-name").focus(); $("#s-name").select(); }
}

// ---------------------------------------------------------------- バッファ（升目の距離から等高線で）
function bufferOf(feats, d) {
  const all = []; for (const f of feats) { if (f.type === "Point") all.push(f.coords); else if (f.type === "LineString") all.push(...f.coords); else if (f.type === "Polygon") all.push(...f.coords[0]); else for (const pg of f.coords) all.push(...pg[0]); }
  const lat0 = all.reduce((a, c) => a + c[1], 0) / all.length, lon0 = all.reduce((a, c) => a + c[0], 0) / all.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const P = (c) => [(c[0] - lon0) * kx, (c[1] - lat0) * ky], Q = (p) => [p[0] / kx + lon0, p[1] / ky + lat0];
  const segs = [], pts = [], polys = [];
  for (const f of feats) {
    if (f.type === "Point") pts.push(P(f.coords));
    else if (f.type === "LineString") { const r = f.coords.map(P); for (let i = 1; i < r.length; i++) segs.push([r[i - 1], r[i]]); }
    else { const pgs = f.type === "Polygon" ? [f.coords] : f.coords; for (const pg of pgs) { const r = pg[0].map(P); polys.push(r); for (let i = 1; i < r.length; i++) segs.push([r[i - 1], r[i]]); } }
  }
  const xs = [], ys = []; for (const s of segs) for (const p of s) { xs.push(p[0]); ys.push(p[1]); } for (const p of pts) { xs.push(p[0]); ys.push(p[1]); }
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let cell = Math.max(d / 20, Math.max(x1 - x0 + 2 * d, y1 - y0 + 2 * d) / 700);
  x0 -= d + 3 * cell; y0 -= d + 3 * cell; x1 += d + 3 * cell; y1 += d + 3 * cell;
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
  const inside = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const segDist2 = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const px = a[0] + t * dx - x, py = a[1] + t * dy - y; return px * px + py * py; };
  const F = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, y = y0 + j * cell;
    let m = Infinity;
    if (polys.some((r) => inside(x, y, r))) m = 0;
    else { for (const s of segs) { const v = segDist2(x, y, s[0], s[1]); if (v < m) m = v; } for (const p of pts) { const v = (x - p[0]) ** 2 + (y - p[1]) ** 2; if (v < m) m = v; } m = Math.sqrt(m); }
    F[j * nx + i] = m - d;
  }
  const v = (i, j) => F[j * nx + i];
  // 等高線（マーチングスクエア）: 辺に名前を付けてつなぐ（浮動小数で比べないので確実に閉じる）
  const ptOf = new Map(), next = new Map();
  const edgePt = (key) => {
    if (ptOf.has(key)) return;
    const [k, i, j] = key.split(":").map((s, n) => (n ? +s : s));
    let a, b, pa, pb;
    if (k === "h") { a = v(i, j); b = v(i + 1, j); pa = [x0 + i * cell, y0 + j * cell]; pb = [x0 + (i + 1) * cell, y0 + j * cell]; }
    else { a = v(i, j); b = v(i, j + 1); pa = [x0 + i * cell, y0 + j * cell]; pb = [x0 + i * cell, y0 + (j + 1) * cell]; }
    const t = a / (a - b);
    ptOf.set(key, [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]);
  };
  const link = (p, q) => { edgePt(p); edgePt(q); next.set(p, q); };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v(i, j) < 0, b = v(i + 1, j) < 0, c = v(i + 1, j + 1) < 0, dd = v(i, j + 1) < 0;
    const idx = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (dd ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const B = `h:${i}:${j}`, R = `v:${i + 1}:${j}`, T = `h:${i}:${j + 1}`, Lf = `v:${i}:${j}`;
    // 内側（値が負）を左に見て回る向きでつなぐ
    const center = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 < 0;
    switch (idx) {
      case 1: link(Lf, B); break; case 2: link(B, R); break; case 3: link(Lf, R); break;
      case 4: link(R, T); break; case 6: link(B, T); break; case 7: link(Lf, T); break;
      case 8: link(T, Lf); break; case 9: link(T, B); break; case 11: link(T, R); break;
      case 12: link(R, Lf); break; case 13: link(R, B); break; case 14: link(B, Lf); break;
      case 5: if (center) { link(Lf, T); link(R, B); } else { link(Lf, B); link(R, T); } break;
      case 10: if (center) { link(B, Lf); link(T, R); } else { link(B, R); link(T, Lf); } break;
    }
  }
  const rings = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring = []; let k = start;
    while (k && !seen.has(k)) { seen.add(k); ring.push(ptOf.get(k)); k = next.get(k); }
    if (ring.length >= 4) rings.push(simplify(ring, cell * 0.3));
  }
  // 外周と穴に分ける（ほかの輪に含まれる数が偶数なら外周）
  const area = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
  const depth = rings.map((r, i) => rings.filter((o, k) => k !== i && inside(r[0][0], r[0][1], o)).length);
  const outers = rings.map((r, i) => ({ r, i })).filter((o) => depth[o.i] % 2 === 0);
  const polysOut = outers.map((o) => [o.r]);
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 0) return;
    const host = outers.filter((o) => inside(r[0][0], r[0][1], o.r)).sort((a, b) => Math.abs(area(a.r)) - Math.abs(area(b.r)))[0];
    if (host) polysOut[outers.indexOf(host)].push(r);
  });
  const geo = polysOut.map((pg) => pg.map((r) => { const c = r.map(Q); c.push(c[0]); return c; }));
  return geo.length === 1 ? { type: "Polygon", coords: geo[0] } : { type: "MultiPolygon", coords: geo };
}
function simplify(pts, tol) {          // ダグラス・ポイカー（輪のまま）
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function makeBuffer() {
  const d = parseFloat($("#b-m").value);
  if (!(d > 0)) return alert("バッファの幅（m）を入れてください");
  const src = S.feats.filter((f) => S.sel.has(f.id));
  if (!src.length) return alert("描いたものの一覧で、もとにするものを選んでください（Ctrl で複数）");
  status("バッファを作っています…");
  setTimeout(() => {
    const t = performance.now();
    const g = bufferOf(src, d);
    const base = src.length === 1 ? src[0].name : "選んだもの";
    const f = addFeat(g.type, g.coords, `${base}バッファ${d}m`, "バッファ", "緑");
    S.sel = new Set([f.id]); render();
    status(`バッファ ${d} m を作りました（${Math.round(performance.now() - t)} ms）`); setTimeout(() => status(""), 3000);
  }, 30);
}

// ---------------------------------------------------------------- 読み込み
const local = (t) => t.replace(/^.*}/, "");
async function readFile(file) {
  const name = file.name.replace(/\.[^.]+$/, "");
  let text;
  if (/\.kmz$/i.test(file.name)) return alert("KMZ はいったん Google Earth などで KML にしてから読み込んでください");
  text = await file.text();
  if (/\.(geojson|json)$/i.test(file.name)) {
    const g = JSON.parse(text);
    for (const f of g.features || []) {
      const p = f.properties || {}, gm = f.geometry; if (!gm) continue;
      if (["Point", "LineString", "Polygon", "MultiPolygon"].includes(gm.type)) addFeat(gm.type, gm.coordinates, p.name || p.名前 || name, p.kind || p.種類, p.color || p.色);
    }
    return;
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const nm = (e) => { const n = [...e.children].find((c) => local(c.tagName) === "name"); return (n && n.textContent.trim()) || ""; };
  const clean = (s) => s.replace(/\.gpx\(\d+\)$/i, "");
  if (/\.gpx$/i.test(file.name)) {
    for (const w of doc.getElementsByTagName("wpt")) addFeat("Point", [+w.getAttribute("lon"), +w.getAttribute("lat")], nm(w));
    for (const t of [...doc.getElementsByTagName("trk"), ...doc.getElementsByTagName("rte")]) {
      const pts = [...t.getElementsByTagName("trkpt"), ...t.getElementsByTagName("rtept")].map((p) => [+p.getAttribute("lon"), +p.getAttribute("lat")]);
      if (pts.length < 2) continue;
      const n = clean(nm(t)) || name, a = pts[0], b = pts[pts.length - 1];
      const closed = pts.length > 3 && Math.hypot((a[0] - b[0]) * 93000, (a[1] - b[1]) * 111000) < 30;
      if (closed) { if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a); addFeat("Polygon", [pts], n.replace(/^.*?_/, "")); }
      else addFeat("LineString", pts, n.replace(/^.*?_/, ""));
    }
    return;
  }
  const coords = (e) => { const c = e.getElementsByTagName("coordinates")[0]; return c ? c.textContent.trim().split(/\s+/).map((t) => t.split(",").slice(0, 2).map(Number)) : []; };
  for (const pm of doc.getElementsByTagName("Placemark")) {
    const n = nm(pm);
    for (const g of pm.getElementsByTagName("Point")) addFeat("Point", coords(g)[0], n);
    for (const g of pm.getElementsByTagName("LineString")) addFeat("LineString", coords(g), n);
    for (const g of pm.getElementsByTagName("Polygon")) {
      const ob = g.getElementsByTagName("outerBoundaryIs")[0] || g;
      const rings = [coords(ob), ...[...g.getElementsByTagName("innerBoundaryIs")].map(coords)];
      addFeat("Polygon", rings, n);
    }
  }
}

// ---------------------------------------------------------------- 書き出し
const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove();
}
const job = () => ($("#job").value.trim() || "業務").replace(/[\\/:*?"<>|]/g, "");
function toKML() {
  const kc = (hex, a) => a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
  const cs = (r) => r.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)},0`).join(" ");
  const poly = (pg) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${cs(pg[0])}</coordinates></LinearRing></outerBoundaryIs>${pg.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${cs(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(job())}</name>\n`;
  for (const f of S.feats) {
    const col = COLORS[f.color] || "#1565c0";
    s += `<Placemark><name>${xml(f.name)}</name><description>${xml(f.kind)}</description><Style><LineStyle><color>${kc(col, "ff")}</color><width>3</width></LineStyle><PolyStyle><color>${kc(col, f.kind === "バッファ" ? "00" : "33")}</color></PolyStyle><IconStyle><color>${kc(col, "ff")}</color></IconStyle></Style>`;
    if (f.type === "Point") s += `<Point><coordinates>${f.coords[0].toFixed(7)},${f.coords[1].toFixed(7)},0</coordinates></Point>`;
    else if (f.type === "LineString") s += `<LineString><coordinates>${cs(f.coords)}</coordinates></LineString>`;
    else if (f.type === "Polygon") s += poly(f.coords);
    else s += `<MultiGeometry>${f.coords.map(poly).join("")}</MultiGeometry>`;
    s += `</Placemark>\n`;
  }
  return s + "</Document></kml>\n";
}
function toGPX() {
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="昆虫調査 業務の地図を描く" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3">\n`;
  const pre = $("#job").value.trim() ? $("#job").value.trim().slice(0, 4) + " " : "";
  for (const f of S.feats) if (f.type === "Point") s += `<wpt lat="${f.coords[1].toFixed(7)}" lon="${f.coords[0].toFixed(7)}"><name>${xml(pre + f.name)}</name><sym>Flag, Blue</sym></wpt>\n`;
  for (const f of S.feats) {
    if (f.type === "Point") continue;
    const rings = f.type === "LineString" ? [f.coords] : f.type === "Polygon" ? [f.coords[0]] : f.coords.map((pg) => pg[0]);
    s += `<trk><name>${xml(pre + f.name)}</name><extensions><gpxx:TrackExtension><gpxx:DisplayColor>${GARMIN[f.color] || "Blue"}</gpxx:DisplayColor></gpxx:TrackExtension></extensions>`;
    for (const r of rings) s += `<trkseg>${r.map((c) => `<trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}"/>`).join("")}</trkseg>`;
    s += `</trk>\n`;
  }
  return s + "</gpx>\n";
}
function toGeoJSON() {
  return JSON.stringify({ type: "FeatureCollection", features: S.feats.map((f) => ({ type: "Feature", properties: { name: f.name, kind: f.kind, color: f.color }, geometry: { type: f.type, coordinates: f.coords } })) });
}

// ---------------------------------------------------------------- 起動
function boot() {
  map = L.map("map").setView([33.0, 130.7], 12);
  const std = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>' }).addTo(map);
  const photo = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { maxZoom: 20, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>' });
  const veg = L.tileLayer("https://www.biodic.go.jp/kiso/vg/tile/veg2024raster/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 15, opacity: 0.5, attribution: "植生: 環境省生物多様性センター 現存植生図2024" });
  for (const r of document.querySelectorAll('input[name=bg]')) r.onchange = () => { if (r.value === "std") { map.removeLayer(photo); std.addTo(map); } else { map.removeLayer(std); photo.addTo(map); } };
  $("#bg-veg").onchange = (e) => (e.target.checked ? veg.addTo(map) : map.removeLayer(veg));
  group = L.featureGroup().addTo(map); draftLayer = L.layerGroup().addTo(map); vxLayer = L.layerGroup().addTo(map);
  for (const [k] of Object.entries(COLORS)) $("#s-color").append(el("option", { value: k }, k));
  map.on("click", onMapClick);
  map.on("dblclick", () => { if (S.mode === "line" || S.mode === "poly") finish(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (S.mode) setMode(null); else if (S.editing) { S.editing = null; render(); } } });
  $("#m-point").onclick = () => setMode(S.mode === "point" ? null : "point");
  $("#m-line").onclick = () => setMode(S.mode === "line" ? null : "line");
  $("#m-poly").onclick = () => setMode(S.mode === "poly" ? null : "poly");
  $("#d-done").onclick = () => (S.mode === "point" ? setMode(null) : finish());
  $("#d-undo").onclick = () => { if (S.mode === "point") { const f = S.feats.filter((x) => x.type === "Point").pop(); if (f) { S.feats = S.feats.filter((x) => x !== f); render(); } } else { S.draft.pop(); drawDraft(); } };
  $("#d-cancel").onclick = () => setMode(null);
  const one = () => S.feats.find((f) => S.sel.has(f.id));
  $("#s-name").oninput = () => { const f = one(); if (f) { f.name = $("#s-name").value; render(); $("#s-name").focus(); } };
  $("#s-kind").onchange = () => { const f = one(); if (f) { f.kind = $("#s-kind").value; render(); } };
  $("#s-color").onchange = () => { const f = one(); if (f) { f.color = $("#s-color").value; render(); } };
  $("#s-edit").onclick = () => { const f = one(); if (!f) return; S.editing = S.editing === f.id ? null : f.id; render(); status(S.editing ? "四角の頂点をドラッグして直します" : ""); };
  $("#s-del").onclick = () => { if (!S.sel.size || !confirm(`選んだ ${S.sel.size} 件を消します。よいですか？`)) return; S.feats = S.feats.filter((f) => !S.sel.has(f.id)); S.sel.clear(); S.editing = null; render(); };
  $("#b-make").onclick = makeBuffer;
  $("#f-in").onchange = async (e) => {
    for (const f of e.target.files) { try { await readFile(f); } catch (err) { alert(`${f.name} を読めませんでした: ${err.message || err}`); } }
    e.target.value = ""; render(); if (S.feats.length) map.fitBounds(group.getBounds().pad(0.2));
    if (!$("#job").value) $("#job").value = "";
  };
  $("#o-kml").onclick = () => download(`${job()}_地図.kml`, toKML(), "application/vnd.google-earth.kml+xml");
  $("#o-gpx").onclick = () => download(`${job()}_ガーミン.gpx`, toGPX(), "application/gpx+xml");
  $("#o-geojson").onclick = () => download(`${job()}_地図.geojson`, toGeoJSON(), "application/geo+json");
  $("#o-clear").onclick = () => { if (confirm("描いたものを全部消します（書き出したファイルは消えません）。よいですか？")) { S.feats = []; S.sel.clear(); S.editing = null; render(); } };
  $("#job").oninput = save;
  load(); render();
  if (S.feats.length) map.fitBounds(group.getBounds().pad(0.2));
}
window.__draw = { S, bufferOf, toKML, toGPX, render, readFile, map: () => map };
boot();
})();
