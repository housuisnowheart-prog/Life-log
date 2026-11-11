/* Fictional parameters, exercising presentation without clinical comparisons. */
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
    hasTouch: true,
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
  const presets = [
    {
      id: "large",
      name: "架空薬・大きい値",
      doseMg: "1000",
      tmaxHours: "1",
      halfLifeHours: "8",
      bioavailability: ".8",
      vdLKg: "2",
    },
    {
      id: "small",
      name: "架空薬・小さい値",
      doseMg: ".1",
      tmaxHours: "1",
      halfLifeHours: "8",
      bioavailability: ".8",
      vdLKg: "2",
    },
  ];
  await page.click('#nav [data-tab="medications"]');
  await page.locator(".med-backup summary").click();
  await page.setInputFiles("#importMedications", {
    name: "test.json",
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
  await page.evaluate(async (profiles) => {
    await tx("readwrite", (s) => {
      for (const p of profiles)
        s.put({
          id: p.id,
          type: "med",
          time: "2026-11-11T08:00",
          data: {
            ...p,
            medicationId: p.id,
            dose: p.doseMg + "mg",
            certainty: "confirmed",
            time: "2026-11-11T08:00",
          },
        });
      s.put({
        id: "weight",
        type: "weight",
        time: "2026-11-11T07:00",
        data: { value: "50" },
      });
    });
    await load();
  }, presets);
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = db.transaction("records").objectStore("records").getAll();
          r.onsuccess = () => resolve(r.result);
        }),
    );
  const before = await read();
  await page.locator('[data-med-chart="large"]').click();
  await page.locator('#curveOverlays input[value="small"]').check();
  const path = (id) =>
    page.locator('#curveChart path[data-series="' + id + '"]');
  const minY = async (id) =>
    path(id).evaluate((p) =>
      Math.min(
        ...[...p.getAttribute("d").matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) =>
          Number(m[1]),
        ),
      ),
    );
  const tinyShared = await minY("small");
  assert(tinyShared > 217, "Small line is nearly flat on the shared scale");
  const tableBefore = await page.textContent("#curveTable");
  await page.selectOption("#curveYAxis", "dual");
  assert(await page.locator("#curveAxisAssignments").isVisible());
  assert.equal(await path("large").getAttribute("data-axis"), "left");
  assert.equal(await path("small").getAttribute("data-axis"), "right");
  assert((await minY("small")) < 150, "Dual axis expands the small line");
  const bigMax = Number(await path("large").getAttribute("data-axis-max")),
    smallMax = Number(await path("small").getAttribute("data-axis-max"));
  assert(bigMax / smallMax > 1000);
  assert.match(
    await page.textContent("#curveAxisNote"),
    /高さは直接比較できません/,
  );
  assert.match(await page.textContent("#curveLegend"), /左軸/);
  assert.match(await page.textContent("#curveLegend"), /右軸/);
  assert.equal(await page.textContent("#curveTable"), tableBefore);
  await page.selectOption('#curveAxisChoices [data-axis-for="small"]', "left");
  assert.equal(await path("small").getAttribute("data-axis"), "left");
  assert.equal(
    await page.locator('#curveChart text[data-axis="right"]').count(),
    0,
  );
  await page.selectOption('#curveAxisChoices [data-axis-for="large"]', "right");
  assert.equal(await path("large").getAttribute("data-axis"), "right");
  assert.equal(await path("small").getAttribute("data-axis"), "left");
  assert.equal(
    Number(await path("small").getAttribute("data-axis-max")),
    smallMax,
  );
  // Horizontal unit changes affect labels only, not the model or line geometry.
  const lineBefore = await path("small").getAttribute("d");
  for (const [mode, last] of [
    ["minutes", "4320"],
    ["hours", "72"],
    ["days", "3"],
  ]) {
    await page.selectOption("#curveXAxis", mode);
    assert.equal(
      await page.locator("#curveChart .chart-time-tick").last().textContent(),
      last,
    );
    assert.equal(await path("small").getAttribute("d"), lineBefore);
    assert.match(await page.textContent("#curveAxisNote"), /表示開始から/);
  }
  await page.selectOption("#curveYAxis", "separate");
  assert.equal(await page.locator("#curveChart svg[data-plot]").count(), 2);
  assert((await minY("small")) < 120);
  assert(!(await page.locator("#curveAxisAssignments").isVisible()));
  assert.equal(await page.textContent("#curveTable"), tableBefore);
  // Tapping either chart moves every panel's time cursor and preserves exact values.
  const svg = page.locator("#curveChart svg[data-plot]").last();
  await svg.scrollIntoViewIfNeeded();
  const position = await svg.evaluate((svg) => {
    const b = svg.getBoundingClientRect(),
      ratio = b.width / Number(svg.dataset.viewWidth);
    return {
      x:
        b.x +
        (Number(svg.dataset.plotLeft) + Number(svg.dataset.plotWidth) * 0.6) *
          ratio,
      y: b.y + b.height / 2,
    };
  });
  await page.mouse.click(position.x, position.y);
  assert(Math.abs(Number(await page.inputValue("#curveCursor")) - 202) <= 1);
  const cursors = await page
    .locator("[data-chart-cursor]")
    .evaluateAll((es) => es.map((e) => e.getAttribute("x1")));
  assert.equal(new Set(cursors).size, 1);
  await page.locator(".curve-range summary").click();
  for (const hours of ["6", "12", "24", "48", "72", "168"]) {
    await page.selectOption("#curveHours", hours);
    assert.equal(
      await page.locator("#curveChart .chart-time-tick").last().textContent(),
      String(Number(hours) / 24),
    );
  }
  await page.selectOption("#curveHours", "6");
  await page.selectOption("#curveXAxis", "minutes");
  assert.equal(
    await page.locator("#curveChart .chart-time-tick").last().textContent(),
    "360",
  );
  await page.click("#curveLatestIntake");
  assert.equal(await page.inputValue("#curveStart"), "2026-11-11T06:30");
  assert((await minY("small")) < 120);
  await page.click("#curveCenterNow");
  assert.match(await page.inputValue("#curveStart"), /^2026-11-11T09:/);
  await page.click("#curveLatestIntake");
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
    for (const mode of ["shared", "dual", "separate"]) {
      await page.selectOption("#curveYAxis", mode);
      await a11y();
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${theme} ${mode} overflow ${width}`,
        );
      }
    }
  }
  assert.deepEqual(await read(), before);
  assert.equal(await page.evaluate(() => db.version), 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption("#curveYAxis", "dual");
  await page.screenshot({
    path: "/tmp/life-log-dual-axes.png",
    fullPage: true,
  });
  await page.selectOption("#curveYAxis", "separate");
  await page.screenshot({
    path: "/tmp/life-log-separate-axes.png",
    fullPage: true,
  });
  await browser.close();
  console.log(
    "PASS: scale disparity, axis assignments, unchanged model values, elapsed units, six ranges, tap inspection, synchronized panels, both-theme mobile accessibility and data preservation",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
