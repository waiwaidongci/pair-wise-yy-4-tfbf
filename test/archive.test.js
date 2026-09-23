// archive.js 的规则测试：用最小 DOM/浏览器桩在 Node 中加载
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

function loadArchive(storage = {}) {
  const listeners = {};
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    crypto: { randomUUID: () => "u" + Math.random().toString(16).slice(2) },
    window: {},
    Date, JSON, Number, String, Object, Array, Set, Map
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "archive.js"), "utf8"), sandbox);
  return { A: sandbox.window.Archive, storage };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("✓", name); }

test("缺资料潜次不能签字，补齐后可以", () => {
  const { A } = loadArchive();
  // DIVE-01 资料齐全
  assert.strictEqual(A.sign("DIVE-01", "王潜长", "无误").ok, true);
  // DIVE-02 有标记缺深度/保存状态
  const fail = A.sign("DIVE-02", "王潜长");
  assert.strictEqual(fail.ok, false);
  assert.match(fail.error, /缺资料/);
  const incomplete = A.getMarks().find(m => m.code === "M-009");
  A.updateMark(incomplete.id, { ...incomplete, depth: "19.1m", condition: "轻微锈蚀" });
  assert.strictEqual(A.sign("DIVE-02", "王潜长").ok, true);
});

test("已签字潜次内编辑标记 -> 失效并回到待复核，旧签字留在履历", () => {
  const { A } = loadArchive();
  A.sign("DIVE-01", "王潜长", "初签");
  assert.strictEqual(A.diveSummary("DIVE-01").signed, true);
  const m = A.getMarks().find(x => x.code === "A-017");
  A.updateMark(m.id, { ...m, note: "更新备注" });
  const s = A.diveSummary("DIVE-01");
  assert.strictEqual(s.signed, false);
  const types = s.history.map(e => e.type);
  assert.strictEqual(JSON.stringify(types), JSON.stringify(["sign", "invalidate"]));
  assert.strictEqual(s.history[0].valid, false); // 旧签字标记失效但保留
});

test("已签字潜次新增/删除标记也失效", () => {
  const { A } = loadArchive();
  A.sign("DIVE-01", "王潜长");
  A.addMark({ code: "X-1", type: "metal", dive: "DIVE-01", x: 1, y: 2, depth: "9m", condition: "好" });
  assert.strictEqual(A.diveSummary("DIVE-01").signed, false);

  A.sign("DIVE-02") && 0; // DIVE-02 缺资料签不了，先补齐
  const m9 = A.getMarks().find(x => x.code === "M-009");
  A.updateMark(m9.id, { ...m9, depth: "19m", condition: "ok" });
  A.sign("DIVE-02", "王潜长");
  A.removeMark(m9.id);
  assert.strictEqual(A.diveSummary("DIVE-02").signed, false);
});

test("导入较旧备份：保留原档并列出冲突", () => {
  const { A } = loadArchive();
  A.sign("DIVE-01", "王潜长");
  const target = A.getMarks().find(m => m.code === "A-017");
  const oldPayload = JSON.stringify({
    format: "dive-review-summary", marks: [{
      id: target.id, code: "A-017", type: "ceramic", dive: "DIVE-01",
      x: 42, y: 46, depth: "1.0m", condition: "旧值",
      createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z"
    }]
  });
  const r = A.importBackup(oldPayload);
  assert.strictEqual(r.conflicts, 1);
  const kept = A.getMarks().find(m => m.id === target.id);
  assert.strictEqual(kept.depth, "17.8m"); // 原档保留
  assert.strictEqual(A.getConflicts()[0].kind, "older");
  assert.strictEqual(A.diveSummary("DIVE-01").signed, true);
});

test("导入较新记录到已签字潜次：已签字优先，保留原档列冲突", () => {
  const { A } = loadArchive();
  A.sign("DIVE-01", "王潜长");
  const target = A.getMarks().find(m => m.code === "A-017");
  const future = "2099-01-01T00:00:00.000Z";
  const r = A.importBackup(JSON.stringify({
    marks: [{ id: target.id, code: "A-017", type: "ceramic", dive: "DIVE-01",
      x: 1, y: 1, depth: "99m", condition: "新值", createdAt: future, updatedAt: future }]
  }));
  assert.strictEqual(r.conflicts, 1);
  assert.strictEqual(A.getMarks().find(m => m.id === target.id).depth, "17.8m");
  assert.strictEqual(A.diveSummary("DIVE-01").signed, true);
});

test("导入较新记录到待复核潜次：采用备份", () => {
  const { A } = loadArchive();
  const target = A.getMarks().find(m => m.code === "W-003");
  const future = "2099-01-01T00:00:00.000Z";
  const r = A.importBackup(JSON.stringify({
    marks: [{ id: target.id, code: "W-003", type: "wood", dive: "DIVE-02",
      x: 1, y: 1, depth: "25.5m", condition: "更新", createdAt: future, updatedAt: future }]
  }));
  assert.strictEqual(r.conflicts, 0);
  assert.strictEqual(A.getMarks().find(m => m.id === target.id).depth, "25.5m");
});

test("旧版纯数组 JSON 可导入，新标记加入未签字潜次", () => {
  const { A } = loadArchive();
  const r = A.importBackup(JSON.stringify([
    { code: "Z-9", type: "unknown", dive: "DIVE-09", depth: "12m", condition: "ok",
      createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" }
  ]));
  assert.strictEqual(r.imported, 1);
  assert.strictEqual(r.conflicts, 0);
  assert.ok(A.listDives().includes("DIVE-09"));
});

test("复核汇总导出后回导：本地已签字潜次的复核不被覆盖，列冲突", () => {
  const { A } = loadArchive();
  A.sign("DIVE-01", "本地潜水长");
  // 模拟另一台机器导出的汇总：同一潜次不同签字人
  const summary = {
    format: "dive-review-summary",
    marks: A.getMarks(),
    reviews: { "DIVE-01": { signer: "别队潜水长", comment: "", at: "2030-01-01T00:00:00.000Z" } },
    history: { "DIVE-01": [{ type: "sign", signer: "别队潜水长", at: "2030-01-01T00:00:00.000Z", valid: true }] }
  };
  const r = A.importBackup(JSON.stringify(summary));
  assert.ok(r.conflicts >= 1);
  assert.strictEqual(A.diveSummary("DIVE-01").review.signer, "本地潜水长");
});

test("空潜次/无签字人不能签字；重复签字被拒", () => {
  const { A } = loadArchive();
  assert.strictEqual(A.sign("DIVE-01", "").ok, false);
  A.sign("DIVE-01", "王潜长");
  assert.strictEqual(A.sign("DIVE-01", "王潜长").ok, false);
});

console.log(`\n${passed} 项测试全部通过`);
