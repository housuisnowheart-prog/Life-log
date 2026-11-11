/* Uses synthetic records only. Start: python -m http.server 8000 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (require("node:fs").existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage(),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:8000/") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  page.on("dialog", (d) => d.accept());
  const a11y = async () => {
    await page.addScriptTag({
      url: "http://127.0.0.1:8000/node_modules/axe-core/axe.min.js",
    });
    const result = await page.evaluate(() =>
      axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    assert.deepEqual(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
  };
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = db.transaction("records").objectStore("records").getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        }),
    );
  await page.clock.install({ time: new Date("2026-11-05T12:00:00Z") });
  await page.goto("http://127.0.0.1:8000");
  await page.waitForSelector("#quick button", { state: "attached" });
  const fixtures = [
    [
      "med",
      {
        name: "テスト薬",
        dose: "1錠",
        certainty: "confirmed",
        memo: "既存メモ",
      },
    ],
    ["sleep", { start: "2026-11-04T22:00", time: "2026-11-05T06:00" }],
    ["drink", { name: "テスト", volume: "350", abv: "5" }],
    ["temp", { value: "36.5" }],
    ["weight", { value: "55" }],
    ["bleed", { status: "unknown", amount: "", pain: "", memo: "" }],
    [
      "note",
      { name: "架空の日記", memo: "一行目\n<script>悪意の文字列</script>" },
    ],
    ["schedule", { name: "架空の予定", date: "2026-11-06", status: "todo" }],
  ].map(([type, data], i) => ({
    id: "legacy-" + i,
    type,
    time: "2026-11-05T06:00",
    data: { time: "2026-11-05T06:00", ...data },
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    extra: "retain",
  }));
  await page.evaluate(async (records) => {
    await tx("readwrite", (s) => records.forEach((r) => s.put(r)));
    await load();
  }, fixtures);
  for (const theme of ["diary", "dads"]) {
    await page.click('#nav [data-tab="settings"]');
    await page.selectOption("#theme", theme);
    await page.reload();
    await page.waitForSelector("#quick button", { state: "attached" });
    assert.equal(await page.getAttribute("body", "data-theme"), theme);
    assert.deepEqual(await read(), fixtures);
    for (const tab of [
      "home",
      "history",
      "medications",
      "schedule",
      "stats",
      "settings",
    ]) {
      await page.click('#nav [data-tab="' + tab + '"]');
      await a11y();
    }
    await page.click('#nav [data-tab="history"]');
    assert.equal(await page.locator("#records .entry").count(), 8);
    await page.selectOption("#filter", "note");
    assert.equal(await page.locator("#records .entry").count(), 1);
    assert.match(await page.locator("#records").textContent(), /<script>/);
    await page.selectOption("#filter", "");
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#nav [data-tab="home"]');
    assert.equal(
      await page.locator('#nav [aria-current="page"]').getAttribute("data-tab"),
      "home",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "H2",
    );
    for (const [type, data] of [
      ["med", { name: "新規", dose: "1", certainty: "unknown" }],
      ["sleep", { start: "2026-11-04T22:00", time: "2026-11-05T06:00" }],
      ["drink", { name: "新規", volume: "100", abv: "1" }],
      ["temp", { value: "36.6" }],
      ["weight", { value: "55" }],
      ["bleed", { status: "no" }],
      ["note", { name: "日記", memo: "本文" }],
      ["schedule", { name: "予定", time: "", date: "2026-11-06" }],
    ]) {
      if (type === "schedule") {
        await page.click('#nav [data-tab="schedule"]');
        await page.click("#addSchedule");
      } else {
        await page.click('#nav [data-tab="home"]');
        if (!(await page.locator(".record-tools").evaluate((e) => e.open)))
          await page.click(".record-tools summary");
        await page.click('#quick [data-add="' + type + '"]');
      }
      if (type === "note") await a11y();
      for (const [key, value] of Object.entries(data)) {
        const el = page.locator("#f_" + key);
        if ((await el.evaluate((e) => e.tagName)) === "SELECT")
          await el.selectOption(value);
        else await el.fill(value);
      }
      await page.click('#recordForm [type="submit"]');
      await page.waitForFunction(() => !document.querySelector("#editor").open);
      const saved = (await read()).find((r) => !r.id.startsWith("legacy-"));
      assert(saved);
      assert.equal(saved.type, type);
      if (type === "med") assert.equal(saved.time, "");
      if (type === "schedule") assert.equal(saved.time, "2026-11-06T00:00");
      await page.click('#nav [data-tab="history"]');
      await page.locator('#records [data-edit="' + saved.id + '"]').click();
      await page.click("#delete");
      await page.waitForFunction(() => !document.querySelector("#editor").open);
      assert.deepEqual(await read(), fixtures);
    }
  }
  // Edit preserves metadata and unknown properties; failed writes keep the form open.
  await page.click('#records [data-edit="legacy-0"]');
  await page.fill("#f_dose", "2錠");
  await page.click('#recordForm [type="submit"]');
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  let edited = (await read())[0];
  assert.equal(edited.extra, "retain");
  assert.equal(edited.createdAt, fixtures[0].createdAt);
  assert.equal(edited.data.memo, "既存メモ");
  await page.click('#records [data-edit="legacy-0"]');
  await page.evaluate(() => {
    window.realTx = tx;
    tx = () => Promise.reject(Error("test storage failure"));
  });
  await page.click('#recordForm [type="submit"]');
  await page.waitForSelector("#formError:not(:empty)");
  assert(await page.locator("#editor").evaluate((e) => e.open));
  await page.evaluate(() => (tx = window.realTx));
  await page.keyboard.press("Escape");
  // JSON export/restore and invalid import must leave records intact.
  await page.click('#nav [data-tab="settings"]');
  const before = await read();
  const downloadPromise = page.waitForEvent("download");
  await page.click("#export");
  const download = await downloadPromise;
  const fs = require("node:fs");
  const backup = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.deepEqual(
    backup.records.sort((a, b) => a.id.localeCompare(b.id)),
    before,
  );
  await page.setInputFiles("#import", {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction(
    () => document.querySelector("#import").value === "",
  );
  assert.deepEqual(await read(), before);
  await page.setInputFiles("#import", {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"app":"life-log","version":1,"records":[null]}'),
  });
  await page.waitForFunction(
    () => document.querySelector("#import").value === "",
  );
  assert.deepEqual(await read(), before);
  // Future and unknown-time medication records do not inflate the seven-day totals.
  await page.evaluate(async () => {
    await tx("readwrite", (s) => {
      s.put({
        id: "future",
        type: "drink",
        time: "2099-01-01T00:00",
        data: { volume: "10000", abv: "100" },
      });
      s.put({
        id: "unknown",
        type: "med",
        time: new Date().toISOString(),
        data: { certainty: "unknown", name: "テスト", dose: "1" },
      });
    });
    await load();
  });
  assert.equal(
    await page
      .locator("#statistics .metric")
      .nth(1)
      .locator("strong")
      .textContent(),
    "14.0g",
  );
  await page.evaluate(async () => {
    await tx("readwrite", (s) => {
      s.delete("future");
      s.delete("unknown");
    });
    await load();
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await page.click('#nav [data-tab="home"]');
  await page.evaluate(() => applyTheme("diary"));
  await page.screenshot({ path: "/tmp/life-log-diary.png", fullPage: true });
  await context.close();
  // Real service worker caches the shell and supports offline reload.
  const offline = await browser.newContext();
  const op = await offline.newPage();
  await op.goto("http://127.0.0.1:8000");
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.evaluate(() => caches.open("another-app-v1"));
  await op.reload();
  await op.waitForSelector("#quick button");
  await offline.setOffline(true);
  await op.reload();
  await op.waitForSelector("#quick button");
  assert(
    await op.evaluate(async () =>
      (await caches.keys()).includes("another-app-v1"),
    ),
  );
  await offline.close();
  await browser.close();
  console.log(
    "PASS: both themes, 8 record types CRUD, legacy preservation, backup round-trip, storage errors, mobile reflow, focus, no external requests, offline shell",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
