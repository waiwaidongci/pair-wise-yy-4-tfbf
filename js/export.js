/*
 * export.js —— 导出三份文件：
 *   1. 标记原始 JSON（与旧版格式一致，可再次导入）
 *   2. 标记清单 CSV（给队内传阅/表格软件打开）
 *   3. 复核汇总 JSON（潜次 + 签字 + 履历 + 完整备份数据，可再次导入）
 */
window.DiveExport = (() => {
  const A = window.Archive;

  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // 1. 原有 JSON 导出：仅标记数组，格式保持与旧版本一致
  function exportMarksJSON() {
    const payload = A.getMarks().map(m => ({
      id: m.id, code: m.code, type: m.type, dive: m.dive,
      x: m.x, y: m.y, depth: m.depth, orientation: m.orientation,
      condition: m.condition, note: m.note,
      createdAt: m.createdAt, updatedAt: m.updatedAt
    }));
    download(JSON.stringify(payload, null, 2), "dive-marks.json", "application/json");
  }

  // 2. 标记清单 CSV
  function exportMarksCSV() {
    const head = ["潜次", "编号", "类型", "深度", "朝向", "保存状态", "备注", "更新时间"];
    const rows = A.getMarks()
      .sort((a, b) => (a.dive + a.code).localeCompare(b.dive + b.code))
      .map(m => [
        m.dive, m.code, A.typeName(m.type), m.depth,
        m.orientation, m.condition, m.note, A.formatTime(m.updatedAt)
      ]);
    const csv = [head, ...rows].map(cols =>
      cols.map(csvCell).join(",")
    ).join("\r\n");
    // BOM 让 Excel 正确识别 UTF-8
    download("﻿" + csv, "mark-list-" + stamp() + ".csv", "text/csv;charset=utf-8");
  }

  function csvCell(value) {
    const s = String(value ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // 3. 复核汇总（结构化，同时是完整备份，可回导合并）
  function exportReviewSummary() {
    const dives = A.allSummaries().map(s => ({
      dive: s.dive,
      markCount: s.count,
      incompleteMarks: s.missing,
      status: s.signed ? "signed" : (s.missing ? "incomplete" : "pending"),
      signer: s.review ? s.review.signer : null,
      comment: s.review ? s.review.comment : null,
      signedAt: s.review ? s.review.at : null,
      marks: s.items.map(m => ({
        code: m.code, type: m.type, depth: m.depth,
        orientation: m.orientation, condition: m.condition,
        missing: m.missing.map(k => A.REQUIRED_FIELDS[k])
      }))
    }));

    // 附带完整档案，使汇总文件可直接作为备份回导
    const marks = A.getMarks();
    const payload = {
      format: "dive-review-summary",
      version: 1,
      exportedAt: new Date().toISOString(),
      dives,
      conflicts: A.getConflicts(),
      marks,
      reviews: collectReviews(),
      history: collectHistory()
    };
    download(JSON.stringify(payload, null, 2),
      "review-summary-" + stamp() + ".json", "application/json");
  }

  // reviews/history 从档案的潜次汇总中重建
  function collectReviews() {
    const out = {};
    A.allSummaries().forEach(s => {
      if (s.review) out[s.dive] = s.review;
    });
    return out;
  }
  function collectHistory() {
    const out = {};
    A.allSummaries().forEach(s => {
      if (s.history.length) out[s.dive] = s.history;
    });
    return out;
  }

  return { exportMarksJSON, exportMarksCSV, exportReviewSummary };
})();
