/*
 * review.js —— 潜次复核台界面：
 * 汇总每个潜次的标记/深度/保存状态，按复核状态筛选，
 * 缺资料禁止签字，签字后改动自动失效（履历保留），展示导入冲突。
 */
(() => {
  const A = window.Archive;
  const panel = document.querySelector("#reviewPanel");
  const filterEl = panel.querySelector("#reviewFilter");

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  panel.addEventListener("click", event => {
    if (event.target.closest("[data-clear-conflicts]")) A.clearConflicts();
  });

  panel.addEventListener("submit", event => {
    const form = event.target.closest("[data-sign-form]");
    if (!form) return;
    event.preventDefault();
    const dive = form.dataset.dive;
    const result = A.sign(
      dive,
      form.querySelector("[name=signer]").value,
      form.querySelector("[name=comment]").value
    );
    if (!result.ok) alert(result.error);
  });

  filterEl.addEventListener("change", render);

  function badgeFor(s) {
    if (s.signed) return '<span class="badge ok">已签字</span>';
    if (s.missing) return '<span class="badge warn">资料不齐</span>';
    return '<span class="badge pending">待复核</span>';
  }

  function matchFilter(s) {
    switch (filterEl.value) {
      case "signed": return s.signed;
      case "pending": return !s.signed && !s.missing;
      case "incomplete": return !s.signed && s.missing > 0;
      default: return true;
    }
  }

  function markRows(items) {
    return items.map(m => {
      const lack = m.missing.length
        ? '<div class="miss">缺：' + m.missing.map(k => A.REQUIRED_FIELDS[k]).join("、") + "</div>"
        : "";
      return `<tr>
        <td>${esc(m.code) || '<span class="miss">缺编号</span>'}</td>
        <td>${esc(A.typeName(m.type))}</td>
        <td>${esc(m.depth) || '<span class="miss">缺</span>'}</td>
        <td>${esc(m.orientation) || "—"}</td>
        <td>${esc(m.condition) || '<span class="miss">缺</span>'}${lack}</td>
      </tr>`;
    }).join("");
  }

  function signBox(s) {
    if (s.signed) {
      const r = s.review;
      return `<div class="signed-note">
        <div><b>${esc(r.signer)}</b> 已于 ${A.formatTime(r.at)} 签字确认</div>
        ${r.comment ? "<div>复核意见：" + esc(r.comment) + "</div>" : "<div>（未填写复核意见）</div>"}
        <div class="muted">潜次内标记再改动，签字将自动失效并回到待复核，旧签字保留在履历中。</div>
      </div>`;
    }
    if (s.missing) {
      return `<div class="lack-warning">有 ${s.missing} 个标记缺少必填资料，补齐前不能签字。</div>`;
    }
    return `<form class="sign-box" data-sign-form data-dive="${esc(s.dive)}">
      <div>
        <label>签字人</label>
        <input name="signer" placeholder="潜水长姓名" required>
      </div>
      <div>
        <label>复核意见</label>
        <textarea name="comment" placeholder="填写复核意见（可留空）"></textarea>
      </div>
      <div style="padding-top:26px"><button type="submit">签字确认</button></div>
    </form>`;
  }

  function historyBlock(events) {
    if (!events.length) return "";
    const rows = [...events].reverse().map(e => {
      if (e.type === "sign") {
        return `<div class="hist-event${e.valid ? "" : " invalidated"}">
          <b>${esc(e.signer)}</b> 签字 <span class="when">${A.formatTime(e.at)}</span>
          ${e.valid ? '<span class="pill ok">当前有效</span>' : '<span class="invalid-tag">已失效</span>'}
          ${e.comment ? "<div>" + esc(e.comment) + "</div>" : ""}
        </div>`;
      }
      return `<div class="hist-event invalidated">
        <b>签字失效</b> <span class="when">${A.formatTime(e.invalidAt || e.at)}</span>
        <div>原签字人：${esc(e.signer)} · 原因：${esc(e.reason)}</div>
        ${e.comment ? "<div>原意见：" + esc(e.comment) + "</div>" : ""}
      </div>`;
    }).join("");
    return `<div class="history"><div class="history-title">签字履历</div>${rows}</div>`;
  }

  function conflictBox() {
    const list = A.getConflicts();
    if (!list.length) return "";
    const rows = list.map(c => `<tr>
      <td>${esc(c.dive)}</td><td>${esc(c.code)}</td><td>${esc(c.detail)}</td>
      <td>${esc(c.local)}</td><td>${esc(c.backup)}</td><td>${esc(c.action)}</td>
    </tr>`).join("");
    return `<div class="conflict-box">
      <h3>导入冲突（${list.length}）</h3>
      <table class="conflict-table">
        <thead><tr><th>潜次</th><th>标记</th><th>原因</th><th>原档更新时间</th><th>备份更新时间</th><th>处理</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px"><button type="button" class="secondary" data-clear-conflicts>已确认，清空清单</button></div>
    </div>`;
  }

  function render() {
    const summaries = A.allSummaries().filter(matchFilter);
    const grid = panel.querySelector("#diveGrid");
    panel.querySelector("#conflictSlot").innerHTML = conflictBox();

    if (!summaries.length) {
      grid.innerHTML = '<div class="empty">没有符合筛选条件的潜次。</div>';
      return;
    }

    grid.innerHTML = summaries.map(s => `<div class="dive-card ${s.signed ? "signed" : ""}">
      <div class="dive-head">
        <h3>${esc(s.dive)} <span class="muted">共 ${s.count} 个标记${s.missing ? " · " + s.missing + " 个缺资料" : ""}</span></h3>
        ${badgeFor(s)}
      </div>
      <table class="mark-table">
        <thead><tr><th>编号</th><th>类型</th><th>深度</th><th>朝向</th><th>保存状态</th></tr></thead>
        <tbody>${markRows(s.items)}</tbody>
      </table>
      ${signBox(s)}
      ${historyBlock(s.history)}
    </div>`).join("");
  }

  A.subscribe(render);
  window.addEventListener("storage", render);
  document.addEventListener("DOMContentLoaded", render);
})();
