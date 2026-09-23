/*
 * archive.js —— 档案层：标记、潜次复核状态、签字履历、备份合并
 * 不依赖 DOM；其余脚本通过全局 Archive 访问。
 *
 * 数据模型：
 *   mark:    { id, code, type, dive, x, y, depth, orientation, condition, note, createdAt, updatedAt }
 *   review:  { dive, signer, comment, at }                  —— 当前签字（仅已签字潜次存在）
 *   history: { dive, signer, comment, at, valid, reason }   —— 履历，含已失效旧签字
 */
window.Archive = (() => {
  const MARK_KEY = "zfl30Marks";
  const REVIEW_KEY = "zfl30Reviews";
  const HISTORY_KEY = "zfl30History";
  const CONFLICT_KEY = "zfl30Conflicts";

  const TYPE_NAMES = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  // 标记必须具备的资料；缺任一项的潜次不能签字
  const REQUIRED_FIELDS = {
    code: "编号", type: "类型", dive: "潜次", depth: "深度", condition: "保存状态"
  };

  const listeners = new Set();
  let marks = load(MARK_KEY, []);
  let reviews = load(REVIEW_KEY, {});   // { [dive]: {signer, comment, at} }
  let history = load(HISTORY_KEY, []);  // { [dive]: [event, ...] }
  let conflicts = load(CONFLICT_KEY, []);

  // 首次打开时放入示例数据（其中一条缺保存状态，演示“资料不齐不能签字”）
  if (!marks.length) {
    marks = [
      { id: crypto.randomUUID(), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋" },
      { id: crypto.randomUUID(), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁" },
      { id: crypto.randomUUID(), code: "M-009", type: "metal", dive: "DIVE-02", x: 63, y: 55, depth: "", orientation: "南", condition: "", note: "待补测深度与保存状态" }
    ];
  }
  marks = marks.map(normalizeMark);
  persist();

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function persist() {
    localStorage.setItem(MARK_KEY, JSON.stringify(marks));
    localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(CONFLICT_KEY, JSON.stringify(conflicts));
  }
  function emit() { listeners.forEach(fn => fn()); }

  function now() { return new Date().toISOString(); }
  function typeName(type) { return TYPE_NAMES[type] || type || ""; }

  function normalizeMark(raw) {
    const ts = raw.createdAt || raw.updatedAt || now();
    return {
      id: raw.id || crypto.randomUUID(),
      code: raw.code || "",
      type: raw.type || "unknown",
      dive: raw.dive || "",
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      depth: raw.depth || "",
      orientation: raw.orientation || "",
      condition: raw.condition || "",
      note: raw.note || "",
      createdAt: ts,
      updatedAt: raw.updatedAt || ts
    };
  }

  /* ---------- 查询 ---------- */

  const getMarks = () => marks.map(m => ({ ...m }));
  const getMark = id => {
    const m = marks.find(x => x.id === id);
    return m ? { ...m } : null;
  };
  const listDives = () => [...new Set(marks.map(m => m.dive || "—"))].sort();

  const missingFields = m =>
    Object.keys(REQUIRED_FIELDS).filter(k => !String(m[k] ?? "").trim());

  function diveSummary(dive) {
    const items = marks.filter(m => (m.dive || "—") === dive);
    const missing = items.reduce(
      (n, m) => n + (missingFields(m).length ? 1 : 0), 0
    );
    return {
      dive,
      count: items.length,
      items: items.map(m => ({ ...m, missing: missingFields(m) })),
      missing,
      signed: !!reviews[dive],
      review: reviews[dive] ? { ...reviews[dive] } : null,
      history: (history[dive] || []).map(e => ({ ...e }))
    };
  }
  const allSummaries = () => listDives().map(diveSummary);

  /* ---------- 标记改动：已签字潜次自动失效 ---------- */

  function invalidate(dive, reason, at) {
    if (!reviews[dive]) return;
    const old = reviews[dive];
    delete reviews[dive];
    (history[dive] ||= []).forEach(e => {
      if (e.valid) e.valid = false; // 履历中的旧签字标记为失效
    });
    history[dive].push({
      type: "invalidate",
      reason: reason || "潜次内标记发生改动",
      signer: old.signer,
      comment: old.comment,
      at: at || now(),
      invalidAt: at || now()
    });
  }

  function addMark(data) {
    const mark = normalizeMark({ ...data, createdAt: now(), updatedAt: now() });
    marks.push(mark);
    invalidate(mark.dive || "—", "潜次新增标记");
    persist(); emit();
    return mark;
  }

  function updateMark(id, data) {
    const idx = marks.findIndex(m => m.id === id);
    if (idx < 0) return null;
    const before = marks[idx];
    const updated = normalizeMark({
      ...before, ...data, id, createdAt: before.createdAt, updatedAt: now()
    });
    marks[idx] = updated;
    const oldDive = before.dive || "—";
    const newDive = updated.dive || "—";
    invalidate(oldDive, "潜次内标记被编辑");
    if (newDive !== oldDive) invalidate(newDive, "有标记并入该潜次");
    persist(); emit();
    return { ...updated };
  }

  function removeMark(id) {
    const before = marks.find(m => m.id === id);
    if (!before) return;
    marks = marks.filter(m => m.id !== id);
    invalidate(before.dive || "—", "潜次内标记被移除");
    persist(); emit();
  }

  /* ---------- 签字 ---------- */

  function sign(dive, signer, comment) {
    const summary = diveSummary(dive);
    if (!summary.count) return { ok: false, error: "该潜次没有标记" };
    if (summary.missing) return { ok: false, error: "存在缺资料的标记，不能签字" };
    if (!String(signer || "").trim()) return { ok: false, error: "请填写签字人" };
    if (reviews[dive]) return { ok: false, error: "该潜次已签字" };
    const at = now();
    const review = { signer: signer.trim(), comment: (comment || "").trim(), at };
    reviews[dive] = review;
    (history[dive] ||= []).push({ type: "sign", ...review, valid: true });
    persist(); emit();
    return { ok: true };
  }

  const getConflicts = () => conflicts.map(c => ({ ...c }));
  const clearConflicts = () => { conflicts = []; persist(); emit(); };

  /* ---------- 备份导入：按潜次号 + 更新时间合并 ---------- */

  function parsePayload(input) {
    const data = JSON.parse(input);
    if (Array.isArray(data)) return { marks: data, reviews: {}, history: {}, exportedAt: null };
    if (data && Array.isArray(data.marks)) {
      return {
        marks: data.marks,
        reviews: data.reviews || {},
        history: data.history || {},
        exportedAt: data.exportedAt || null
      };
    }
    throw new Error("文件格式无法识别");
  }

  const tsOf = v => {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  };

  function importBackup(input) {
    const payload = parsePayload(input);
    const incoming = payload.marks.map(normalizeMark);
    const newConflicts = [];

    for (const inMark of incoming) {
      const target = marks.find(m => m.id === inMark.id) ||
        marks.find(m => m.code === inMark.code && (m.dive || "—") === (inMark.dive || "—"));

      if (!target) {
        // 档案里没有的标记：若并入已签字潜次，仍需列出冲突，原档保留
        if (reviews[inMark.dive || "—"]) {
          newConflicts.push({
            dive: inMark.dive || "—", code: inMark.code,
            kind: "signed", detail: "新增标记落入已签字潜次",
            local: "(无)", backup: formatTime(inMark.updatedAt), action: "保留原档"
          });
        } else {
          marks.push(inMark);
        }
        continue;
      }

      const oldDive = target.dive || "—";
      const newDive = inMark.dive || "—";
      const localSigned = !!reviews[oldDive] || !!reviews[newDive];
      const older = tsOf(inMark.updatedAt) < tsOf(target.updatedAt);
      if (older || localSigned) {
        // 备份较旧，或涉及的潜次已签字：保留原档，列出冲突
        newConflicts.push({
          dive: oldDive, code: target.code,
          kind: older ? "older" : "signed",
          detail: older
            ? "备份记录较旧"
            : (reviews[newDive] && newDive !== oldDive ? "目标潜次已签字" : "原档已签字"),
          local: formatTime(target.updatedAt), backup: formatTime(inMark.updatedAt),
          action: "保留原档"
        });
      } else {
        Object.assign(target, inMark, {
          id: target.id, createdAt: target.createdAt,
          dive: inMark.dive || target.dive,
          updatedAt: inMark.updatedAt || target.updatedAt
        });
        invalidate(oldDive, "导入的备份更新了标记");
        if (newDive !== oldDive) invalidate(newDive, "导入的备份并入了标记");
      }
    }

    // 复核信息只在原档没有任何签字履历的潜次采用
    for (const [dive, review] of Object.entries(payload.reviews || {})) {
      if (!reviews[dive] && !(history[dive] || []).length) {
        reviews[dive] = { ...review };
        (history[dive] ||= []).push({ type: "sign", ...review, valid: true });
      } else {
        newConflicts.push({
          dive, code: "（潜次复核）", kind: "signed",
          detail: "原档已有复核记录",
          local: formatTime((reviews[dive] || {}).at),
          backup: formatTime(review.at), action: "保留原档"
        });
      }
    }
    for (const [dive, events] of Object.entries(payload.history || {})) {
      const existing = new Set((history[dive] || []).map(e => e.at + "|" + e.signer));
      events.forEach(e => {
        if (!existing.has(e.at + "|" + e.signer)) (history[dive] ||= []).push({ ...e });
      });
    }

    conflicts = newConflicts.concat(conflicts);
    persist(); emit();
    return {
      imported: incoming.length,
      conflicts: newConflicts.length
    };
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  return {
    TYPE_NAMES, REQUIRED_FIELDS, typeName, formatTime,
    // 查询
    getMarks, getMark, listDives, diveSummary, allSummaries, missingFields,
    // 标记
    addMark, updateMark, removeMark,
    // 签字
    sign,
    // 冲突
    getConflicts, clearConflicts,
    // 导入
    importBackup,
    // 订阅界面刷新
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
