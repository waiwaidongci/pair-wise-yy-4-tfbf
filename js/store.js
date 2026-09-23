/* 档案整理：标记与潜次复核状态的持久化、签字/失效履历、备份合并 */
(function (global) {
  const STORE_KEY = "zfl30Archive.v1";
  const LEGACY_KEY = "zfl30Marks";

  const TYPE_NAMES = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };

  function now() { return new Date().toISOString(); }
  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function seedMarks() {
    const t = now();
    return [
      { id: uid(), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", updatedAt: t },
      { id: uid(), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", updatedAt: t }
    ];
  }

  function normalizeMark(m) {
    m = m && typeof m === "object" ? m : {};
    return {
      id: m.id || uid(),
      code: String(m.code == null ? "" : m.code),
      type: TYPE_NAMES[m.type] ? m.type : "unknown",
      dive: String(m.dive == null ? "" : m.dive),
      x: Number(m.x) || 0,
      y: Number(m.y) || 0,
      depth: String(m.depth == null ? "" : m.depth),
      orientation: String(m.orientation == null ? "" : m.orientation),
      condition: String(m.condition == null ? "" : m.condition),
      note: String(m.note == null ? "" : m.note),
      updatedAt: m.updatedAt || null
    };
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter(h => h && typeof h === "object" && h.at)
      .map(h => ({
        action: h.action === "voided" ? "voided" : "signed",
        at: h.at,
        signer: String(h.signer || ""),
        comment: String(h.comment || ""),
        reason: String(h.reason || "")
      }));
  }

  function normalizeReviews(obj) {
    const out = {};
    for (const [dive, rv] of Object.entries(obj || {})) {
      if (!rv || typeof rv !== "object") continue;
      out[dive] = {
        dive,
        status: rv.status === "signed" ? "signed" : "pending",
        signer: String(rv.signer || ""),
        comment: String(rv.comment || ""),
        signedAt: rv.signedAt || null,
        updatedAt: rv.updatedAt || null,
        history: normalizeHistory(rv.history)
      };
    }
    return out;
  }

  function normalizeState(s) {
    return {
      marks: (s.marks || []).map(normalizeMark),
      reviews: normalizeReviews(s.reviews || {})
    };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("档案写入失败", e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.marks)) {
          const s = normalizeState(parsed);
          saveState(s);
          return s;
        }
      }
    } catch (e) {
      console.warn("档案读取失败，尝试旧档", e);
    }
    let marks = [];
    try {
      marks = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    } catch (e) { /* 无旧档 */ }
    if (!Array.isArray(marks) || !marks.length) marks = seedMarks();
    const s = normalizeState({ marks, reviews: {} });
    saveState(s);
    return s;
  }

  function saveState(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) {
      console.warn("档案写入失败", e);
    }
  }

  let state = load();

  function blankReview(dive) {
    return { dive, status: "pending", signer: "", comment: "", signedAt: null, updatedAt: null, history: [] };
  }

  function getReview(dive) {
    return state.reviews[dive] || blankReview(dive);
  }

  function ensureReview(dive) {
    if (!state.reviews[dive]) state.reviews[dive] = blankReview(dive);
    return state.reviews[dive];
  }

  /* 已签字潜次中的标记被改动：签字失效、回到待复核，旧签字留在履历 */
  function invalidate(dive, reason) {
    if (!dive) return;
    const r = state.reviews[dive];
    if (!r || r.status !== "signed") return;
    r.history.push({ action: "voided", at: now(), reason: reason || "标记资料改动" });
    r.status = "pending";
    r.signer = "";
    r.comment = "";
    r.signedAt = null;
    r.updatedAt = now();
  }

  function upsertMark(input) {
    const data = normalizeMark(input);
    const existing = input && input.id ? state.marks.find(m => m.id === input.id) : null;
    if (existing) {
      const oldDive = existing.dive;
      Object.assign(existing, data, { id: existing.id, updatedAt: now() });
      if (oldDive !== existing.dive) {
        invalidate(oldDive, "标记 " + (existing.code || existing.id) + " 改划至其他潜次");
      }
      invalidate(existing.dive, "标记 " + (existing.code || existing.id) + " 资料被编辑");
    } else {
      data.id = uid();
      data.updatedAt = now();
      state.marks.push(data);
      invalidate(data.dive, "潜次内新增标记 " + (data.code || data.id));
    }
    save();
    return existing || data;
  }

  function removeMark(id) {
    const idx = state.marks.findIndex(m => m.id === id);
    if (idx < 0) return false;
    const [removed] = state.marks.splice(idx, 1);
    invalidate(removed.dive, "标记 " + (removed.code || removed.id) + " 被移除");
    save();
    return true;
  }

  function markIssues(m) {
    const fields = [];
    if (!String(m.code || "").trim()) fields.push("编号");
    if (!String(m.depth || "").trim()) fields.push("深度");
    if (!String(m.condition || "").trim()) fields.push("保存状态");
    return fields;
  }

  function groupDives(marks) {
    const map = new Map();
    for (const m of marks) {
      if (!map.has(m.dive)) map.set(m.dive, []);
      map.get(m.dive).push(m);
    }
    return map;
  }

  /* 潜次更新时间：取该潜次标记与复核记录中最新的 updatedAt */
  function diveTime(marks, review) {
    let t = null;
    for (const m of marks || []) {
      if (m.updatedAt && (t === null || m.updatedAt > t)) t = m.updatedAt;
    }
    if (review && review.updatedAt && (t === null || review.updatedAt > t)) t = review.updatedAt;
    return t;
  }

  function depthRange(marks) {
    const vals = [];
    const raws = new Set();
    for (const m of marks) {
      const raw = String(m.depth || "").trim();
      if (!raw) continue;
      raws.add(raw);
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) vals.push(n);
    }
    if (!vals.length) return raws.size ? [...raws].join("、") : "—";
    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    return (lo === hi ? String(lo) : lo + "–" + hi) + "m";
  }

  function conditionSummary(marks) {
    const counts = new Map();
    let missing = 0;
    for (const m of marks) {
      const v = String(m.condition || "").trim();
      if (!v) { missing++; continue; }
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const parts = [...counts].map(([name, n]) => name + (n > 1 ? "×" + n : ""));
    if (missing) parts.push("未填×" + missing);
    return parts.join("、") || "—";
  }

  const byDiveCode = (a, b) =>
    String(a.dive).localeCompare(String(b.dive), "zh", { numeric: true }) ||
    String(a.code).localeCompare(String(b.code), "zh", { numeric: true });

  /* 汇总每个潜次：标记、深度范围、保存状态、缺资料情况、复核状态 */
  function summaries() {
    const out = [];
    for (const [dive, marks] of groupDives(state.marks)) {
      marks.sort((a, b) => String(a.code).localeCompare(String(b.code), "zh", { numeric: true }));
      const missing = marks
        .map(m => ({ id: m.id, code: String(m.code || "").trim() || "（未编号）", fields: markIssues(m) }))
        .filter(x => x.fields.length);
      const review = getReview(dive);
      out.push({
        dive,
        marks,
        count: marks.length,
        depthRange: depthRange(marks),
        conditions: conditionSummary(marks),
        complete: missing.length === 0,
        missing,
        review,
        updatedAt: diveTime(marks, review)
      });
    }
    out.sort((a, b) => String(a.dive).localeCompare(String(b.dive), "zh", { numeric: true }));
    return out;
  }

  function sign(dive, signer, comment) {
    const marks = state.marks.filter(m => m.dive === dive);
    if (!marks.length) return { ok: false, error: "该潜次没有标记，无法签字" };
    const bad = marks
      .map(m => ({ code: String(m.code || "").trim() || "（未编号）", fields: markIssues(m) }))
      .filter(x => x.fields.length);
    if (bad.length) return { ok: false, error: "有标记缺少资料，不能签字", missing: bad };
    const name = String(signer || "").trim();
    if (!name) return { ok: false, error: "请填写潜水长姓名后再签字" };

    const r = ensureReview(dive);
    const at = now();
    r.status = "signed";
    r.signer = name;
    r.comment = String(comment || "");
    r.signedAt = at;
    r.updatedAt = at;
    r.history.push({ action: "signed", signer: name, comment: r.comment, at });
    save();
    return { ok: true };
  }

  function normalizePayload(payload) {
    let marks = [];
    let reviews = {};
    if (Array.isArray(payload)) {
      marks = payload;
    } else if (payload && typeof payload === "object") {
      marks = Array.isArray(payload.marks) ? payload.marks : [];
      reviews = payload.reviews && typeof payload.reviews === "object" ? payload.reviews : {};
    }
    return { marks: marks.map(normalizeMark), reviews: normalizeReviews(reviews) };
  }

  function mergeReview(dive, local, incoming) {
    if (!incoming) return local || blankReview(dive);
    if (!local) return incoming;
    const history = local.history.concat(incoming.history)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return Object.assign(blankReview(dive), incoming, { dive, history });
  }

  /* 导入队里的备份：按潜次号合并；较旧或本地已签字的记录保留原档并列为冲突 */
  function importBackup(payload, backupAt) {
    const incoming = normalizePayload(payload);
    if (!incoming.marks.length) {
      return { imported: [], conflicts: [], note: "备份中没有标记记录" };
    }
    const imported = [];
    const conflicts = [];
    for (const [dive, inMarks] of groupDives(incoming.marks)) {
      const localMarks = state.marks.filter(m => m.dive === dive);
      const localReview = state.reviews[dive] || null;
      const inReview = incoming.reviews[dive] || null;
      const inTime = diveTime(inMarks, inReview) || backupAt || null;
      const localTime = diveTime(localMarks, localReview);

      if (localReview && localReview.status === "signed") {
        conflicts.push({ dive, reason: "本地潜次已签字，保留原档", localTime, inTime });
        continue;
      }
      if (localTime && inTime && inTime <= localTime) {
        conflicts.push({ dive, reason: "备份记录更新时间较旧，保留原档", localTime, inTime });
        continue;
      }
      state.marks = state.marks.filter(m => m.dive !== dive).concat(inMarks);
      state.reviews[dive] = mergeReview(dive, localReview, inReview);
      imported.push(dive);
    }
    save();
    return { imported, conflicts };
  }

  /* 供“导出JSON”使用：与旧版一致，导出纯标记数组 */
  function backupPayload() {
    return { version: 1, exportedAt: now(), marks: state.marks, reviews: state.reviews };
  }

  global.Archive = {
    TYPE_NAMES,
    fmtTime,
    getMarks: () => state.marks,
    getReview,
    summaries,
    upsertMark,
    removeMark,
    sign,
    importBackup,
    backupPayload,
    byDiveCode
  };
})(window);
