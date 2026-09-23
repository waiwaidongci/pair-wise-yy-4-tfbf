/* 导出：标记清单 CSV、复核汇总 CSV，以及原有的 JSON 导出 */
(function (global) {
  const Archive = global.Archive;

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: (mime || "text/plain") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function stamp(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    // BOM 便于 Excel 正确识别中文
    return "﻿" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  }

  /* 标记清单：逐行导出每个标记及其复核状态 */
  function exportMarksCsv() {
    const rows = [["潜次", "编号", "类型", "深度", "朝向", "保存状态", "位置X%", "位置Y%", "复核状态", "备注"]];
    const marks = Archive.getMarks().slice();
    marks.sort(Archive.byDiveCode);
    for (const m of marks) {
      const r = Archive.getReview(m.dive);
      rows.push([
        m.dive, m.code, Archive.TYPE_NAMES[m.type] || m.type, m.depth, m.orientation,
        m.condition, m.x, m.y, r.status === "signed" ? "已签字" : "待复核", m.note
      ]);
    }
    download("标记清单-" + stamp() + ".csv", toCsv(rows), "text/csv");
  }

  /* 复核汇总：每个潜次一行，含标记数、深度、保存状态、缺资料、签字信息 */
  function exportReviewCsv() {
    const rows = [["潜次", "标记数", "深度范围", "保存状态", "资料完整度", "复核状态", "潜水长", "意见", "签字时间", "潜次更新时间"]];
    for (const s of Archive.summaries()) {
      const r = s.review;
      const missing = s.complete ? "" : s.missing.map(x => x.code + "缺" + x.fields.join("/")).join("；");
      rows.push([
        s.dive, s.count, s.depthRange, s.conditions,
        s.complete ? "完整" : "缺资料：" + missing,
        r.status === "signed" ? "已签字" : "待复核",
        r.signer || "", r.comment || "",
        r.signedAt ? Archive.fmtTime(r.signedAt) : "",
        s.updatedAt ? Archive.fmtTime(s.updatedAt) : ""
      ]);
    }
    download("复核汇总-" + stamp() + ".csv", toCsv(rows), "text/csv");
  }

  function exportJson() {
    download("dive-marks-" + stamp() + ".json",
      JSON.stringify(Archive.backupPayload(), null, 2), "application/json");
  }

  global.DiveExport = { exportMarksCsv, exportReviewCsv, exportJson };
})(window);
