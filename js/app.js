/* 标记平面图界面：加点、编辑、移除、类型筛选、潜次时间线 */
(function (global) {
  const Archive = global.Archive;
  const map = document.querySelector("#map");
  const form = document.querySelector("#form");
  const list = document.querySelector("#list");
  const filter = document.querySelector("#filter");
  const view = document.querySelector("#view");
  const listTitle = document.querySelector("#listTitle");
  const TYPE_NAMES = Archive.TYPE_NAMES;

  let pending = null;

  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  function render() {
    const marks = Archive.getMarks();
    map.querySelectorAll(".marker").forEach(el => el.remove());
    const filtered = filter.value ? marks.filter(m => m.type === filter.value) : marks;
    filtered.forEach(mark => {
      const el = document.createElement("button");
      el.className = "marker " + mark.type + (mark.id === form.id.value ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.title = mark.code;
      el.textContent = mark.code.slice(0, 2);
      el.onclick = event => { event.stopPropagation(); edit(mark.id); };
      map.appendChild(el);
    });
    if (view.value === "timeline") renderTimeline(filtered);
    else renderList(filtered);
  }

  function statusPill(dive) {
    return Archive.getReview(dive).status === "signed"
      ? ' <span class="pill signed">已签字</span>'
      : ' <span class="pill">待复核</span>';
  }

  function renderList(data) {
    listTitle.textContent = "标记列表";
    list.className = "list";
    list.innerHTML = data.map(m =>
      '<div class="item ' + (m.id === form.id.value ? "active" : "") + '" data-id="' + m.id + '">' +
      "<b>" + m.code + "</b> <span class=\"pill\">" + TYPE_NAMES[m.type] + "</span>" + statusPill(m.dive) +
      '<div class="muted">' + m.dive + " · " + m.depth + " · " + (m.orientation || "—") + "</div>" +
      "<div>" + (m.condition || "（未填保存状态）") + "</div></div>").join("");
    list.querySelectorAll("[data-id]").forEach(el => el.onclick = () => edit(el.dataset.id));
  }

  function renderTimeline(data) {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    const groups = data.reduce((acc, item) => ((acc[item.dive] ||= []).push(item), acc), {});
    list.innerHTML = Object.entries(groups).map(([dive, items]) =>
      '<div class="item"><b>' + dive + "</b>" + statusPill(dive) +
      '<div class="muted">新增' + items.length + "个标记</div>" +
      items.map(i => "<div>" + i.code + " · " + TYPE_NAMES[i.type] + "</div>").join("") + "</div>").join("");
  }

  function edit(id) {
    const mark = Archive.getMarks().find(m => m.id === id);
    if (!mark) return;
    form.reset();
    for (const [key, value] of Object.entries(mark)) if (form[key]) form[key].value = value;
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
    form.id.value = "";
    form.code.value = "M-" + String(Archive.getMarks().length + 1).padStart(3, "0");
    form.dive.value = "DIVE-01";
    render();
  });

  form.onsubmit = event => {
    event.preventDefault();
    if (!pending) pending = { x: 50, y: 50 };
    const data = Object.fromEntries(new FormData(form).entries());
    Archive.upsertMark(Object.assign({}, data, pending));
    form.reset();
    pending = null;
    render();
    global.dispatchEvent(new CustomEvent("archive:changed"));
  };

  document.querySelector("#deleteBtn").onclick = () => {
    if (!form.id.value) return;
    Archive.removeMark(form.id.value);
    form.reset();
    pending = null;
    render();
    global.dispatchEvent(new CustomEvent("archive:changed"));
  };

  filter.onchange = render;
  view.onchange = render;
  global.addEventListener("archive:changed", render);
  render();
})(window);
