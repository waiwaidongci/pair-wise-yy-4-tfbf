// 页面级冒烟：在 jsdom 中加载 index.html，验证渲染、筛选、签字与失效联动
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
const { window } = dom;

// localStorage 在 url 配置下可用；加载脚本（按 index.html 中的顺序）
for (const src of ["js/archive.js", "js/export.js", "js/review.js", "js/app.js"]) {
  window.eval(fs.readFileSync(path.join(root, src), "utf8"));
}
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const $ = sel => window.document.querySelector(sel);
const $$ = sel => [...window.document.querySelectorAll(sel)];
const assert = require("assert");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("✓", name); };

test("初始渲染：地图标记与列表条目", () => {
  assert.strictEqual($$(".marker").length, 3);
  assert.strictEqual($$("#list .item").length, 3);
});

test("列表与时间线显示复核状态药丸", () => {
  assert.ok($$("#list .pill.warn").length >= 1, "M-009 资料不齐");
  $("#view").value = "timeline";
  $("#view").dispatchEvent(new window.Event("change"));
  assert.ok($$("#list .item").length >= 2, "按潜次分组");
  assert.ok($$("#list .pill.warn").length >= 1, "DIVE-02 组为资料不齐");
  $("#view").value = "list";
  $("#view").dispatchEvent(new window.Event("change"));
});

test("切到复核台：每个潜次一张卡片，DIVE-02 禁止签字", () => {
  $('[data-target="reviewPanel"]').click();
  const cards = $$("#diveGrid .dive-card");
  assert.strictEqual(cards.length, 2);
  const d2 = cards.find(c => c.querySelector("h3").textContent.includes("DIVE-02"));
  assert.ok(d2.querySelector(".lack-warning"), "资料不齐显示禁签提示");
  assert.ok(!d2.querySelector("[data-sign-form]"), "不显示签字表单");
});

test("DIVE-01 填写意见并签字 -> 已签字", () => {
  const form = $('[data-sign-form][data-dive="DIVE-01"]');
  assert.ok(form);
  form.querySelector("[name=signer]").value = "王潜长";
  form.querySelector("[name=comment]").value = "位置与深度核对无误";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const d1 = $$("#diveGrid .dive-card").find(c => c.querySelector("h3").textContent.includes("DIVE-01"));
  assert.ok(d1.classList.contains("signed"));
  assert.ok(d1.textContent.includes("王潜长"));
  assert.ok(d1.textContent.includes("位置与深度核对无误"));
});

test("复核状态筛选：已签字/资料不齐/待复核", () => {
  const f = $("#reviewFilter");
  f.value = "signed"; f.dispatchEvent(new window.Event("change"));
  assert.strictEqual($$("#diveGrid .dive-card").length, 1);
  f.value = "incomplete"; f.dispatchEvent(new window.Event("change"));
  assert.strictEqual($$("#diveGrid .dive-card").length, 1);
  f.value = "pending"; f.dispatchEvent(new window.Event("change"));
  assert.strictEqual($$("#diveGrid .dive-card").length, 0);
  f.value = ""; f.dispatchEvent(new window.Event("change"));
  assert.strictEqual($$("#diveGrid .dive-card").length, 2);
});

test("平面图改动已签字潜次的标记 -> 复核台显示失效与履历（confirm 桩放行）", () => {
  window.confirm = () => true;
  $('[data-target="mapPanel"]').click();
  // 选中 A-017（DIVE-01，已签字）并保存备注改动
  const a017 = $$("#list .item").find(el => el.textContent.includes("A-017"));
  a017.click();
  const form = $("#form");
  assert.strictEqual(form.elements.dive.value, "DIVE-01");
  form.elements.note.value = "复核后追加备注";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  $('[data-target="reviewPanel"]').click();
  const d1 = $$("#diveGrid .dive-card").find(c => c.querySelector("h3").textContent.includes("DIVE-01"));
  assert.ok(!d1.classList.contains("signed"), "回到待复核");
  assert.ok(d1.querySelector(".badge.pending"), "状态徽章为待复核");
  const hist = d1.querySelectorAll(".hist-event");
  assert.strictEqual(hist.length, 2, "一条旧签字 + 一条失效记录");
  assert.ok(d1.querySelector(".hist-event.invalidated .invalid-tag"), "旧签字标注已失效并保留");
});

test("补齐 DIVE-02 资料后可以签字", () => {
  $('[data-target="mapPanel"]').click();
  const m9 = $$("#list .item").find(el => el.textContent.includes("M-009"));
  m9.click();
  const form = $("#form");
  form.elements.depth.value = "18.9m";
  form.elements.condition.value = "表面凝结物";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  $('[data-target="reviewPanel"]').click();
  const form2 = $('[data-sign-form][data-dive="DIVE-02"]');
  assert.ok(form2, "资料齐全后出现签字表单");
  form2.querySelector("[name=signer]").value = "李潜水长";
  form2.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(!$('[data-sign-form][data-dive="DIVE-02"]'));
});

test("冲突清单渲染与清空", () => {
  const A = window.Archive;
  const w003 = A.getMarks().find(m => m.code === "W-003");
  A.importBackup(JSON.stringify([{
    id: w003.id, code: "W-003", type: "wood", dive: "DIVE-02",
    depth: "1.0m", condition: "旧",
    createdAt: "2000-01-01T00:00:00Z", updatedAt: "2000-01-01T00:00:00Z"
  }]));
  const box = $(".conflict-box");
  assert.ok(box, "显示冲突清单");
  assert.ok(box.textContent.includes("备份记录较旧"));
  $("[data-clear-conflicts]").click();
  assert.ok(!$(".conflict-box"));
});

test("导出函数均产出下载（Blob 桩）", () => {
  let downloads = [];
  window.URL.createObjectURL = () => "blob:x";
  window.URL.revokeObjectURL = () => {};
  const origCreate = window.document.createElement.bind(window.document);
  window.document.createElement = tag => {
    const el = origCreate(tag);
    if (tag === "a") el.click = () => downloads.push(el.download);
    return el;
  };
  const E = window.DiveExport;
  E.exportMarksJSON();
  E.exportMarksCSV();
  E.exportReviewSummary();
  assert.strictEqual(downloads[0], "dive-marks.json");
  assert.ok(/^mark-list-.*\.csv$/.test(downloads[1]));
  assert.ok(/^review-summary-.*\.json$/.test(downloads[2]));
});

console.log(`\n${passed} 项页面冒烟测试全部通过`);
