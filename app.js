/* 昆虫調査 入力アプリ
 * 外部ライブラリなし。データは端末の IndexedDB に置く。
 *   bundle  … PCで作った スマホ用.json（業務の調査設定、和名の索引）
 *   records … 入力した記録（7列＋採集日、書き出し済みフラグ）
 * 書き出しは xlsx（zip を自前で組む。圧縮なし）。
 */
(() => {
"use strict";

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
const DB = { name: "konchu-input", ver: 1, db: null };
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
    r.onsuccess = () => { DB.db = r.result; ok(); };
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
  showAll: false,
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
async function applyBundle(b) {
  S.bundle = b;
  // 業務名を持たない古い記録は、いま読み込んだ業務のものとして扱う（1業務しか無かった頃の記録）
  for (const r of S.records) {
    if (!r.業務) { r.業務 = b.case; await putRecord(r); }
  }
  const def = (b.masters || []).find((m) => m[0] === (b.masterDefault || "統合"));
  const saved = await kvGet("masterBit");
  S.masterBit = saved || (def ? def[1] : 1);
  $("#title").textContent = b.case || "昆虫調査 入力";
  // 前回の調査設定の選択を復元
  S.axes = (await kvGet("axes")) || {};
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
function search() {
  const raw = $("#q").value.trim();
  const hits = $("#hits");
  hits.innerHTML = "";
  if (!raw || !S.bundle) { hits.hidden = true; return; }
  const q = skey(raw), ql = raw.toLowerCase();
  // 先頭一致 → 部分一致 → 学名の先頭一致 の順。その中では採用回数の多い順、同数なら五十音順
  const pre = [], mid = [], sci = [];
  for (const sp of S.bundle.species) {
    if (!(sp[4] & S.masterBit)) continue;
    const k = sp[5];
    if (k.startsWith(q)) pre.push(sp);
    else if (mid.length < 300 && k.includes(q)) mid.push(sp);
    else if (sci.length < 30 && ql.length >= 3 && sp[1] && sp[1].toLowerCase().startsWith(ql)) sci.push(sp);
  }
  const used = (sp) => S.usage[sp[0]] || 0;
  const rank = (arr) => arr.map((sp, i) => [sp, i]).sort((a, b) => (used(b[0]) - used(a[0])) || (a[1] - b[1])).map((x) => x[0]);
  const list = rank(pre).slice(0, 40);
  if (list.length < 40) list.push(...rank(mid).slice(0, 40 - list.length));
  list.push(...rank(sci).slice(0, 10));
  if (!list.length) {
    hits.append(el("li", { class: "none" }, "候補がありません。綴りを変えるか、設定でマスタを切り替えてください"));
  }
  for (const sp of list) {
    const exact = sp[5] === q, n = used(sp);
    const ja = el("span", { class: "ja" + (exact ? " exact" : "") }, sp[0]);
    if (n) ja.append(el("span", { class: "pill", title: "これまでの採用回数" }, `×${n}`));
    hits.append(el("li", { onclick: () => addSpecies(sp) }, ja,
      el("span", { class: "sub" }, `${sp[2] || ""}　${sp[1] || ""}`)));
  }
  hits.hidden = false;
}
async function addSpecies(sp) {
  if (!axesReady()) { toast("先に 季節・採集方法・地点 を選んでください"); return; }
  if (!$("#ax-その他").disabled && [...$("#ax-その他").options].length > 1 && !S.axes["その他"]) {
    toast("この手法は「その他」を選んでください"); return;
  }
  S.usage[sp[0]] = (S.usage[sp[0]] || 0) + 1;      // 採用回数（候補の並びに使う）
  kvSet("usage", S.usage);
  const key = curKey();
  // 同じ組み合わせに同じ種があれば、書き出し済みでもその記録に +1（変更したので未書き出しに戻る）
  const same = mine().find((r) => r.和名 === sp[0] && comboKey(r) === key);
  if (same) {
    same.個体数 = (parseInt(same.個体数, 10) || 0) + 1;
    same.updated = Date.now();
    same.exported = 0;
    await putRecord(same);
    toast(`${sp[0]} を +1（${same.個体数}）`);
  } else {
    const rec = { 業務: S.bundle.case, 和名: sp[0], 個体数: 1, 採集方法: S.axes["採集方法"], 地点: S.axes["地点"],
      その他: S.axes["その他"] || "", 季節: S.axes["季節"], 備考: "", 採集日: today(),
      created: Date.now(), updated: Date.now(), exported: 0 };
    rec.id = await putRecord(rec);
    S.records.push(rec);
    toast(`${sp[0]} を追加`);
  }
  $("#q").value = "";
  $("#hits").hidden = true;
  renderList();
  $("#q").focus();
}

// ---------------------------------------------------------------- 一覧
function renderList() {
  const tb = $("#tbl tbody");
  tb.innerHTML = "";
  const key = curKey();
  // 組み合わせの一覧は書き出し済みも見せる（読み込んだ記録や前日の記録に足せるように）。
  // 「すべての未書き出し」は文字どおり未書き出しだけ。
  let rows = S.showAll ? mine().filter((r) => !r.exported) : mine().filter((r) => comboKey(r) === key);
  rows.sort((a, b) => b.updated - a.updated);
  $("#list-title").textContent = S.showAll ? `すべての未書き出し（${rows.length}）` : `この組み合わせの記録（${rows.length}）`;
  $("#tog-all").textContent = S.showAll ? "この組み合わせだけ見る" : "すべての未書き出しを見る";
  $("#empty").hidden = rows.length > 0;
  for (const r of rows) {
    const ctr = el("div", { class: "ctr" },
      el("button", { onclick: () => bump(r, -1), "aria-label": "減らす" }, "−"),
      el("input", { value: r.個体数, inputmode: "numeric", onchange: (e) => setCount(r, e.target.value) }),
      el("button", { onclick: () => bump(r, +1), "aria-label": "増やす" }, "＋"));
    const sub = S.showAll ? `${r.季節} ${r.採集方法} ${r.地点}${r.その他 ? " " + r.その他 : ""}` : (r.備考 || "");
    const name = el("td", { onclick: () => openEdit(r) }, r.和名, el("span", { class: "sub" }, sub + (S.showAll && r.備考 ? "　" + r.備考 : "")));
    if (r.exported) name.insertBefore(el("span", { class: "pill", title: "書き出し済み。変えると未書き出しに戻ります" }, "済"), name.lastChild);
    // ゴミ箱は置かない（誤タップで消えるのを避ける）。消したいときは − で 0 にする。0 の記録は Excel に出ない
    tb.append(el("tr", { class: (parseInt(r.個体数, 10) || 0) > 0 ? "" : "zero" }, name, el("td", { class: "num" }, ctr)));
  }
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
  $("#bundle-info").textContent = `${S.bundle.case}　作成 ${S.bundle.made}　和名 ${S.bundle.species.length.toLocaleString()} 件`;
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
  $("#dlg-menu").showModal();
}

// ---------------------------------------------------------------- 起動
async function boot() {
  await openDB();
  S.records = await allRecords();
  S.usage = (await kvGet("usage")) || {};
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
    r.備考 = $("#edit-note").value.trim();
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
  if (b) await applyBundle(b); else { $("#setup").hidden = false; showMain(false); $("#setup").hidden = false; }

  if (!("indexedDB" in window)) $("#banner").hidden = false, $("#banner").textContent = "このブラウザでは記録を保存できません。";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
// 動作確認用（PCのブラウザの開発ツールから触れる）。ふだんの利用には関係ない。
window.__konchu = { S, buildXlsx, skey, addSpecies, renderList, exportRecords, importFile, readXlsxRows };
boot();
})();
