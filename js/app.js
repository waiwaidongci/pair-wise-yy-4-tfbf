/*
 * app.js —— 平面图主界面：加点、编辑、移除、类型筛选、潜次时间线。
 * 数据改动统一走 Archive，已签字潜次被改动会自动失效签字。
 */
(() => {
  const A = window.Archive;
  const map = document.querySelector("#map");
  const form = document.querySelector("#form");
  const list = document.querySelector("#list");
  const filter = document.querySelector("#filter");
  const view = document.querySelector("#view");
  const listTitle = document.querySelector("#listTitle");

  let pending = null; // 新标记或编辑中的坐标

  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function signedDive(dive) {
    return !!A.diveSummary(dive || "—").signed;
  }

  function render() {
    const marks = A.getMarks();
    map.querySelectorAll(".marker").forEach(el => el.remove());
    const filtered = filter.value ? marks.filter(m => m.type === filter.value) : marks;
    filtered.forEach(mark => {
      const el = document.createElement("button");
      el.className = "marker " + mark.type + (mark.id === form.elements.id.value ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.title = mark.code + (A.missingFields(mark).length ? "（资料不齐）" : "");
      el.textContent = mark.code.slice(0, 2);
      el.onclick = event => { event.stopPropagation(); edit(mark.id); };
      map.appendChild(el);
    });
    if (view.value === "timeline") renderTimeline(filtered);
    else renderList(filtered);
  }

  function statusPill(m) {
    const lack = A.missingFields(m).length;
    if (lack) return '<span class="pill warn">资料不齐</span>';
    if (signedDive(m.dive)) return '<span class="pill ok">已签字</span>';
    return '<span class="pill">待复核</span>';
  }

  function renderList(data) {
    listTitle.textContent = "标记列表";
    list.className = "list";
    list.innerHTML = data.map(m =>
      '<div class="item ' + (m.id === form.elements.id.value ? "active" : "") + '" data-id="' + m.id + '">' +
      '<b>' + esc(m.code) + '</b> <span class="pill">' + A.typeName(m.type) + '</span>' + statusPill(m) +
      '<div class="muted">' + esc(m.dive) + " · " + esc(m.depth || "缺深度") + " · " + esc(m.orientation || "—") + '</div>' +
      '<div>' + esc(m.condition || "缺保存状态") + '</div></div>'
    ).join("");
    list.querySelectorAll("[data-id]").forEach(el => el.onclick = () => edit(el.dataset.id));
  }

  function renderTimeline(data) {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    const groups = data.reduce((g, item) => ((g[item.dive] ||= []).push(item), g), {});
    list.innerHTML = Object.entries(groups).map(([dive, items]) => {
      const s = A.diveSummary(dive);
      const state = s.signed
        ? '<span class="pill ok">已签字</span>'
        : (s.missing ? '<span class="pill warn">资料不齐</span>' : '<span class="pill">待复核</span>');
      return '<div class="item"><b>' + esc(dive) + '</b> ' + state +
        '<div class="muted">' + items.length + '个标记</div>' +
        items.map(i => "<div>" + esc(i.code) + " · " + A.typeName(i.type) + "</div>").join("") +
        "</div>";
    }).join("");
  }

  function edit(id) {
    const mark = A.getMark(id);
    if (!mark) return;
    for (const [key, value] of Object.entries(mark)) if (form.elements[key]) form.elements[key].value = value;
    pending = { x: mark.x, y: mark.y };
    render();
  }

  map.addEventListener("click", event => {
    const rect = map.getBoundingClientRect();
    pending = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    form.reset();
    form.elements.id.value = "";
    form.elements.code.value = "M-" + String(A.getMarks().length + 1).padStart(3, "0");
    form.elements.dive.value = "DIVE-01";
    render();
  });

  form.onsubmit = event => {
    event.preventDefault();
    if (!pending) pending = { x: 50, y: 50 };
    const data = Object.fromEntries(new FormData(form).entries());

    if (data.id) {
      const before = A.getMark(data.id);
      if (before && (signedDive(before.dive) ||
        (data.dive !== before.dive && signedDive(data.dive)))) {
        if (!confirm("该标记所属潜次已经签字，保存后签字将失效并回到待复核。是否继续？")) return;
      }
      A.updateMark(data.id, { ...data, ...pending });
    } else {
      if (signedDive(data.dive)) {
        if (!confirm(data.dive + " 已经签字，新增标记会使该潜次签字失效。是否继续？")) return;
      }
      A.addMark({ ...data, ...pending });
    }
    form.reset();
    pending = null;
  };

  document.querySelector("#deleteBtn").onclick = () => {
    if (!form.elements.id.value) return;
    const before = A.getMark(form.elements.id.value);
    if (before && signedDive(before.dive) &&
      !confirm(before.dive + " 已经签字，删除标记会使该潜次签字失效。是否继续？")) return;
    A.removeMark(form.elements.id.value);
    form.reset();
    pending = null;
  };

  /* ---------- 顶部按钮：三个导出 + 备份导入 ---------- */

  document.querySelector("#exportBtn").onclick = () => window.DiveExport.exportMarksJSON();
  document.querySelector("#exportCsvBtn").onclick = () => window.DiveExport.exportMarksCSV();
  document.querySelector("#exportReviewBtn").onclick = () => window.DiveExport.exportReviewSummary();

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  document.querySelector("#importBtn").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = A.importBackup(String(reader.result));
        alert("导入完成：读取 " + r.imported + " 条标记，" +
          (r.conflicts ? r.conflicts + " 条冲突（已保留原档，见复核台冲突清单）。" : "无冲突。"));
        document.querySelector("#reviewTab").click();
      } catch (err) {
        alert("导入失败：" + err.message);
      } finally {
        fileInput.value = "";
      }
    };
    reader.readAsText(file);
  };

  /* ---------- 页签切换 ---------- */

  document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-panel").forEach(p =>
        p.classList.toggle("active", p.id === tab.dataset.target));
      render();
    };
  });

  filter.onchange = render;
  view.onchange = render;
  A.subscribe(render);
  window.addEventListener("storage", render);
  render();
})();
