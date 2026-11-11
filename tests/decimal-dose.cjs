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
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8000");
  await page.waitForFunction(() => document.querySelector("#curveStart").value);
  await page.click('#nav [data-tab="medications"]');
  // Native number fields discard Japanese full-width decimal text before parsing.
  assert.equal(
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.type = "number";
      field.step = "any";
      field.value = "０．５";
      return field.value;
    }),
    "",
  );
  const presets = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("life-log-medications", 1);
          r.onsuccess = () => {
            const d = r.result,
              t = d.transaction("medications"),
              q = t.objectStore("medications").getAll();
            q.onsuccess = () => resolve(q.result);
            t.oncomplete = () => d.close();
          };
        }),
    );
  const records = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = db.transaction("records").objectStore("records").getAll();
          r.onsuccess = () => resolve(r.result);
        }),
    );
  for (const [entered, expected] of [
    ["0.25", "0.25"],
    [".5", "0.5"],
    ["０．５", "0.5"],
    ["1.125", "1.125"],
  ]) {
    await page.click("#addMedication");
    await page.fill("#m_name", "架空の小数テスト " + entered);
    await page.fill("#m_tmaxHours", "1");
    await page.fill("#m_halfLifeHours", "8");
    await page.locator("#m_doseMg").pressSequentially(entered);
    assert.equal(await page.inputValue("#m_doseMg"), entered);
    await page.click('#medicationForm [type="submit"]');
    await page.waitForFunction(
      () => !document.querySelector("#medicationEditor").open,
    );
    const preset = (await presets()).find(
      (p) => p.name === "架空の小数テスト " + entered,
    );
    assert.equal(preset.doseMg, expected);
    await page.locator('[data-med-record="' + preset.id + '"]').click();
    assert.equal(await page.inputValue("#recordDoseMg"), expected);
    await page.fill("#recordDoseMg", "0,5");
    await page.click('#recordForm [type="submit"]');
    assert.match(await page.textContent("#formError"), /カンマ/);
    assert.equal(
      (await records()).filter((r) => r.data.medicationId === preset.id).length,
      0,
    );
    await page.fill("#recordDoseMg", "");
    await page.locator("#recordDoseMg").pressSequentially(entered);
    await page.click('#recordForm [type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#editor").open);
    const record = (await records()).find(
      (r) => r.data.medicationId === preset.id,
    );
    assert.equal(record.data.doseMg, expected);
    assert.equal(record.data.dose, expected + "mg");
    await page.click('#nav [data-tab="history"]');
    await page.locator('#records [data-edit="' + record.id + '"]').click();
    assert.equal(await page.inputValue("#recordDoseMg"), expected);
    await page.keyboard.press("Escape");
    await page.click('#nav [data-tab="medications"]');
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#curveStart").value);
  assert.equal((await presets()).length, 4);
  assert.equal((await records()).length, 4);
  await browser.close();
  console.log(
    "PASS: typed fractional and full-width mg in registration and intake, canonical persistence, edit/reload, ambiguous input rejected without writes",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
