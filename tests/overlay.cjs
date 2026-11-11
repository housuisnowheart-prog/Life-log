/* Synthetic medicines only; these parameters are not prescribing examples. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Tokyo",
    serviceWorkers: "block",
  });
  const page = await context.newPage(),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:8000/") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.clock.install({ time: new Date("2026-11-11T03:00:00Z") });
  await page.goto("http://127.0.0.1:8000");
  await page.waitForFunction(() => document.querySelector("#curveStart").value);
  const presets = Array.from("abcdefgh", (id, i) => ({
    id,
    name: `架空薬${id.toUpperCase()}${id === "f" ? "・長い名前の表示確認用テスト" : ""}`,
    doseMg: id === "b" ? "50" : "100",
    tmaxHours: id === "h" ? "100" : "1",
    halfLifeHours: "8",
    bioavailability: id === "c" ? "" : "0.8",
    vdLKg: id === "c" ? "" : "2",
  }));
  await page.click('#nav [data-tab="medications"]');
  await page.locator(".med-backup summary").click();
  await page.setInputFiles("#importMedications", {
    name: "medicines.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        app: "life-log-medications",
        version: 1,
        medications: presets,
      }),
    ),
  });
  await page.waitForFunction(
    () => document.querySelector("#importMedications").value === "",
  );
  const logs = presets
    .filter((p) => p.id !== "g")
    .map((p) => ({
      id: "log-" + p.id,
      type: "med",
      time: "2026-11-11T08:00",
      data: {
        ...p,
        medicationId: p.id,
        dose: p.doseMg + "mg",
        certainty: "confirmed",
        time: "2026-11-11T08:00",
      },
    }));
  logs.push({
    id: "weight",
    type: "weight",
    time: "2026-11-11T07:00",
    data: { value: "50" },
  });
  await page.evaluate(async (logs) => {
    await tx("readwrite", (s) => logs.forEach((r) => s.put(r)));
    await load();
  }, logs);
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = db.transaction("records").objectStore("records").getAll();
          r.onsuccess = () => resolve(r.result);
        }),
    );
  const before = await read();
  // Card routes to analysis; the graph exists only there.
  await page.locator('[data-med-chart="a"]').click();
  assert.equal(
    await page.locator('#nav [aria-current="page"]').getAttribute("data-tab"),
    "stats",
  );
  assert(await page.locator("#stats #curveResult").isVisible());
  assert.equal(await page.locator("#medications #curveForm").count(), 0);
  const check = (id) =>
    page.locator('#curveOverlays input[value="' + id + '"]');
  await check("b").check();
  assert.equal(await page.locator("#curveChart path[data-series]").count(), 2);
  assert.equal(await page.locator("#curveLegend li").count(), 2);
  assert.match(await page.textContent("#curveDescription"), /mg\/L/);
  const layout = await page.evaluate(() => ({
    graphBottom: document.querySelector("#curveChart").getBoundingClientRect()
      .bottom,
    controlsTop: document.querySelector("#curveForm").getBoundingClientRect()
      .top,
  }));
  assert(
    layout.graphBottom <= layout.controlsTop,
    "Graph must precede controls",
  );
  assert.equal(
    await page.locator("#stats .panel").first().getAttribute("class"),
    "panel model-panel",
  );
  // A and B have identical kinetic shape but B has half the dose. Verify one shared y scale.
  const minima = await page
    .locator("#curveChart path[data-series]")
    .evaluateAll((paths) =>
      paths.map((path) =>
        Math.min(
          ...[...path.getAttribute("d").matchAll(/[ML][\d.]+,([\d.]+)/g)].map(
            (m) => Number(m[1]),
          ),
        ),
      ),
    );
  assert(
    Math.abs(minima[1] - (218 + minima[0]) / 2) < 0.02,
    JSON.stringify(minima),
  );
  await check("c").check();
  assert.equal(await page.locator("#curveChart path[data-series]").count(), 3);
  assert.match(await page.textContent("#curveDescription"), /全ての線でF＝1/);
  assert((await page.locator("#curveLegend").textContent()).includes("mg/kg"));
  assert(!(await page.locator("#curveLegend").textContent()).includes("mg/L"));
  await page.focus("#curveCursor");
  await page.keyboard.press("ArrowRight");
  for (const id of ["A", "B", "C"])
    assert.match(
      await page.textContent("#curveReadout"),
      new RegExp("架空薬" + id),
    );
  assert.equal(await page.locator("#curveTable thead th").count(), 4);
  // A selected drug with no usable data gets a notice, not a fabricated zero line.
  await check("g").check();
  assert.equal(await page.locator("#curveChart path[data-series]").count(), 3);
  assert.match(
    await page.textContent("#curveWarnings"),
    /架空薬G.*計算できる服薬記録がありません/,
  );
  await check("g").uncheck();
  await check("h").check();
  assert.equal(await page.locator("#curveChart path[data-series]").count(), 3);
  assert.match(await page.textContent("#curveWarnings"), /架空薬H/);
  await check("h").uncheck();
  for (const id of ["d", "e", "f"]) await check(id).check();
  assert.equal(await page.locator("#curveChart path[data-series]").count(), 6);
  await check("g").click();
  assert.equal(await check("g").isChecked(), false);
  assert.match(await page.textContent("#curveError"), /6種類/);
  assert.equal(
    new Set(
      await page
        .locator("#curveChart path[data-series]")
        .evaluateAll((paths) => paths.map((p) => getComputedStyle(p).stroke)),
    ).size,
    6,
  );
  const a11y = async () => {
    await page.addScriptTag({
      url: "http://127.0.0.1:8000/node_modules/axe-core/axe.min.js",
    });
    assert.deepEqual(
      await page.evaluate(async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
      [],
    );
  };
  for (const theme of ["dads", "diary"]) {
    await page.click('#nav [data-tab="settings"]');
    await page.selectOption("#theme", theme);
    await page.click('#nav [data-tab="stats"]');
    await page.click('#curveForm [type="submit"]');
    await a11y();
    await page.locator("#curveResult details summary").click();
    await a11y();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow ${width} ${theme}`,
      );
    }
    await page.locator("#curveResult details summary").click();
  }
  // Removing the only missing-F line restores mg/L for every remaining series.
  await check("c").uncheck();
  assert((await page.locator("#curveLegend").textContent()).includes("mg/L"));
  assert(!(await page.locator("#curveLegend").textContent()).includes("mg/kg"));
  // Changing primary excludes duplicate lines and keeps the other checked drugs.
  await page.selectOption("#curveMedication", "b");
  const ids = await page
    .locator("#curveChart path[data-series]")
    .evaluateAll((paths) => paths.map((p) => p.dataset.series));
  assert.equal(ids.length, new Set(ids).size);
  assert(ids.includes("b"));
  assert.equal(
    await page.locator('#curveOverlays input[value="b"]').count(),
    0,
  );
  assert.deepEqual(await read(), before);
  assert.equal(await page.evaluate(() => db.version), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/life-log-overlay.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await browser.close();
  console.log(
    "PASS: shared-axis independent series, mixed-parameter unit consistency, legend/slider/table, missing data, six-line limit, analysis routing, data preservation, both-theme accessibility and mobile reflow",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
