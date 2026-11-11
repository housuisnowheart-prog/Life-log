const assert = require("node:assert/strict");
const chart = require("../chart.js");
const end = 86400000;
const lines = [
  {
    id: "a",
    name: "A<script>",
    unit: "mg/L",
    points: [
      { time: 0, value: 0 },
      { time: end / 2, value: 100 },
      { time: end, value: 0 },
    ],
  },
  {
    id: "b",
    name: "B",
    unit: "mg/L",
    points: [
      { time: 0, value: 0 },
      { time: end / 2, value: 1 },
      { time: end, value: 0 },
    ],
  },
];
const base = { width: 390, start: 0, end, unit: "mg/L", now: 0 };
assert.equal(chart.niceMax(100), 200);
assert.equal(chart.niceMax(1), 2);
assert.equal(chart.niceMax(0), 1);
assert.equal(chart.niceMax(0.001), 0.002);
assert.throws(() => chart.niceMax(Infinity));
const shared = chart.render(lines, base);
assert.equal(shared.axes[0].max, shared.axes[1].max);
assert(!shared.html.includes("A<script>"));
assert(shared.html.includes("A&lt;script&gt;"));
const dual = chart.render(lines, { ...base, mode: "dual" });
assert.deepEqual(
  dual.axes.map((a) => [a.side, a.max]),
  [
    ["left", 200],
    ["right", 2],
  ],
);
const separate = chart.render(lines, { ...base, mode: "separate" });
assert.equal(separate.html.match(/data-plot="true"/g).length, 2);
assert.deepEqual(
  separate.axes.map((a) => a.max),
  [200, 2],
);
assert.deepEqual(chart.timeTick(end, 0, "minutes"), ["1440", "分"]);
assert.deepEqual(chart.timeTick(end, 0, "hours"), ["24", "時間"]);
assert.deepEqual(chart.timeTick(end, 0, "days"), ["1", "日"]);
const swap = chart.render(lines, {
  ...base,
  mode: "dual",
  assignments: { a: "right", b: "left" },
});
assert.deepEqual(
  swap.axes.map((a) => [a.id, a.side, a.max]),
  [
    ["b", "left", 2],
    ["a", "right", 200],
  ],
);
const allRight = chart.render(lines, {
  ...base,
  mode: "dual",
  assignments: { a: "right", b: "right" },
});
assert(allRight.axes.every((a) => a.side === "right" && a.max === 200));
assert.equal(
  chart.render([{ ...lines[0], id: "__proto__" }], { ...base, mode: "dual" })
    .axes.length,
  1,
);
assert.throws(() => chart.render(lines, { ...base, timeMode: "invalid" }));
assert.throws(() =>
  chart.render(
    lines.map((l, i) => ({ ...l, unit: i ? "mg/kg" : "mg/L" })),
    base,
  ),
);
console.log(
  "PASS: shared/dual/separate scales, nice axis ranges, side assignment, elapsed time labels, escaped names and mixed-unit rejection",
);
