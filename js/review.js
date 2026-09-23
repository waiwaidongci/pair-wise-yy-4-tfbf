/* 潜次复核台：汇总标记/深度/保存状态，缺资料禁签，意见与签字，状态筛选，导入冲突列表 */
(function (global) {
  const Archive = global.Archive;
  let root = null;
  let statusFilter = "";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function historyHtml(history) {
    if (!history || !history.length) return '<div class="muted">暂无签字履历</div>';
    return history.slice().reverse().map(h => {
      if (h.action === "signed") {
        return '<div class="history-entry">✅ <b>' + esc(h.signer) + "</b> 签字于 " +
          esc(Archive.fmtTime(h.at)) +
          (h.comment ? ' <span class="muted">意见：' + esc(h.comment) + "</span>" : "") + "</div>";
      }
      return '<div class="history-entry voided">↩ 签字失效于 ' +
        esc(Archive.fmtTime(h.at)) + ' <span class="muted">（' + esc(h.reason || "标记改动") + "，旧签字留档）</span></div>";
    }).join("");
  }

  function cardHtml(s) {
    const signed = s.review.status === "signed";
    const badge = signed
      ? '<span class="status-pill signed">已签字</span>'
      : '<span class="status-pill pending">待复核</span>';
    const missingHtml = s.complete ? "" :
      '<div class="warn-box">⚠ 标记缺资料，不能签字：' +
      s.missing.map(x => "<b>" + esc(x.code) + "</b>缺" + esc(x.fields.join("、"))).join("；") + "</div>";

    const missingIds = new Set(s.missing.map(x => x.id));
    const rows = s.marks.map(m => {
      const miss = missingIds.has(m.id);
      return '<tr class="' + (miss ? "row-missing" : "") + '"><td>' + esc(m.code || "（未编号）") +
        '</td><td>' + esc(Archive.TYPE_NAMES[m.type] || m.type) +
        '</td><td>' + (esc(m.depth) || '<span class="missing">缺</span>') +
        '</td><td>' + (esc(m.condition) || '<span class="missing">缺</span>') +
        '</td><td>' + esc(m.orientation || "—") + '</td></tr>';
    }).join("");

    const actionHtml = signed
      ? '<div class="signed-box">' +
        '<div>签字人：<b>' + esc(s.review.signer) + '</b>　签字时间：' + esc(Archive.fmtTime(s.review.signedAt)) + "</div>" +
        (s.review.comment ? '<div class="muted">意见：' + esc(s.review.comment) + "</div>" : "") +
        '<div class="muted">提示：签字后若改动本潜次标记，签字将自动失效并回到待复核，旧签字留在履历。</div></div>'
      : missingHtml +
        '<div class="sign-box">' +
        '<label>潜水长姓名（必填）</label>' +
        '<input data-signer="' + esc(s.dive) + '" placeholder="签字人姓名">' +
        '<label>复核意见</label>' +
        '<textarea data-comment="' + esc(s.dive) + '" placeholder="填写复核意见后签字"></textarea>' +
        '<div class="sign-row"><span class="muted">资料不完整时按钮无法签字</span>' +
        '<button data-action="sign" data-dive="' + esc(s.dive) + '"' + (s.complete ? "" : " disabled") +
        '>签字确认</button></div>' +
        '<div class="review-error" data-error="' + esc(s.dive) + '"></div></div>';

    return '<article class="review-card">' +
      '<div class="review-head"><h3>' + esc(s.dive) + "</h3>" + badge + "</div>" +
      '<div class="metrics">' +
      '<div class="metric"><span>标记数</span><b>' + s.count + "</b></div>" +
      '<div class="metric"><span>深度范围</span><b>' + esc(s.depthRange) + "</b></div>" +
      '<div class="metric"><span>保存状态</span><b>' + esc(s.conditions) + "</b></div>" +
      '<div class="metric"><span>更新时间</span><b>' + esc(Archive.fmtTime(s.updatedAt)) + "</b></div>" +
      "</div>" +
      '<table class="mark-table"><thead><tr><th>编号</th><th>类型</th><th>深度</th><th>保存状态</th><th>朝向</th></tr></thead>' +
      '<tbody>' + rows + "</tbody></table>" +
      actionHtml +
      '<div class="history"><h4>签字履历</h4>' + historyHtml(s.review.history) + "</div>" +
      "</article>";
  }

  function render() {
    if (!root) return;
    const all = Archive.summaries();
    const list = statusFilter ? all.filter(s => s.review.status === statusFilter) : all;
    const counts = {
      all: all.length,
      signed: all.filter(s => s.review.status === "signed").length,
      pending: all.filter(s => s.review.status === "pending").length
    };
    root.querySelector("[data-role=filter]").value = statusFilter;
    const container = root.querySelector("[data-role=list]");
    if (!list.length) {
      container.innerHTML = '<div class="empty">没有符合该复核状态的潜次。</div>';
    } else {
      container.innerHTML = list.map(cardHtml).join("");
    }
    const counter = root.querySelector("[data-role=count]");
    if (counter) {
      counter.textContent = "共 " + counts.all + " 个潜次 · 待复核 " + counts.pending + " · 已签字 " + counts.signed;
    }
  }

  function reportHtml(result) {
    const imported = result.imported.length
      ? "已合并：" + result.imported.map(esc).join("、")
      : "没有新潜次被合并。";
    const conflictRows = result.conflicts.map(c =>
      "<tr><td>" + esc(c.dive) + "</td><td>" + esc(c.reason) + "</td>" +
      "<td>" + esc(Archive.fmtTime(c.localTime)) + "</td><td>" + esc(Archive.fmtTime(c.inTime)) + "</td></tr>").join("");
    const conflicts = result.conflicts.length
      ? '<h4>冲突列表（保留本地原档）</h4><table class="conflict-table"><thead><tr><th>潜次</th><th>原因</th><th>本地更新时间</th><th>备份更新时间</th></tr></thead><tbody>' +
        conflictRows + "</tbody></table>"
      : "<div class=\"muted\">无冲突。</div>";
    const note = result.note ? '<div class="warn-box">' + esc(result.note) + "</div>" : "";
    return "<h4>导入结果</h4><div>" + imported + "</div>" + note + conflicts;
  }

  function onFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const report = root.querySelector("[data-role=importReport]");
      let payload;
      try {
        payload = JSON.parse(String(reader.result));
      } catch (e) {
        report.innerHTML = '<div class="warn-box">无法解析备份文件：请选择队里导出的 JSON 文件。</div>';
        report.hidden = false;
        return;
      }
      const backupAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
      const result = Archive.importBackup(payload, backupAt);
      report.innerHTML = reportHtml(result);
      report.hidden = false;
      render();
      global.dispatchEvent(new CustomEvent("archive:changed"));
    };
    reader.readAsText(file);
  }

  function init(el) {
    root = el;
    root.addEventListener("change", event => {
      if (event.target.matches("[data-role=filter]")) {
        statusFilter = event.target.value;
        render();
      } else if (event.target.matches("[data-role=importFile]")) {
        if (event.target.files && event.target.files[0]) onFile(event.target.files[0]);
        event.target.value = "";
      }
    });
    root.addEventListener("click", event => {
      const btn = event.target.closest("[data-action=sign]");
      if (!btn) return;
      const dive = btn.dataset.dive;
      const findByData = name => [...root.querySelectorAll("[" + name + "]")]
        .find(el => el.getAttribute(name) === dive);
      const signer = findByData("data-signer");
      const comment = findByData("data-comment");
      const error = findByData("data-error");
      const res = Archive.sign(dive, signer ? signer.value : "", comment ? comment.value : "");
      if (!res.ok) {
        error.textContent = res.error + (res.missing ? "：" + res.missing.map(x => x.code + "缺" + x.fields.join("/")).join("；") : "");
      } else {
        render();
      }
    });
    global.addEventListener("archive:changed", render);
    render();
  }

  global.ReviewStation = { init, render };
})(window);
