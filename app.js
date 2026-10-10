/* 昆虫調査 入力アプリ
 * 外部ライブラリなし。データは端末の IndexedDB に置く。
 *   bundle  … PCで作った スマホ用.json（業務の調査設定、和名の索引）
 *   records … 入力した記録（7列＋採集日、書き出し済みフラグ）
 * 書き出しは xlsx（zip を自前で組む。圧縮なし）。
 */
(() => {
"use strict";

const APP_VERSION = "v58";   // 画面の版（sw.js の VERSION と合わせる。☰ に出す）
const AXES = ["季節", "採集方法", "地点", "その他"];
const COLS = ["和名", "個体数", "採集方法", "地点", "その他", "季節", "備考", "採集日"];
const $ = (s) => document.querySelector(s);
const el = (t, attrs = {}, ...kids) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
};

// ---------------------------------------------------------------- IndexedDB
const DB = { name: "konchu-input", ver: 2, db: null };   // 2: 入れ物が欠けていたら作り直す（現地記録の画面が先に空で作った端末のため）
function openDB() {
  return new Promise((ok, ng) => {
    const r = indexedDB.open(DB.name, DB.ver);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("records")) {
        const s = d.createObjectStore("records", { keyPath: "id", autoIncrement: true });
        s.createIndex("exported", "exported");
      }
    };
    r.onsuccess = () => {
      const d = r.result;
      // 入れ物が欠けている（中身の無い保存場所ができてしまった）ときは、消して作り直す。欠けていれば記録も無いので失うものは無い
      if (!d.objectStoreNames.contains("kv") || !d.objectStoreNames.contains("records")) {
        d.close();
        const del = indexedDB.deleteDatabase(DB.name);
        del.onsuccess = del.onerror = () => openDB().then(ok, ng);
        return;
      }
      d.onversionchange = () => d.close();   // ほかの画面が入れ替えるときは閉じて待たせない
      DB.db = d; ok();
    };
    r.onerror = () => ng(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((ok, ng) => {
    const t = DB.db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => ok(out && out.result !== undefined ? out.result : out);
    t.onerror = () => ng(t.error);
  });
}
const kvGet = (k) => new Promise((ok, ng) => { const r = DB.db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const kvSet = (k, v) => tx("kv", "readwrite", (s) => s.put(v, k));
const allRecords = () => new Promise((ok, ng) => { const r = DB.db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => ok(r.result || []); r.onerror = () => ng(r.error); });
const putRecord = (rec) => new Promise((ok, ng) => { const r = DB.db.transaction("records", "readwrite").objectStore("records").put(rec); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const delRecord = (id) => tx("records", "readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------- 状態
const S = {
  bundle: null,        // スマホ用.json の中身
  masterBit: 1,        // 候補に使うマスタ
  axes: {},            // 選択中の調査設定の値
  records: [],         // 端末内の全記録
  usage: {},           // 和名 → 採用回数（候補の並びに使う。端末内に保存）
  ken: [],             // 候補の並びに使う県（☰ で選ぶ。業務ごとに端末に保存。既定は業務ファイルの kenDefault）
  showAll: false,
  recentTop: false,   // true: 入れた・変えた種を一覧の上に出す（☰ の設定。既定は入れた順で動かさない）
  editing: null,
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
let toastTimer = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2200); }

// 検索キー（PC側 make_mobile_bundle.search_key と同じ規則）
function skey(s) {
  let t = (s || "").normalize("NFKC").trim();
  t = t.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  t = t.replace(/[ 　・･\-‐—―_/／<>()（）]/g, "");
  return t.toLowerCase();
}

// ---------------------------------------------------------------- 業務ファイル
async function loadBundleFile(file) {
  try {
    const text = await file.text();
    const b = JSON.parse(text);
    if (!b || !Array.isArray(b.species) || !b.axes) throw new Error("形式が違います");
    await kvSet("bundle", b);
    await applyBundle(b);
    toast(`業務「${b.case}」を読み込みました（和名 ${b.species.length.toLocaleString()} 件）`);
  } catch (e) {
    toast("読み込めませんでした: " + (e.message || e));
  }
}
// いま開いている業務の記録だけを扱う（別の業務の記録は端末に残したまま隠す）
const mine = () => S.records.filter((r) => (r.業務 || "") === (S.bundle ? S.bundle.case : ""));
function buildOlds() {
  if (S.olds || !S.bundle) return;
  const b = S.bundle;
  S.olds = (b.olds || []).map(([n, t, f]) => ({ k: skey(n), n, t, f }));
  S.oldNames = new Map();                          // 和名 → その種の旧名（候補の行に「旧名: …」を短く出す）
  for (const o of S.olds) for (const i of o.t) {
    const w = (b.species[i] || [])[0]; if (!w) continue;
    if (!/[぀-ヿ一-鿿]/.test(o.n)) continue;   // 「旧名: …」には和名の旧名だけ（古い学名は打って当たったときだけ。祝 2026-10-04）
    if (!S.oldNames.has(w)) S.oldNames.set(w, []);
    S.oldNames.get(w).push(o.n + (o.f ? "※" : ""));
  }
}
async function applyBundle(b) {
  S.bundle = b;
  // 業務名を持たない古い記録は、いま読み込んだ業務のものとして扱う（1業務しか無かった頃の記録）
  for (const r of S.records) {
    if (!r.業務) { r.業務 = b.case; await putRecord(r); }
  }
  // 和名 → 種（一覧の行に重要種・外来種の印を出すため）
  S.byName = new Map(b.species.map((sp) => [sp[0], sp]));
  // 旧名（シノニム名。名前引き台帳の 名前の変遷 から。2026-09-29）: [旧名, [species の行の番号…], 印（1＝ほかの種にも使われた名前）]
  // 旧名の検索キーは 画面が出てから裏で作る（画面の切り替えを待たせない。打つ前に作り終わるので打つときも重くならない。祝 2026-10-04）
  S.olds = null; S.oldNames = null;
  setTimeout(buildOlds, 400);
  const def = (b.masters || []).find((m) => m[0] === (b.masterDefault || "統合"));
  const saved = await kvGet("masterBit");
  S.masterBit = saved || (def ? def[1] : 1);
  // 候補の並びに使う県（水国の調査で 県ごとに確認された多さ。insectdata の公開の入力アプリと同じ考え。2026-10-07）
  const kd = b.kenDan || {};
  S.kenIdx = new Map((kd.ken || []).map((k, i) => [k, i]));
  const ks = await kvGet("ken:" + (b.case || ""));
  S.ken = (Array.isArray(ks) ? ks : (b.kenDefault || [])).filter((k) => S.kenIdx.has(k));
  $("#title").textContent = b.case || "昆虫調査 入力";
  // 前回の調査設定の選択を復元
  S.axes = (await kvGet("axes")) || {};
  await loadGenchi();
  buildAxisSelects();
  renderMasterSelect();
  showMain(true);
  renderList();
}
function showMain(on) {
  $("#setup").hidden = on;
  for (const id of ["axes-box", "search-box", "list-box", "export-box"]) $("#" + id).hidden = !on;
}

// ---------------------------------------------------------------- 調査設定の項目
function buildAxisSelects() {
  const b = S.bundle;
  for (const a of AXES) {
    const sel = $("#ax-" + a);
    sel.innerHTML = "";
    const opts = b.axes[a] || [];
    sel.append(el("option", { value: "" }, a === "その他" ? "（なし）" : "（未選択）"));
    for (const v of opts) sel.append(el("option", { value: v }, v));
    if (S.axes[a] && opts.includes(S.axes[a])) sel.value = S.axes[a]; else S.axes[a] = "";
    sel.onchange = () => { S.axes[a] = sel.value; onAxisChange(a); };
  }
  restrictByCombos();
}
// 「組み合わせ」の行で手法ごとに地点・その他を絞る（PC側 axis_master.rule_sites / rule_others と同じ規則）
// 行の空欄は「どれでも」。手法に1行も無ければ全地点・その他なし。
function rulesOf() {
  const b = S.bundle;
  if (Array.isArray(b.rules)) return b.rules;
  // 古い業務ファイル（combos 形式）も読めるように
  const out = [];
  for (const [m, sites] of Object.entries(b.combos || {})) {
    for (const [s, os] of Object.entries(sites)) {
      if (os.length) for (const o of os) out.push({ season: "", method: m, site: s, other: o });
      else out.push({ season: "", method: m, site: s, other: "" });
    }
  }
  return out;
}
// 行の読み方（PC側 axis_master と同じ）
//   地点   空欄 = どの地点でも、「-」= 地点は使わない
//   その他 空欄・「-」= その他は使わない、値 = その値
//   季節   空欄 = どの季節でも。 手法に1行も無ければ全地点・その他なし
const NONE_MARKS = new Set(["-", "－", "―", "ー", "−", "なし", "無し", "(なし)", "（なし）"]);
const isNone = (v) => NONE_MARKS.has((v || "").trim());
function methodRules(m) { return rulesOf().filter((r) => !r.method || r.method === m); }
function restrictByCombos() {
  const b = S.bundle, m = S.axes["採集方法"], e = S.axes["季節"];
  const selSite = $("#ax-地点"), selOther = $("#ax-その他");
  const all = b.axes["地点"] || [];
  const rs = m ? methodRules(m).filter((r) => !r.season || !e || r.season === e) : [];
  // 地点
  let sites = all, siteNone = false;
  if (rs.length) {
    const named = [];
    for (const r of rs) if (r.site && !isNone(r.site) && !named.includes(r.site)) named.push(r.site);
    sites = rs.some((r) => !r.site) ? all : all.filter((s) => named.includes(s));
    siteNone = !sites.length && rs.some((r) => isNone(r.site));
  }
  rebuild(selSite, sites, S.axes["地点"], siteNone ? "（地点なし）" : "（未選択）");
  selSite.disabled = siteNone;
  S.axes["地点"] = siteNone ? "" : selSite.value;
  // その他
  let others = [], otherOff = false;
  if (!rs.length) {
    otherOff = rulesOf().length > 0;           // 他の手法だけが行を持つ業務 → この手法はその他なし
    others = otherOff ? [] : (b.axes["その他"] || []);
  } else {
    const site = S.axes["地点"];
    for (const r of rs) {
      const siteOk = isNone(r.site) ? !site : (!r.site || r.site === site);
      if (siteOk && r.other && !isNone(r.other) && !others.includes(r.other)) others.push(r.other);
    }
    otherOff = others.length === 0;
  }
  rebuild(selOther, others, S.axes["その他"], "（なし）");
  selOther.disabled = otherOff;
  S.axes["その他"] = otherOff ? "" : selOther.value;
}
function rebuild(sel, opts, cur, blank) {
  sel.innerHTML = "";
  sel.append(el("option", { value: "" }, blank));
  for (const v of opts) sel.append(el("option", { value: v }, v));
  sel.value = opts.includes(cur) ? cur : "";
}
function onAxisChange(a) {
  if (a === "採集方法" || a === "地点" || a === "季節") restrictByCombos();
  kvSet("axes", S.axes);
  renderList();
}
function axesReady() {
  // 地点が「使わない」手法（組み合わせに - を書いたもの）は地点なしで記録できる
  return S.axes["季節"] && S.axes["採集方法"] && (S.axes["地点"] || $("#ax-地点").disabled);
}
const comboKey = (r) => [r.季節, r.採集方法, r.地点, r.その他].join("|");
const curKey = () => [S.axes["季節"], S.axes["採集方法"], S.axes["地点"], S.axes["その他"] || ""].join("|");

// ---------------------------------------------------------------- 検索
let qTimer = null;
function onQuery() {
  clearTimeout(qTimer);
  qTimer = setTimeout(search, 80);
}
// 県の点（選んだ県で 水国の調査（平成28年度から）で確認された多さ 0〜3。2 つ以上選んだら高い方。選んでいなければ 0）
function kenTen(w) {
  const v = ((S.bundle && S.bundle.kenDan) || {}).dan?.[w];
  if (!v || !S.ken.length) return 0;
  let m = 0;
  for (const k of S.ken) { const d = +v[S.kenIdx.get(k)] || 0; if (d > m) m = d; }
  return m;
}
// 地方（選んだ県が属する地方でも 記録の有無を見る。沖縄は 九州と分ける。祝 2026-10-07）
const CHIHOU = {
  北海道: ["北海道"], 東北: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  関東: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"],
  中部: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"],
  近畿: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  中国: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"], 四国: ["徳島県", "香川県", "愛媛県", "高知県"],
  九州: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"], 沖縄: ["沖縄県"],
};
// 選んだ県の地方（名前の並び）。地方の点 ＝ その地方のどれかの県での段の高い方
const chihouOf = () => [...new Set(S.ken.map((k) => Object.keys(CHIHOU).find((c) => CHIHOU[c].includes(k))).filter(Boolean))];
function chihouTen(w) {
  const v = ((S.bundle && S.bundle.kenDan) || {}).dan?.[w];
  if (!v || !S.ken.length) return 0;
  let m = 0;
  for (const c of chihouOf()) for (const k of CHIHOU[c]) { const d = +v[S.kenIdx.get(k)] || 0; if (d > m) m = d; }
  return m;
}
function search() {
  const raw = $("#q").value.trim();
  const hits = $("#hits");
  hits.innerHTML = "";
  if (!raw || !S.bundle) { hits.hidden = true; return; }
  buildOlds();                                     // 裏で作り終わる前に打ったときだけ ここで作る
  const q = skey(raw), ql = raw.toLowerCase();
  // 先頭一致 → 部分一致 → 学名の先頭一致 の順。その中では 点数（県の点 ＋ 採用回数の点）の高い順、同点なら五十音順。
  // 打った名前とちょうど同じ和名は いちばん上（2026-10-07）
  const pre = [], mid = [], sci = [];
  for (const sp of S.bundle.species) {
    if (!(sp[4] & S.masterBit)) continue;
    const k = sp[5];
    if (k.startsWith(q)) pre.push(sp);
    else if (mid.length < 300 && k.includes(q)) mid.push(sp);
    else if (sci.length < 30 && ql.length >= 3 && sp[1] && sp[1].toLowerCase().startsWith(ql)) sci.push(sp);
  }
  const used = (sp) => S.usage[sp[0]] || 0;
  const ten = (sp) => kenTen(sp[0]) + chihouTen(sp[0]) * 0.3 + Math.min(used(sp), 20) * 0.5;   // 県に無くても 地方にあれば少し上
  const rank = (arr) => arr.map((sp, i) => [sp, i, ten(sp), sp[5] === q]).sort((a, b) => (b[3] - a[3]) || (b[2] - a[2]) || (a[1] - b[1])).map((x) => x[0]);
  const list = rank(pre).slice(0, 40);
  if (list.length < 40) list.push(...rank(mid).slice(0, 40 - list.length));
  list.push(...rank(sci).slice(0, 10));
  // 旧名で探す（先頭一致。2 字から）。打った旧名の今の種は 1 行にまとめ、右下に「旧名 ○○」（祝 2026-10-04）。
  // 今の名で出ている種ならその行に、出ていなければ候補の後ろに 1 行だけ足す（同じ和名を何行も並べない）
  const oldOf = new Map();                         // species の行 → 打った旧名に当たった旧名の一覧
  if (q.length >= 2) {
    for (const o of S.olds) {
      if (!o.k.startsWith(q)) continue;
      for (const i of o.t) {
        const sp = S.bundle.species[i];
        if (!sp || !(sp[4] & S.masterBit)) continue;
        if (!oldOf.has(sp)) oldOf.set(sp, []);
        if (oldOf.get(sp).length < 3) oldOf.get(sp).push(o);
      }
      if (oldOf.size >= 12) break;
    }
  }
  const extra = [...oldOf.keys()].filter((sp) => !list.includes(sp));
  if (!list.length && !extra.length) {
    hits.append(el("li", { class: "none" }, "候補がありません。綴りを変えるか、設定でマスタを切り替えてください"));
  }
  const picks = S.bundle.picks || {}, dist = S.bundle.dist || {}, notes = S.bundle.notes || {};
  for (const sp of [...list, ...extra]) {
    const exact = sp[5] === q, n = used(sp);
    const ja = el("span", { class: "ja" + (exact ? " exact" : "") }, sp[0]);
    const ks = kisetsuEl(sp[0]);
    if (ks) ja.append(ks);
    ja.append(...marks(sp));
    if (picks[sp[0]]) ja.append(el("span", { class: "tag pick", title: "誤同定の名など。押すと説明と候補が出ます" }, "要選択"));
    if (n) ja.append(el("span", { class: "pill", title: "これまでの採用回数" }, `×${n}`));
    const kt = kenTen(sp[0]);
    if (kt) ja.append(el("span", { class: "pill ken", title: `${S.ken.join("・")}で 水国の調査（平成28年度から）で確認（●が多いほど よく確認される）` }, "県" + "●".repeat(kt)));
    // 地方の記録（県で記録が無くても 地方にあるか・無いか が分かるように）
    if (S.ken.length && S.bundle.kenDan) {
      const ct = chihouTen(sp[0]), cn = chihouOf().join("・");
      ja.append(ct ? el("span", { class: "pill chihou", title: `${cn}地方のどこかの県で 水国の調査（平成28年度から）で確認（●は その地方でいちばん多い県の段）` }, cn + "●".repeat(ct))
        : el("span", { class: "pill nashi", title: `${cn}地方では 水国の調査（平成28年度から）に記録なし` }, cn + " 記録なし"));
    }
    const sub = el("span", { class: "sub" }, `${sp[2] || ""}　${sp[1] || ""}`);
    // 亜種が 2 つ以上ある種は分布も出す（どの亜種か選ぶ手がかり。2026-09-27）
    if (dist[sp[0]]) sub.append(el("span", { class: "dist" }, `分布: ${dist[sp[0]]}`));
    // 工房の注記（目録のみ・水国のみ・和名同・学名異 など）。シノニムに気付く手がかり（2026-09-27）
    if (notes[sp[0]]) sub.append(el("span", { class: "dist note" }, notes[sp[0]]));
    const hit = oldOf.get(sp);
    if (hit) {                                     // 打った名前が旧名: 当たった旧名だけを右下に
      sub.append(el("span", { class: "dist old hit", title: "打った名前は この種の旧名（シノニム）" },
        "旧名 " + hit.map((o) => o.n + (o.f ? "※" : "")).join("、")));
    } else {
      const on = S.oldNames.get(sp[0]);
      if (on) sub.append(el("span", { class: "dist old" }, "旧名: " + on.slice(0, 3).join("、") + (on.length > 3 ? " ほか" : "")));
    }
    hits.append(el("li", { onclick: () => (picks[sp[0]] ? openPick(sp) : addSpecies(sp)) }, ja, sub));
  }
  hits.hidden = false;
}
// 季節の割合（水国の調査で 春 3〜5・夏 6〜8・秋 9〜11・冬 12〜2 月の記録の割合 %。業務ファイルの kisetsu）。
// 「春26夏63秋11冬0」の形。いちばん多い季節（同じなら全部）だけ 季節の色で塗り、ほかは灰色
function kisetsuEl(w) {
  const k = S.bundle && S.bundle.kisetsu, v = k && k.pct && k.pct[w];
  if (!v) return null;
  const mx = Math.max(...v), n = (k.n || {})[w] || 0;
  const box = el("span", { class: "kis", title: `水国の調査（${k.nendo || ""}年度・全国）の記録 ${n} 件の 季節の割合（春 3〜5月・夏 6〜8月・秋 9〜11月・冬 12〜2月）` });
  ["春", "夏", "秋", "冬"].forEach((s, i) => box.append(el("span", { class: "k" + i + (v[i] === mx && mx > 0 ? " top" : "") }, s + v[i])));
  return box;
}
// 重要種・外来種の印。業務ファイルの rdbCols（調査設定「重要種」シートの ○）と species の 7 番目から
function marks(sp) {
  const cols = (S.bundle && S.bundle.rdbCols) || [];
  const out = [];
  for (const [i, v] of (sp && sp[6]) || []) {
    const c = cols[i]; if (!c) continue;
    const alien = c[2] === "外来種";
    out.push(el("span", { class: "tag " + (alien ? (v === "特定" ? "tokutei" : "alien") : "rdb"), title: `${c[0]}: ${v}` },
      alien ? v : `${c[1]} ${v}`));
  }
  return out;
}
// 記録の表の和名の下に出す短い印（全NT・熊VU・特定）。環境省は「全」、県は頭の 1 字、外来種は頭を付けず色で分ける
function shortMarks(sp) {
  const cols = (S.bundle && S.bundle.rdbCols) || [];
  const out = el("span", { class: "marks" });
  for (const [i, v] of (sp && sp[6]) || []) {
    const c = cols[i]; if (!c) continue;
    const alien = c[2] === "外来種";
    const head = alien ? "" : /^環境省/.test(c[1] || c[0]) ? "全" : (c[1] || c[0]).charAt(0);
    if (out.childNodes.length) out.append("・");
    out.append(el("span", { class: alien ? (v === "特定" ? "tokutei" : "alien") : "rdb", title: `${c[0]}: ${v}` }, head + v));
  }
  return out.childNodes.length ? out : null;
}
// 選ばせる名前（誤同定の名など。工房のシノニムリスト「選ばせる名前」から。2026-09-27）: 説明と候補（分布つき）を出して選ばせる
function openPick(sp) {
  const p = S.bundle.picks[sp[0]];
  const bySp = new Map(S.bundle.species.map((x) => [x[0], x]));
  const d = el("dialog", { class: "pick" });
  const close = () => { d.close(); d.remove(); };
  const choose = (x) => { close(); addSpecies(x); };
  d.append(el("h3", {}, `「${sp[0]}」はどの種ですか`));
  if (p.note) d.append(el("p", { class: "note" }, p.note));
  const ul = el("ul", { class: "cands" });
  const self = (p.cands || []).find((c) => c[0] === sp[0]);   // 同じ和名の候補は「今の名前のまま」の行にまとめる
  ul.append(el("li", { onclick: () => choose(sp) }, el("b", {}, `${sp[0]}（今の名前のまま）`),
    el("small", {}, (sp[1] || "") + (self && self[1] && self[1] !== sp[1] ? `（今の学名 ${self[1]}）` : "")),
    el("small", { class: "dist" }, self && self[2] ? `分布: ${self[2]}` : "")));
  for (const [ja, sci, di] of p.cands || []) {
    if (ja === sp[0]) continue;
    const x = bySp.get(ja) || [ja, sci, "", "", 7, ja];
    ul.append(el("li", { onclick: () => choose(x) }, el("b", {}, ja), el("small", {}, sci || ""),
      el("small", { class: "dist" }, di ? `分布: ${di}` : ""),
      el("small", { class: "dist" }, (S.bundle.notes || {})[ja] || "")));
  }
  d.append(ul, el("div", { class: "actions" }, el("button", { class: "btn sec", onclick: close }, "やめる")));
  document.body.append(d);
  d.showModal();
}
async function addSpecies(sp, n = 1) {         // n: 地図の記録から数えるときの個体数（ふだんは 1）
  if (!axesReady()) { toast("先に 季節・採集方法・地点 を選んでください"); return false; }
  if (!$("#ax-その他").disabled && [...$("#ax-その他").options].length > 1 && !S.axes["その他"]) {
    toast("この手法は「その他」を選んでください"); return false;
  }
  S.usage[sp[0]] = (S.usage[sp[0]] || 0) + 1;      // 採用回数（候補の並びに使う）
  kvSet("usage", S.usage);
  const key = curKey();
  // 同じ組み合わせに同じ種があれば、書き出し済みでもその記録に +1（変更したので未書き出しに戻る）
  const same = mine().find((r) => r.和名 === sp[0] && comboKey(r) === key);
  if (same) {
    same.個体数 = (parseInt(same.個体数, 10) || 0) + n;
    same.updated = Date.now();
    same.exported = 0;
    await putRecord(same);
    toast(`${sp[0]} を +${n}（${same.個体数}）`);
  } else {
    const rec = { 業務: S.bundle.case, 和名: sp[0], 個体数: n, 採集方法: S.axes["採集方法"], 地点: S.axes["地点"],
      その他: S.axes["その他"] || "", 季節: S.axes["季節"], 備考: "", 採集日: today(),
      created: Date.now(), updated: Date.now(), exported: 0 };
    rec.id = await putRecord(rec);
    S.records.push(rec);
    toast(shortMarks(sp) ? `${sp[0]} を追加（重要種など。📍で地図に記録できます）` : `${sp[0]} を追加`);
  }
  $("#q").value = "";
  $("#hits").hidden = true;
  renderList();
  $("#q").focus();
  return true;
}

// ---------------------------------------------------------------- 地図（現地記録）とのつながり（祝 2026-10-07）
// 同定保留（地図で「同定保留」にした記録）の名前の印。数えるときも この名前で入る（シノニム処理で未解決として必ず引っかかる。祝 2026-10-07）
const HORYU = "【同定保留】";
// 現地記録の地点（genchi-record）を読むだけ。まだ地図を使っていない端末では DB を作らない（作ると現地記録の頁の初めの準備が飛ぶ）
function genchiDB() {
  return new Promise((ok) => {
    let made = false;
    const r = indexedDB.open("genchi-record");
    r.onupgradeneeded = () => { made = true; r.transaction.abort(); };
    r.onsuccess = () => ok(made ? null : r.result);
    r.onerror = () => ok(null);
  });
}
// 和名 → この業務の地図の地点の番号（新しい順）。一覧の 📍 に番号を出し、押すとその地点を開く
async function loadGenchi() {
  S.genchiOf = new Map();
  const db = await genchiDB(); if (!db) return;
  try {
    const ps = await new Promise((ok) => { const q = db.transaction("points").objectStore("points").getAll(); q.onsuccess = () => ok(q.result || []); q.onerror = () => ok([]); });
    for (const p of ps.filter((p) => p.業務 === (S.bundle && S.bundle.case)).sort((a, b) => b.time - a.time)) {
      for (const w of new Set((p.recs || []).map((r) => (r.和名 ? r.和名 + (r.保留 ? HORYU : "") : "")).filter(Boolean))) {
        if (!S.genchiOf.has(w)) S.genchiOf.set(w, []);
        S.genchiOf.get(w).push(p.no);
      }
    }
  } catch (e) { /* 地図の DB の形が違う（古い）ときは つながりを出さないだけ */ } finally { db.close(); }
}
// 地図の記録の「入力画面でも数える」から来て数えられたら、地図の記録に「入力画面で数えた」の印を付ける（二重に数えない）
async function markGenchiCounted(pid, ri) {
  const db = await genchiDB(); if (!db) return;
  await new Promise((ok) => {
    const t = db.transaction("points", "readwrite"), st = t.objectStore("points"), g = st.get(pid);
    g.onsuccess = () => { const p = g.result; if (p && p.recs && p.recs[ri]) { p.recs[ri].数え済み = true; st.put(p); } };
    t.oncomplete = ok; t.onerror = ok; t.onabort = ok;
  });
  db.close();
}
async function fromGenchi() {
  const qs = new URL(location.href).searchParams, find = qs.get("find"), count = qs.get("count");
  if (!find && !count) return;
  history.replaceState(null, "", location.pathname);        // 読み直しで二度数えない
  const w = find || count;
  if (count) {
    const horyu = w.endsWith(HORYU), sp0 = S.byName && S.byName.get(horyu ? w.slice(0, -HORYU.length) : w);
    if (!sp0) { toast(`「${w}」は 業務ファイルの和名にありません（地図の記録のまま）`); return; }
    const sp = horyu ? [w, sp0[1], sp0[2], sp0[3], sp0[4], skey(w)] : sp0;   // 保留は 印を付けない（確定前）
    const n = Math.max(1, parseInt(qs.get("n"), 10) || 1);
    if (!(await addSpecies(sp, n))) { toast("先に 季節・採集方法・地点 を選んでから、地図の記録の「入力画面でも数える」をもう一度押してください"); return; }
    await markGenchiCounted(parseInt(qs.get("pt"), 10), parseInt(qs.get("ri"), 10));
    await loadGenchi(); renderList();
  }
  // その種の行を光らせる（今の地点の一覧に無ければ知らせる）
  const tr = [...document.querySelectorAll("#tbl tbody tr")].find((t) => t.dataset.wa === w);
  if (tr) { tr.classList.add("flash"); tr.scrollIntoView({ block: "center" }); setTimeout(() => tr.classList.remove("flash"), 2500); }
  else if (find) toast(`「${w}」は 今の季節・方法・地点の一覧にありません（右上の「未書き出し」で全部を見られます）`);
}

// ---------------------------------------------------------------- 一覧
function renderList() {
  const tb = $("#tbl tbody");
  tb.innerHTML = "";
  const key = curKey();
  // 組み合わせの一覧は書き出し済みも見せる（読み込んだ記録や前日の記録に足せるように）。
  // 「すべての未書き出し」は文字どおり未書き出しだけ。
  let rows = S.showAll ? mine().filter((r) => !r.exported) : mine().filter((r) => comboKey(r) === key);
  // 既定は入れた順を逆に（新しく入れた種が上。＋−や同じ種の追加では動かさない＝連打で別の種を押さないように。祝 2026-10-04）
  rows.sort(S.recentTop ? (a, b) => b.updated - a.updated : (a, b) => (b.created - a.created) || (b.id - a.id));
  $("#list-title").textContent = S.showAll ? `未書き出し（${rows.length}）` : `今の地点（${rows.length}）`;
  $("#tog-all").textContent = S.showAll ? "今の地点" : "未書き出し";
  $("#empty").hidden = rows.length > 0;
  for (const r of rows) {
    const ctr = el("div", { class: "ctr" },
      el("button", { onclick: () => bump(r, -1), "aria-label": "減らす" }, "−"),
      el("input", { value: r.個体数, inputmode: "numeric", onchange: (e) => setCount(r, e.target.value) }),
      el("button", { onclick: () => bump(r, +1), "aria-label": "増やす" }, "＋"));
    // 備考は subnote（PC の広い画面ではメモの欄に出すので隠す）
    const axes = S.showAll ? `${r.季節} ${r.採集方法} ${r.地点}${r.その他 ? " " + r.その他 : ""}` : "";
    const note = r.備考 ? (axes ? "　" : "") + r.備考 : "";
    const name = el("td", { onclick: () => openEdit(r) }, r.和名,
      el("span", { class: "sub" }, axes, el("span", { class: "subnote" }, note)));
    // PC の広い画面だけに出るメモの欄（狭い画面では CSS で隠れる。スマホは和名を押して開く欄で書く）
    const memo = el("td", { class: "memo" }, el("input", { type: "text", value: r.備考 || "", placeholder: "メモ",
      onchange: (e) => setNote(r, e.target.value), onkeydown: (e) => { if (e.key === "Enter") e.target.blur(); } }));
    // 2 行目は いつも出す（印の無い種も「印なし」。行の高さをそろえて＋−を押しやすく、印が無いことも分かるように。祝 2026-10-07）
    const marks = shortMarks(S.byName && S.byName.get(r.和名));
    const ms = marks || (r.和名.endsWith(HORYU)
      ? el("span", { class: "marks horyu", title: "地図で同定保留にした記録。同定したら 正しい和名で入れ直して この行を 0 に" }, "同定保留")
      : el("span", { class: "marks none", title: "重要種・外来種の印は ありません" }, "印なし"));
    // 📍 で現地記録へ（地点を測って詳しく。入力画面で数えた印を付けて二重に数えない。祝 2026-10-04）
    // 重要種・外来種は「📍地図に記録」、ほかの種も 📍 だけ出す（重要種かもしれない・持ち帰って調べる種も地図に残せるように）
    // 地図にこの種の地点があれば その地点を開く（📍地点 3）。無ければ 地点を作る（📍＋。祝 2026-10-07）
    const nos = (S.genchiOf && S.genchiOf.get(r.和名)) || [];
    const pin = nos.length
      ? el("a", { class: "pin on", href: `./genchi.html?show=${encodeURIComponent(r.和名)}`, title: "地図でこの種の地点を開く", onclick: (e) => e.stopPropagation() },
        "📍地点 " + nos.slice(0, 2).join("・") + (nos.length > 2 ? " ほか" : ""))
      : el("a", { class: "pin", href: `./genchi.html?add=${encodeURIComponent(r.和名)}&from=input`, title: "現地記録で地点・写真・環境を記録する（今いる所に地点を作る）",
        onclick: (e) => e.stopPropagation() }, marks ? "📍＋地図に記録" : "📍＋");
    // 備: その行のすぐ下で備考を書く（小窓を開かない。workbench の入力アプリと同じ。祝 2026-10-07）。PC の広い画面は備考の列があるので出さない
    const bi = el("button", { type: "button", class: "bi" + (r.備考 ? " on" : ""), title: r.備考 ? "備考: " + r.備考 : "備考を書く",
      onclick: (e) => { e.stopPropagation(); bikouEdit(e.target.closest("tr"), r); } }, "備");
    name.insertBefore(ms, name.lastChild); ms.append(pin, bi);
    if (r.exported) name.insertBefore(el("span", { class: "pill", title: "書き出し済み。変えると未書き出しに戻ります" }, "済"), name.lastChild);
    // ゴミ箱は置かない（誤タップで消えるのを避ける）。消したいときは − で 0 にする。0 の記録は Excel に出ない
    tb.append(el("tr", { class: (parseInt(r.個体数, 10) || 0) > 0 ? "" : "zero", "data-wa": r.和名 }, name, memo, el("td", { class: "num" }, ctr)));
  }
  updateCounts();
}
// 備考を その行の下で直す。Enter か「残す」で保存、もう一度「備」で閉じる
function bikouEdit(tr, r) {
  const nx = tr.nextElementSibling;
  if (nx && nx.classList.contains("bikou-edit")) { nx.remove(); return; }
  for (const o of document.querySelectorAll("#tbl tr.bikou-edit")) o.remove();
  const inp = el("input", { type: "text", value: r.備考 || "", placeholder: "備考（例 灯火に飛来・死体・幼虫）", enterkeyhint: "done" });
  const save = async () => { await setNote(r, inp.value); renderList(); toast(r.備考 ? `${r.和名} の備考を残しました` : `${r.和名} の備考を消しました`); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  tr.after(el("tr", { class: "bikou-edit" }, el("td", { colspan: 3 },
    el("div", { class: "bk" }, inp, el("button", { type: "button", class: "btn", onclick: save }, "残す")))));
  inp.focus();
}
function updateCounts() {
  const all = mine();
  const cnt = (r) => parseInt(r.個体数, 10) || 0;
  const pend = all.filter((r) => !r.exported && cnt(r) > 0).length;   // 0 の記録は書き出さないので数えない
  const zero = all.filter((r) => cnt(r) === 0).length;
  const done = all.length - pend - zero;
  $("#pending").textContent = pend ? `未書き出し ${pend}` : "";
  $("#btn-export").disabled = !pend;
  $("#btn-export-all").disabled = !all.length;
  const others = S.records.length - all.length;
  $("#export-note").textContent = `この業務: 未書き出し ${pend} 件 ／ 書き出し済み ${done} 件`
    + (zero ? ` ／ 個体数 0（Excel に出ない）${zero} 件` : "")
    + (others ? `（ほかの業務の記録 ${others} 件は隠れています）` : "")
    + `。書き出したファイルは業務フォルダの 入力/ に置いて、1_入力データをまとめる.bat に通します。`;
}
const oneLine = (s) => String(s || "").replace(/\s*[\r\n]+\s*/g, " ").trim();   // 備考は 1 行で（Excel の 1 セル）
async function setNote(r, v) {
  // PC のメモの欄から。一覧は作り直さない（次の欄へ移るのを邪魔しない）。和名の下の備考と数だけ直す
  r.備考 = oneLine(v); r.updated = Date.now(); r.exported = 0;
  await putRecord(r);
  updateCounts();
}
async function bump(r, d) { await setCount(r, (parseInt(r.個体数, 10) || 0) + d); }
async function setCount(r, v) {
  const n = Math.max(0, parseInt(v, 10) || 0);
  r.個体数 = n; r.updated = Date.now(); r.exported = 0;
  await putRecord(r);
  renderList();
}
function openEdit(r) {
  S.editing = r;
  $("#edit-title").textContent = r.和名;
  $("#edit-note").value = r.備考 || "";
  $("#edit-count").value = r.個体数;
  $("#dlg-edit").showModal();
}

// ---------------------------------------------------------------- xlsx 書き出し（自前）
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  // files: [[name, Uint8Array]]  圧縮なしの zip
  const enc = new TextEncoder();
  const parts = [], central = [];
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
  const all = [...parts, ...central, end];
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function colName(i) { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function buildXlsx(rows) {
  const enc = new TextEncoder();
  const cell = (r, c, v) => {
    const ref = colName(c) + r;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    if (v === "" || v == null) return "";
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  let sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="30" customWidth="1"/><col min="3" max="6" width="12" customWidth="1"/><col min="7" max="7" width="28" customWidth="1"/><col min="8" max="8" width="12" customWidth="1"/></cols><sheetData>`;
  sheet += `<row r="1">` + COLS.map((h, i) => cell(1, i, h)).join("") + `</row>`;
  rows.forEach((r, i) => {
    const vals = [r.和名, parseInt(r.個体数, 10) || 0, r.採集方法, r.地点, r.その他, r.季節, r.備考, r.採集日];
    sheet += `<row r="${i + 2}">` + vals.map((v, c) => cell(i + 2, c, v)).join("") + `</row>`;
  });
  sheet += `</sheetData></worksheet>`;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="入力データ" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Yu Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ].map(([n, s]) => [n, enc.encode(s)]);
  return zipStore(files);
}
async function exportRecords(all) {
  const rows = mine().filter((r) => (all || !r.exported) && (parseInt(r.個体数, 10) || 0) > 0).sort((a, b) => a.created - b.created);
  if (!rows.length) { toast("書き出す記録がありません（個体数 0 の記録は出しません）"); return; }
  const bytes = buildXlsx(rows);
  const name = `${S.bundle.case || "入力"}_スマホ入力_${stamp()}.xlsx`;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], name, { type: blob.type });
  let delivered = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); delivered = true; }
    catch (e) { if (e && e.name === "AbortError") { toast("共有をやめました"); return; } }
  }
  if (!delivered) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const now = Date.now();
  for (const r of rows) { if (!r.exported) { r.exported = now; await putRecord(r); } }
  renderList();
  toast(`${rows.length} 件を書き出しました: ${name}`);
}

// ---------------------------------------------------------------- xlsx 読み込み（自前）
// 書き出した Excel（や PC で直したもの）を読み込んで続きを入力できるようにする。
// zip を自前でほどく。圧縮された項目は DecompressionStream（deflate-raw）で伸ばす。
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Excel（zip）の形ではありません");
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  const files = {};
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    files[name] = { method, data: u8.subarray(start, start + csize) };
    p += 46 + nlen + elen + clen;
  }
  return async (name) => {
    const f = files[name];
    if (!f) return null;
    if (f.method === 0) return dec.decode(f.data);
    if (f.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("このブラウザでは圧縮された Excel を読めません（新しいブラウザで開いてください）");
      const ab = await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return dec.decode(ab);
    }
    throw new Error("対応していない圧縮方式です");
  };
}
async function readXlsxRows(buf) {
  const get = await unzip(buf);
  const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
  const wb = parse(await get("xl/workbook.xml"));
  const sheets = [...wb.getElementsByTagName("sheet")];
  if (!sheets.length) throw new Error("シートがありません");
  const first = sheets.find((s) => s.getAttribute("name") === "入力データ") || sheets[0];
  const rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rels = parse(await get("xl/_rels/workbook.xml.rels"));
  const rel = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
  let target = rel ? rel.getAttribute("Target") : "worksheets/sheet1.xml";
  target = target.startsWith("/") ? target.slice(1) : (target.startsWith("xl/") ? target : "xl/" + target);
  const ssx = await get("xl/sharedStrings.xml");
  const ss = ssx ? [...parse(ssx).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  const sx = parse(await get(target));
  const rows = [];
  for (const row of sx.getElementsByTagName("row")) {
    const cells = {};
    for (const c of row.getElementsByTagName("c")) {
      const col = (c.getAttribute("r") || "").replace(/\d+/g, ""), t = c.getAttribute("t");
      const vv = c.getElementsByTagName("v")[0];
      let v = "";
      if (t === "s") v = vv ? (ss[parseInt(vv.textContent, 10)] || "") : "";
      else if (t === "inlineStr") v = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      else v = vv ? vv.textContent : "";
      cells[col] = String(v).trim();
    }
    rows.push(cells);
  }
  return rows;
}
const IMPORT_ALIAS = {
  和名: ["和名", "種和名", "総目録和名"], 個体数: ["個体数"], 採集方法: ["採集方法", "調査手法"],
  地点: ["地点", "地点名", "採集地点"], その他: ["その他", "包み番号", "包み"], 季節: ["季節", "採集時期"],
  備考: ["備考", "コメント"], 採集日: ["採集日"],
};
async function importFile(file) {
  if (!S.bundle) { toast("先に業務ファイルを読み込んでください"); return; }
  let rows;
  try { rows = await readXlsxRows(await file.arrayBuffer()); }
  catch (e) { toast("読み込めませんでした: " + (e.message || e)); return; }
  // 見出し行（和名と個体数のある行）を先頭5行から探す
  let map = null, hi = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const m = {};
    for (const [col, v] of Object.entries(rows[i])) {
      for (const [key, names] of Object.entries(IMPORT_ALIAS)) if (names.includes(v)) m[key] = col;
    }
    if (m.和名 && m.個体数) { map = m; hi = i; break; }
  }
  if (!map) { toast("「和名」と「個体数」の見出しが見つかりません"); return; }
  const g = (r, k) => (map[k] ? (r[map[k]] || "") : "");
  // 同じ 種名・季節・方法・地点・その他・採集日 の記録が端末にあれば、ファイルの値で上書き（最新を採用）
  const keyOf = (r) => [r.和名, r.採集方法, r.地点, r.その他, r.季節, r.採集日].join("|");
  const have = new Map(mine().map((r) => [keyOf(r), r]));
  let added = 0, dup = 0, updated = 0, odd = 0;
  const now = Date.now();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i], name = g(r, "和名");
    if (!name) continue;
    const q = g(r, "個体数");
    let n = parseInt(q, 10);
    if (isNaN(n)) { const ds = (q.match(/\d+/g) || []).map(Number); n = ds.length ? ds.reduce((a, b) => a + b, 0) : 1; }
    const rec = { 業務: S.bundle.case, 和名: name, 個体数: n, 採集方法: g(r, "採集方法"), 地点: g(r, "地点"),
      その他: g(r, "その他"), 季節: g(r, "季節"), 備考: g(r, "備考"), 採集日: g(r, "採集日") || today(),
      created: now + i, updated: now + i, exported: now };
    const key = keyOf(rec), ex = have.get(key);
    if (ex) {
      if (String(ex.個体数) === String(rec.個体数) && (ex.備考 || "") === (rec.備考 || "")) { dup++; continue; }
      ex.個体数 = rec.個体数; ex.備考 = rec.備考; ex.updated = now; ex.exported = now;
      await putRecord(ex); updated++; continue;
    }
    have.set(key, rec);
    for (const a of ["採集方法", "地点", "季節"]) if (rec[a] && !(S.bundle.axes[a] || []).includes(rec[a])) { odd++; break; }
    rec.id = await putRecord(rec);
    S.records.push(rec);
    added++;
  }
  renderList();
  toast(`${added} 件を追加` + (updated ? `、${updated} 件をファイルの値に更新` : "") + (dup ? `（同じ記録 ${dup} 件はそのまま）` : "")
    + (odd ? `。${odd} 件は調査設定に無い値です` : ""));
}

// ---------------------------------------------------------------- 設定
function renderMasterSelect() {
  const sel = $("#sel-master");
  sel.innerHTML = "";
  for (const [label, bit] of S.bundle.masters || [["統合", 1]]) {
    const n = S.bundle.species.reduce((a, sp) => a + ((sp[4] & bit) ? 1 : 0), 0);
    sel.append(el("option", { value: bit }, `${label}（${n.toLocaleString()} 件）`));
  }
  sel.value = S.masterBit;
  sel.onchange = async () => { S.masterBit = parseInt(sel.value, 10); await kvSet("masterBit", S.masterBit); search(); };
  $("#master-hint").textContent = `業務の既定は「${S.bundle.masterDefault || "統合"}」。入力の候補に使うだけで、PC側の集計には影響しません。`;
  $("#bundle-info").textContent = `${S.bundle.case}　作成 ${S.bundle.made}　和名 ${S.bundle.species.length.toLocaleString()} 件　（画面 ${APP_VERSION}）`;
}
function openMenu() {
  if (S.bundle) renderMasterSelect();
  const all = mine(), pend = all.filter((r) => !r.exported).length;
  const per = {};
  for (const r of S.records) per[r.業務 || "（業務なし）"] = (per[r.業務 || "（業務なし）"] || 0) + 1;
  $("#rec-info").textContent = `この業務の記録 ${all.length} 件（未書き出し ${pend}）。端末内の内訳: `
    + Object.entries(per).map(([k, n]) => `${k} ${n}`).join(" / ");
  $("#btn-clear-exported").disabled = all.length - pend === 0;
  const nu = Object.keys(S.usage).length;
  $("#usage-info").textContent = nu ? `${nu} 種の採用回数を覚えています（多い種ほど候補の上に出ます）` : "まだ採用回数の記録はありません";
  $("#btn-clear-usage").disabled = !nu;
  $("#chk-recent-top").checked = S.recentTop;
  renderKen();
  $("#dlg-menu").showModal();
}

// 候補の並びに使う県を選ぶ（☰）。押すたびに 業務ごとに端末へ保存
function renderKen() {
  const box = $("#ken-chips"), kd = (S.bundle && S.bundle.kenDan) || null;
  box.textContent = "";
  $("#ken-row").hidden = !kd;
  if (!kd) return;
  for (const k of kd.ken || []) {
    box.append(el("button", { type: "button", class: "chip" + (S.ken.includes(k) ? " on" : ""), onclick: async (e) => {
      S.ken = S.ken.includes(k) ? S.ken.filter((x) => x !== k) : [...S.ken, k];
      e.target.classList.toggle("on", S.ken.includes(k));
      await kvSet("ken:" + S.bundle.case, S.ken);
      kenHint();
    } }, k.replace(/[都府県]$/, "")));
  }
  kenHint();
}
function kenHint() {
  const b = S.bundle || {};
  $("#ken-hint").textContent = (S.ken.length ? `いまは ${S.ken.join("・")}。` : "いまは選んでいません（五十音と採用回数で並びます）。")
    + `業務の既定は ${(b.kenDefault || []).join("・") || "なし"}（調査設定「重要種」の県のレッドリストから）。水国の調査結果 ${(b.kenDan || {}).src || ""} 時点。`;
}

// ---------------------------------------------------------------- 起動
async function boot() {
  await openDB();
  S.records = await allRecords();
  S.usage = (await kvGet("usage")) || {};
  S.recentTop = !!(await kvGet("recentTop"));
  $("#chk-recent-top").onchange = async (e) => { S.recentTop = e.target.checked; await kvSet("recentTop", S.recentTop); renderList(); };
  $("#btn-clear-usage").onclick = async () => {
    const n = Object.keys(S.usage).length;
    if (!n || !confirm(`${n} 種ぶんの採用回数を消して、候補の並びを五十音順に戻します。よいですか？`)) return;
    S.usage = {}; await kvSet("usage", S.usage); openMenu(); toast("採用回数を消しました");
  };
  $("#file-bundle").onchange = (e) => e.target.files[0] && loadBundleFile(e.target.files[0]);
  $("#file-bundle2").onchange = (e) => { if (e.target.files[0]) { loadBundleFile(e.target.files[0]); $("#dlg-menu").close(); } };
  $("#file-import").onchange = async (e) => { if (e.target.files[0]) { await importFile(e.target.files[0]); e.target.value = ""; $("#dlg-menu").close(); } };
  $("#q").oninput = onQuery;
  $("#q-clear").onclick = () => { $("#q").value = ""; $("#hits").hidden = true; $("#q").focus(); };
  $("#tog-all").onclick = () => { S.showAll = !S.showAll; renderList(); };
  $("#btn-export").onclick = () => exportRecords(false);
  $("#btn-export-all").onclick = () => { $("#dlg-menu").close(); exportRecords(true); };
  $("#btn-menu").onclick = openMenu;
  $("#btn-close-menu").onclick = () => $("#dlg-menu").close();
  $("#btn-clear-exported").onclick = async () => {
    const done = mine().filter((r) => r.exported);
    if (!done.length || !confirm(`この業務の書き出し済み ${done.length} 件を端末から消します。Excel にはもう入っています。よいですか？`)) return;
    for (const r of done) await delRecord(r.id);
    const ids = new Set(done.map((r) => r.id));
    S.records = S.records.filter((r) => !ids.has(r.id));
    renderList(); openMenu();
  };
  $("#btn-edit-cancel").onclick = () => $("#dlg-edit").close();
  $("#btn-edit-delete").onclick = async () => {
    const r = S.editing; if (!r) return;
    if (!confirm(`「${r.和名}」のこの記録を端末から消します。よいですか？`)) return;
    await delRecord(r.id);
    S.records = S.records.filter((x) => x.id !== r.id);
    $("#dlg-edit").close(); renderList();
  };
  $("#btn-edit-save").onclick = async () => {
    const r = S.editing; if (!r) return;
    r.備考 = oneLine($("#edit-note").value);
    r.個体数 = Math.max(0, parseInt($("#edit-count").value, 10) || 0);
    r.updated = Date.now(); r.exported = 0;
    await putRecord(r); $("#dlg-edit").close(); renderList();
  };

  // 保存済みの業務ファイル。PCで試すときは ?bundle=URL で読める
  const url = new URL(location.href).searchParams.get("bundle");
  let b = await kvGet("bundle");
  if (url) {
    try { b = await (await fetch(url)).json(); await kvSet("bundle", b); } catch (e) { toast("業務ファイルを取れませんでした: " + url); }
  }
  if (b) { await applyBundle(b); await fromGenchi(); } else { $("#setup").hidden = false; showMain(false); $("#setup").hidden = false; }
  // 地図から端末の「戻る」で戻ったときも 📍 の地点の番号を新しくする
  window.addEventListener("pageshow", async (e) => { if (e.persisted && S.bundle) { await loadGenchi(); renderList(); } });

  if (!("indexedDB" in window)) $("#banner").hidden = false, $("#banner").textContent = "このブラウザでは記録を保存できません。";
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
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
// 動作確認用（PCのブラウザの開発ツールから触れる）。ふだんの利用には関係ない。
window.__konchu = { S, buildXlsx, skey, addSpecies, renderList, exportRecords, importFile, readXlsxRows };
boot();
})();
