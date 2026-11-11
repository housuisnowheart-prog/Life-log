const assert = require("node:assert/strict");
const pk = require("../pk.js");
const base = {
  name: "架空薬",
  doseMg: 100,
  tmaxHours: 2,
  halfLifeHours: 8,
  bioavailability: "",
  vdLKg: "",
};
const close = (a, b, tolerance = 1e-9) =>
  assert(
    Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)),
    `${a} != ${b}`,
  );
assert.equal(pk.validateProfile(base), "");
for (const key of ["doseMg", "tmaxHours", "halfLifeHours"])
  for (const value of [0, -1, "", NaN, Infinity, true])
    assert(pk.validateProfile({ ...base, [key]: value }));
assert(pk.validateProfile({ ...base, bioavailability: 0.8 }));
assert(pk.validateProfile({ ...base, bioavailability: 1.1, vdLKg: 1 }));
assert.equal(
  pk.validateProfile({ ...base, tmaxHours: 20, halfLifeHours: 1 }),
  "",
);
assert(pk.modelError({ ...base, tmaxHours: 20, halfLifeHours: 1 }));
assert.equal(pk.number([1], 0.1, 100), false);
// Check independent analytic solution: ka=2ke => Tmax=ln2/ke = halfLife.
const ke = Math.LN2 / 8,
  rates = pk.rates(8, 8);
close(rates.ke, ke);
close(rates.ka, 2 * ke);
const profile = { ...base, tmaxHours: 8 };
const d = pk.prepareDose(profile, 0);
close(pk.valueAt([d], 8 * pk.HOUR, 50, false), 1); // peak amount = 100mg * .5 / 50kg
close(pk.valueAt([d], 0, 50, false), 0);
close(pk.valueAt([d], -pk.HOUR, 50, false), 0);
close(pk.valueAt([d], 16 * pk.HOUR, 50, false), 0.75);
close(pk.valueAt([d], 8 * pk.HOUR, 100, false), 0.5);
close(pk.valueAt([d, d], 8 * pk.HOUR, 50, false), 2);
const absolute = pk.prepareDose(
  { ...profile, bioavailability: 0.8, vdLKg: 2 },
  0,
);
close(pk.valueAt([absolute], 8 * pk.HOUR, 50, true), 0.4);
// Integral of model amount is Dose/ke; evaluate numerically independently.
let area = 0,
  step = 0.01;
for (let t = 0; t < 320; t += step)
  area += pk.valueAt([d], t * pk.HOUR, 1, false) * step;
close(area, 100 / ke, 1e-6);
for (const [tmax, half] of [
  [0.001, 10000],
  [2, 8],
  [8, 8],
  [8 / Math.LN2, 8],
  [1, 1],
  [0.5, 0.5],
]) {
  const p = { ...base, tmaxHours: tmax, halfLifeHours: half },
    dose = pk.prepareDose(p, 0);
  const peak = pk.valueAt([dose], tmax * pk.HOUR, 60, false);
  assert(Number.isFinite(peak) && peak > 0);
  assert(peak >= pk.valueAt([dose], tmax * 0.999 * pk.HOUR, 60, false) - 1e-10);
  assert(peak >= pk.valueAt([dose], tmax * 1.001 * pk.HOUR, 60, false) - 1e-10);
}
const record = (id, data, time = 1000) => ({
  id,
  type: "med",
  time: new Date(time).toISOString(),
  data: {
    ...base,
    medicationId: "med-1",
    time: new Date(time).toISOString(),
    certainty: "confirmed",
    dose: "100mg",
    ...data,
  },
});
const selection = pk.recordedDoses(
  [
    record("a", {}),
    record("b", { certainty: "unknown" }),
    record("c", { doseMg: "" }),
    record("d", {}, 3000),
    record("e", { certainty: "estimated" }),
    record("f", { medicationId: "other" }),
  ],
  "med-1",
  2000,
);
assert.equal(selection.doses.length, 2);
assert.deepEqual(selection.skipped, {
  unknown: 1,
  invalid: 1,
  future: 1,
  estimated: 1,
});
const plot = pk.series([absolute], 0, 24, 50);
assert.equal(plot.unit, "mg/L");
assert(plot.points.some((p) => p.time === 8 * pk.HOUR));
assert.equal(pk.series([d, absolute], 0, 24, 50).unit, "mg/kg");
assert.throws(() => pk.series([d], 0, 1, 50));
assert.throws(() => pk.valueAt([d], 0, 0, false));
const mismatchedTime = {
  ...record("mismatched-time", {}),
  time: new Date(500).toISOString(),
};
assert.equal(
  pk.recordedDoses([mismatchedTime], "med-1", 2000).skipped.invalid,
  1,
);
const mismatched = record("stale", { dose: "50mg", doseMg: 100 });
assert.equal(pk.recordedDoses([mismatched], "med-1", 2000).skipped.invalid, 1);
assert.equal(
  pk.recordedDoses(
    [record("decimal", { dose: ".5mg", doseMg: ".5" })],
    "med-1",
    2000,
  ).doses.length,
  1,
);
assert.throws(() => pk.series(Array(5001).fill(d), 0, 24, 50));
console.log(
  "PASS: analytic PK peak, dose/weight/F/Vd scaling, superposition, AUC, equal rates, extreme inputs, invalid parameters and record exclusions",
);

for (const [input, expected] of [
  ["0.25", "0.25"],
  [".5", "0.5"],
  ["０．５", "0.5"],
  [" １．２５ ", "1.25"],
  ["1e-3", "0.001"],
])
  assert.equal(pk.normalizeDoseInput(input), expected);
for (const input of [
  "0,5",
  "1,000",
  "0.5mg",
  "1.2.3",
  "0",
  "-1",
  "",
  "NaN",
  "Infinity",
  "0.0001",
])
  assert.throws(() => pk.normalizeDoseInput(input));

const overlaid = pk.groupSeries(
  [
    { id: "a", doses: [absolute] },
    { id: "b", doses: [d] },
  ],
  0,
  24,
  50,
);
assert.equal(overlaid.length, 2);
assert(overlaid.every((line) => line.unit === "mg/kg"));
close(overlaid[0].points.find((p) => p.time === 8 * pk.HOUR).value, 1);
close(overlaid[1].points.find((p) => p.time === 8 * pk.HOUR).value, 1);
const concentrationLines = pk.groupSeries(
  [
    { id: "a", doses: [absolute] },
    { id: "b", doses: [absolute, absolute] },
  ],
  0,
  24,
  50,
);
assert(concentrationLines.every((line) => line.unit === "mg/L"));
close(
  concentrationLines[0].points.find((p) => p.time === 8 * pk.HOUR).value,
  0.4,
);
close(
  concentrationLines[1].points.find((p) => p.time === 8 * pk.HOUR).value,
  0.8,
);
assert.throws(() => pk.groupSeries([], 0, 24, 50));
assert.throws(() => pk.groupSeries(Array(7).fill({ doses: [d] }), 0, 24, 50));

for (const hours of pk.RANGE_HOURS)
  assert.equal(pk.series([d], 0, hours, 50).end, hours * pk.HOUR);
