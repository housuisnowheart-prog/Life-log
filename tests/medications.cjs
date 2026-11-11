/* All names, doses and parameters below are fictional test fixtures. */
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
  const readRecords = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = db.transaction("records").objectStore("records").getAll();
          r.onsuccess = () => resolve(r.result);
        }),
    );
  const readPresets = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("life-log-medications", 1);
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const d = r.result,
              t = d.transaction("medications"),
              request = t.objectStore("medications").getAll();
            request.onsuccess = () => resolve(request.result);
            t.oncomplete = () => d.close();
          };
        }),
    );
  const a11y = async () => {
    await page.addScriptTag({
      url: "http://127.0.0.1:8000/node_modules/axe-core/axe.min.js",
    });
    const violations = await page.evaluate(async () =>
      (
        await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    );
    assert.deepEqual(violations, []);
  };
  const legacy = [
    {
      id: "legacy",
      type: "med",
      time: "2026-11-11T08:00",
      data: {
        name: "従来の薬",
        dose: "1錠",
        certainty: "confirmed",
        time: "2026-11-11T08:00",
      },
      createdAt: "2026-11-01",
      extra: "preserve",
    },
    {
      id: "weight",
      type: "weight",
      time: "2026-11-10T10:00",
      data: { value: "50", time: "2026-11-10T10:00" },
    },
    {
      id: "futureWeight",
      type: "weight",
      time: "2099-11-10T10:00",
      data: { value: "90", time: "2099-11-10T10:00" },
    },
  ];
  await page.evaluate(async (data) => {
    await tx("readwrite", (s) => data.forEach((r) => s.put(r)));
    await load();
  }, legacy);
  await page.click('#nav [data-tab="medications"]');
  assert.equal(await page.inputValue("#curveWeight"), "50");
  await a11y();
  await page.click("#addMedication");
  await a11y();
  for (const [key, value] of Object.entries({
    name: "架空のお薬A <テスト>",
    doseMg: "100",
    tmaxHours: "2",
    halfLifeHours: "8",
  }))
    await page.fill("#m_" + key, value);
  // Real drugs outside this simplified model can still be registered.
  await page.fill("#m_tmaxHours", "100");
  await page.click('#medicationForm [type="submit"]');
  await page.waitForFunction(
    () => !document.querySelector("#medicationEditor").open,
  );
  assert.equal((await readPresets()).length, 1);
  await page.selectOption("#curveMode", "single");
  assert.match(await page.textContent("#curveError"), /モデル/);
  await page.click("[data-med-edit]");
  await page.fill("#m_tmaxHours", "2");
  await page.click('#medicationForm [type="submit"]');
  await page.waitForFunction(
    () => !document.querySelector("#medicationEditor").open,
  );
  const preset = (await readPresets())[0];
  assert(preset.id);
  assert.deepEqual(
    await readRecords(),
    legacy.sort((a, b) => a.id.localeCompare(b.id)),
  );
  await page.selectOption("#curveMode", "single");
  assert(await page.locator("#curveResult").isVisible());
  assert.match(
    await page.textContent("#curveDescription"),
    /mg\/kg・血中濃度ではありません/,
  );
  assert.equal(await page.locator("#curveChart svg").count(), 1);
  await a11y();
  // Accessible inspector responds to keyboard and weight change invalidates old output.
  await page.focus("#curveCursor");
  const before = await page.textContent("#curveReadout");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.textContent("#curveReadout"), before);
  const firstPeak = await page.locator("#curveSummary").textContent();
  await page.fill("#curveWeight", "100");
  assert(!(await page.locator("#curveResult").isVisible()));
  await page.click('#curveForm [type="submit"]');
  assert.notEqual(await page.locator("#curveSummary").textContent(), firstPeak);
  assert.deepEqual(
    await readRecords(),
    legacy.sort((a, b) => a.id.localeCompare(b.id)),
  );
  await page.fill("#curveWeight", "50");
  await page.click('#curveForm [type="submit"]');
  // Log a real (synthetic) intake from the card, with its own dose.
  await page.click("[data-med-record]");
  assert.equal(await page.inputValue("#f_name"), preset.name);
  assert.equal(await page.inputValue("#recordDoseMg"), "100");
  await a11y();
  await page.fill("#recordDoseMg", "50");
  await page.fill("#f_time", "2026-11-11T08:00");
  await page.click('#recordForm [type="submit"]');
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  let logged = (await readRecords()).find(
    (r) => r.data.medicationId === preset.id,
  );
  assert.equal(logged.data.dose, "50mg");
  assert.equal(logged.data.doseMg, "50");
  assert.equal(logged.data.tmaxHours, "2");
  await page.selectOption("#curveMode", "records");
  assert(await page.locator("#curveResult").isVisible());
  assert.match(await page.textContent("#curveCoverage"), /1回分/);
  // Preset edits do not retroactively change logged dose or PK data.
  await page.click("[data-med-edit]");
  await page.fill("#m_tmaxHours", "1");
  await page.fill("#m_doseMg", "200");
  await page.click("#concentrationFields summary");
  await page.fill("#m_bioavailability", "0.8");
  await page.click('#medicationForm [type="submit"]');
  assert.match(await page.textContent("#medicationError"), /両方/);
  await page.fill("#m_vdLKg", "2");
  await page.click('#medicationForm [type="submit"]');
  await page.waitForFunction(
    () => !document.querySelector("#medicationEditor").open,
  );
  assert.deepEqual(
    (await readRecords()).find((r) => r.id === logged.id),
    logged,
  );
  assert.match(await page.textContent("#curveDescription"), /mg\/kg/);
  await page.selectOption("#curveMode", "single");
  assert.match(await page.textContent("#curveDescription"), /mg\/L/);
  // A memo-only edit keeps original snapshot despite changed preset.
  await page.click('#nav [data-tab="history"]');
  await page.locator('#records [data-edit="' + logged.id + '"]').click();
  assert.equal(await page.inputValue("#recordMedication"), "@record");
  assert.equal(await page.inputValue("#recordDoseMg"), "50");
  await page.fill("#f_memo", "追記");
  await page.click('#recordForm [type="submit"]');
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  logged = (await readRecords()).find((r) => r.id === logged.id);
  assert.equal(logged.data.tmaxHours, "2");
  assert.equal(logged.data.doseMg, "50");
  // Unlinking is explicit and removes PK fields, without resurrecting prior fields.
  await page.locator('#records [data-edit="' + logged.id + '"]').click();
  await page.selectOption("#recordMedication", "");
  await page.fill("#f_dose", "1錠");
  await page.click('#recordForm [type="submit"]');
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  assert.equal(
    (await readRecords()).find((r) => r.id === logged.id).data.medicationId,
    undefined,
  );
  // Explicitly link an old free-text record; all unrelated fields survive.
  await page.locator('#records [data-edit="legacy"]').click();
  await page.selectOption("#recordMedication", preset.id);
  await page.fill("#recordDoseMg", "100");
  await page.click('#recordForm [type="submit"]');
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  const linked = (await readRecords()).find((r) => r.id === "legacy");
  assert.equal(linked.extra, "preserve");
  assert.equal(linked.data.tmaxHours, "1");
  assert.equal(linked.createdAt, "2026-11-01");
  await page.click('#nav [data-tab="medications"]');
  await page.selectOption("#curveMode", "records");
  assert.match(await page.textContent("#curveDescription"), /mg\/L/);
  // Repeat dosing and exclusions; other medicines never contribute.
  await page.evaluate(
    async ({ id, data }) => {
      await tx("readwrite", (s) => {
        for (const [suffix, change] of [
          ["repeat", { time: "2026-11-11T10:00", certainty: "estimated" }],
          ["unknown", { time: "", certainty: "unknown" }],
          ["future", { time: "2099-01-01T00:00" }],
          ["bad", { doseMg: "" }],
          ["other", { medicationId: "other" }],
        ])
          s.put({
            id: suffix,
            type: "med",
            time: change.time ?? data.time,
            data: { ...data, ...change },
          });
      });
      await load();
    },
    { id: preset.id, data: linked.data },
  );
  assert.match(await page.textContent("#curveCoverage"), /2回分/);
  assert.match(
    await page.textContent("#curveCoverage"),
    /日時不明 1件・未来 1件・条件不足 1件/,
  );
  assert.match(await page.textContent("#curveCoverage"), /推定日時 1件/);
  // Both themes, reflow, contrast, table and dialog accessibility.
  for (const theme of ["dads", "diary"]) {
    await page.click('#nav [data-tab="settings"]');
    await page.selectOption("#theme", theme);
    await page.click('#nav [data-tab="medications"]');
    await page.click('#curveForm [type="submit"]');
    await a11y();
    await page.locator("#curveResult details summary").click();
    await a11y();
    await page.locator("#curveResult details summary").click();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow at ${width}, ${theme}`,
      );
      const boxes = await page.locator("#nav button").evaluateAll((es) =>
        es.map((e) => ({
          w: e.getBoundingClientRect().width,
          h: e.getBoundingClientRect().height,
        })),
      );
      assert(boxes.every((b) => b.w >= 44 && b.h >= 44));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("[data-med-edit]");
    await a11y();
    await page.keyboard.press("Escape");
    assert(!(await page.locator("#medicationEditor").isVisible()));
  }
  // JSON preset backup and transactional rejection of malformed imports.
  await page.locator(".med-backup summary").click();
  const pending = page.waitForEvent("download");
  await page.click("#exportMedications");
  const download = await pending;
  const backup = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  const beforePresets = await readPresets(),
    beforeRecords = await readRecords();
  assert.deepEqual(backup.medications, beforePresets);
  await page.setInputFiles("#importMedications", {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction(
    () => document.querySelector("#importMedications").value === "",
  );
  assert.deepEqual(await readPresets(), beforePresets);
  assert.deepEqual(await readRecords(), beforeRecords);
  backup.medications.push({ ...preset, id: "invalid", doseMg: -1 });
  await page.setInputFiles("#importMedications", {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction(
    () => document.querySelector("#importMedications").value === "",
  );
  assert.deepEqual(await readPresets(), beforePresets);
  // A failed multi-preset import rolls back the first queued write too.
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "medications" && value.id === "fail-second")
        throw Error("synthetic write failure");
      return window.originalPut.call(this, value, ...args);
    };
  });
  await page.setInputFiles("#importMedications", {
    name: "atomic.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        app: "life-log-medications",
        version: 1,
        medications: [
          { ...preset, id: "first-write" },
          { ...preset, id: "fail-second" },
        ],
      }),
    ),
  });
  await page.waitForFunction(
    () => document.querySelector("#importMedications").value === "",
  );
  await page.evaluate(
    () => (IDBObjectStore.prototype.put = window.originalPut),
  );
  assert.deepEqual(await readPresets(), beforePresets);
  // Original record transactions also reject an abort without partially writing.
  assert.equal(
    await page.evaluate(async () => {
      try {
        await tx("readwrite", (s) => {
          s.put({
            id: "aborted",
            type: "note",
            time: "",
            data: { name: "not saved" },
          });
          s.transaction.abort();
        });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.deepEqual(await readRecords(), beforeRecords);
  // Storage write failure must not close editor or falsely report success.
  await page.route("**/*", (route) => route.continue());
  await page.click("[data-med-edit]");
  await page.fill("#m_name", "保存失敗のテスト");
  await page.evaluate(() => {
    window.savedTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === "life-log-medications" && args[1] === "readwrite")
        throw new DOMException("test", "QuotaExceededError");
      return window.savedTransaction.apply(this, args);
    };
  });
  await page.click('#medicationForm [type="submit"]');
  assert.match(await page.textContent("#medicationError"), /保存できません/);
  assert.equal(await page.inputValue("#m_name"), "保存失敗のテスト");
  await page.evaluate(
    () => (IDBDatabase.prototype.transaction = window.savedTransaction),
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(await readPresets(), beforePresets);
  // Deleting a preset leaves logs and chart conditions usable through history.
  await page.click("[data-med-edit]");
  await page.click("#deleteMedication");
  await page.waitForFunction(
    () => !document.querySelector("#medicationEditor").open,
  );
  assert.equal((await readPresets()).length, 0);
  assert.deepEqual(await readRecords(), beforeRecords);
  assert.match(await page.textContent("#curveMedication"), /記録時の登録/);
  await page.selectOption("#curveMedication", preset.id);
  await page.selectOption("#curveMode", "records");
  assert(await page.locator("#curveResult").isVisible());
  // Restore and reload: both databases and original DB version remain intact.
  backup.medications = beforePresets;
  await page.setInputFiles("#importMedications", {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction(
    () => document.querySelector("#importMedications").value === "",
  );
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#curveStart").value);
  await page.click('#nav [data-tab="medications"]');
  assert.equal((await readPresets()).length, 1);
  assert.deepEqual(await readRecords(), beforeRecords);
  assert.equal(await page.evaluate(() => db.version), 1);
  await page.click('#curveForm [type="submit"]');
  await page.evaluate(() =>
    document.querySelector("#toast").classList.remove("show"),
  );
  await page.screenshot({
    path: "/tmp/life-log-medications.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  // New flat PK fields round-trip through the original JSON v1 record format.
  await page.click('#nav [data-tab="settings"]');
  const recordDownload = page.waitForEvent("download");
  await page.click("#export");
  const recordFile = await recordDownload,
    recordBackup = JSON.parse(fs.readFileSync(await recordFile.path(), "utf8"));
  assert.equal(recordBackup.version, 1);
  await page.setInputFiles("#import", {
    name: "records.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recordBackup)),
  });
  await page.waitForFunction(
    () => document.querySelector("#import").value === "",
  );
  assert.deepEqual(await readRecords(), beforeRecords);
  assert.deepEqual(await readPresets(), beforePresets);
  // Failure of the new DB does not prevent legacy free-text recording.
  const denied = await browser.newContext({ serviceWorkers: "block" }),
    dp = await denied.newPage();
  await dp.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => {
      if (name === "life-log-medications")
        throw new DOMException("test", "SecurityError");
      return open(name, ...args);
    };
  });
  await dp.goto("http://127.0.0.1:8000");
  await dp.waitForSelector("#medicationStorageError:not(:empty)", {
    state: "attached",
  });
  await dp.click('#quick [data-add="med"]');
  await dp.fill("#f_name", "旧記録のテスト");
  await dp.fill("#f_dose", "1錠");
  await dp.selectOption("#f_certainty", "unknown");
  await dp.click('#recordForm [type="submit"]');
  await dp.waitForFunction(() => !document.querySelector("#editor").open);
  assert.match(await dp.textContent("#recent"), /旧記録のテスト/);
  await denied.close();
  // Offline shell includes both new scripts and can compute a preview locally.
  const offline = await browser.newContext(),
    op = await offline.newPage(),
    offlineErrors = [];
  op.on("pageerror", (error) => offlineErrors.push(error.message));
  await op.goto("http://127.0.0.1:8000");
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.reload();
  await op.waitForFunction(() => document.querySelector("#curveStart").value);
  await op.click('#nav [data-tab="medications"]');
  await op.click("#addMedication");
  for (const [key, value] of Object.entries({
    name: "オフライン架空薬",
    doseMg: "10",
    tmaxHours: "1",
    halfLifeHours: "8",
  }))
    await op.fill("#m_" + key, value);
  await op.click('#medicationForm [type="submit"]');
  await op.waitForFunction(
    () => !document.querySelector("#medicationEditor").open,
  );
  await offline.setOffline(true);
  await op.reload();
  await op.waitForFunction(() => document.querySelector("#curveStart").value);
  await op.click('#nav [data-tab="medications"]');
  await op.waitForSelector(".medicine-card");
  await op.fill("#curveWeight", "60");
  await op.selectOption("#curveMode", "single");
  await op.click('#curveForm [type="submit"]');
  assert(await op.locator("#curveChart svg").isVisible());
  assert.deepEqual(offlineErrors, []);
  await offline.close();
  await context.close();
  await browser.close();
  console.log(
    "PASS: medication CRUD, snapshot isolation, explicit legacy linking, F/Vd modes, repeated doses, exclusion counts, weight, preset backups, storage failures, deletion preservation, both-theme accessibility and mobile reflow",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
