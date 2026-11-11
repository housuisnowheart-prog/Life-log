/* Medication presets live in a separate DB, leaving life-log v1 untouched. */
const MedicationUI = (() => {
  "use strict";
  let database,
    library = [],
    records = [],
    api,
    editingPreset = null,
    recordSnapshot = null;
  let weightManual = false,
    chartState = null,
    ready = false,
    libraryReady = false,
    savingPreset = false;
  const q = (selector) => document.querySelector(selector);
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const profileKeys = [
    "doseMg",
    "tmaxHours",
    "halfLifeHours",
    "bioavailability",
    "vdLKg",
  ];
  const localDate = (time) => {
    const d = new Date(time);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const dateLabel = (time) =>
    new Date(time).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const valueLabel = (value) =>
    value === 0
      ? "0"
      : value < 0.001 || value >= 10000
        ? value.toExponential(2)
        : Number(value.toPrecision(4)).toString();
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("life-log-medications", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("medications", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        (q("#medicationStorageError").textContent =
          "登録薬の保存領域が使用中です。他のタブを閉じて再度お試しください。");
    });
  }
  function write(fn) {
    return new Promise((resolve, reject) => {
      const t = database.transaction("medications", "readwrite");
      t.oncomplete = resolve;
      t.onerror = t.onabort = () =>
        reject(t.error || Error("Transaction aborted"));
      try {
        fn(t.objectStore("medications"));
      } catch (error) {
        t.abort();
        reject(error);
      }
    });
  }
  async function read() {
    library = await new Promise((resolve, reject) => {
      const r = database
        .transaction("medications")
        .objectStore("medications")
        .getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    library.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    storageError("");
    renderLibrary();
  }
  function profiles() {
    const result = [...library],
      seen = new Set(library.map((p) => p.id));
    for (const r of records) {
      if (
        r.type !== "med" ||
        !r.data.medicationId ||
        seen.has(r.data.medicationId) ||
        PK.validateProfile(r.data)
      )
        continue;
      result.push({ ...r.data, id: r.data.medicationId, historyOnly: true });
      seen.add(r.data.medicationId);
    }
    return result;
  }
  function renderLibrary() {
    if (!ready) return;
    q("#medicationList").innerHTML = library.length
      ? library
          .map(
            (p) =>
              `<article class="medicine-card"><div class="medicine-card-head"><span class="medicine-symbol" aria-hidden="true">💊</span><div><h3>${escape(p.name)}</h3><p class="medicine-dose">${escape(p.doseMg)} <span>mg / 回</span></p></div></div><dl class="medicine-facts"><div><dt>T-max</dt><dd>${escape(p.tmaxHours)} 時間</dd></div><div><dt>消失半減期</dt><dd>${escape(p.halfLifeHours)} 時間</dd></div></dl>${PK.modelError(p) ? '<p class="hint model-warning">この条件では参考グラフを計算できません。登録と服薬記録は利用できます。</p>' : ""}${p.source ? `<p class="hint medicine-source">${escape(p.source)}</p>` : ""}<div class="medicine-actions"><button class="primary" data-med-record="${escape(p.id)}" aria-label="${escape(p.name)}の服薬を記録">服薬を記録</button><button data-med-chart="${escape(p.id)}" aria-label="${escape(p.name)}の推移を見る">推移</button><button data-med-edit="${escape(p.id)}" aria-label="${escape(p.name)}の登録を編集">編集</button></div></article>`,
          )
          .join("")
      : '<div class="medicine-empty"><span aria-hidden="true">＋</span><h3>いつもの薬を、ここに。</h3><p>名前・1回量・T-max・半減期を登録すると、服薬記録への入力を省けます。</p><button data-med-new class="primary">最初の薬を登録する</button></div>';
    const selected = q("#curveMedication").value,
      available = profiles();
    q("#curveMedication").innerHTML =
      '<option value="">薬を選択してください</option>' +
      available
        .map(
          (p) =>
            `<option value="${escape(p.id)}">${escape(p.name)}${p.historyOnly ? "（記録時の登録）" : ""}</option>`,
        )
        .join("");
    if (available.some((p) => p.id === selected))
      q("#curveMedication").value = selected;
    else if (available.length) q("#curveMedication").value = available[0].id;
  }
  function editPreset(p = null) {
    if (!libraryReady) return;
    editingPreset = p;
    q("#medicationForm").reset();
    for (const key of ["name", ...profileKeys, "source"])
      q("#m_" + key).value = p?.[key] ?? "";
    q("#medicationTitle").textContent = p ? "登録薬を編集" : "薬を登録";
    q("#deleteMedication").hidden = !p;
    q("#medicationError").textContent = "";
    q("#concentrationFields").open = Boolean(p?.bioavailability);
    q("#medicationEditor").showModal();
  }
  function storageError(message) {
    q("#medicationStorageError").textContent = message;
  }
  async function savePreset(event) {
    event.preventDefault();
    if (savingPreset) return;
    const d = Object.fromEntries(new FormData(event.target));
    d.name = d.name.trim();
    try {
      d.doseMg = PK.normalizeDoseInput(d.doseMg);
    } catch (error) {
      q("#medicationError").textContent = error.message;
      return;
    }
    const error = PK.validateProfile(d);
    if (error) {
      q("#medicationError").textContent = error;
      return;
    }
    const record = {
      ...editingPreset,
      ...d,
      id: editingPreset?.id || crypto.randomUUID(),
      createdAt: editingPreset?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savingPreset = true;
    try {
      await write((s) => s.put(record));
      await read();
      q("#medicationEditor").close();
      updateCurve();
      api.notify("薬を登録しました");
    } catch {
      q("#medicationError").textContent =
        "登録薬を保存できませんでした。入力内容は残っています。再度お試しください。";
    } finally {
      savingPreset = false;
    }
  }
  function selectedRecordProfile() {
    const selected = q("#recordMedication")?.value;
    return selected === "@record"
      ? recordSnapshot
      : library.find((p) => p.id === selected);
  }
  function applyRecordProfile() {
    const p = selectedRecordProfile(),
      linked = Boolean(p);
    q("#f_name").readOnly = linked;
    q("#f_dose").required = !linked;
    q("#f_dose").closest(".field").hidden = linked;
    q("#recordDoseField").hidden = !linked;
    q("#recordDoseMg").required = linked;
    if (linked) {
      q("#f_name").value = p.name;
      q("#recordDoseMg").value = p.doseMg;
    }
    q("#recordParameters").textContent = linked
      ? `記録に保存する条件：T-max ${p.tmaxHours}時間 / 消失半減期 ${p.halfLifeHours}時間${p.bioavailability ? ` / F ${p.bioavailability} / 分布容積 ${p.vdLKg} L/kg` : ""}。1回量は今回の量に変更できます。`
      : "自由入力の服薬はこれまでどおり保存できます。グラフに連携する場合は登録薬を選択してください。";
  }
  function decorateEditor(type, record) {
    if (type !== "med" || !ready) return;
    recordSnapshot =
      record?.data?.medicationId && !PK.validateProfile(record.data)
        ? { ...record.data, id: record.data.medicationId }
        : null;
    const intro = document.createElement("div");
    intro.innerHTML = `<div class="field"><label for="recordMedication">登録薬から入力</label><select id="recordMedication"><option value="">自由入力（グラフと連携しない）</option>${recordSnapshot ? '<option value="@record">記録時の登録薬（元の条件を維持）</option>' : ""}${library.map((p) => `<option value="${escape(p.id)}">${escape(p.name)} / ${escape(p.doseMg)} mg</option>`).join("")}</select></div><p class="hint" id="recordParameters"></p>`;
    q("#fields").prepend(intro);
    const dose = document.createElement("div");
    dose.className = "field";
    dose.id = "recordDoseField";
    dose.hidden = true;
    dose.innerHTML =
      '<label for="recordDoseMg">今回の服用量（mg・必須）</label><input id="recordDoseMg" type="text" inputmode="decimal" maxlength="32" autocomplete="off" spellcheck="false" aria-describedby="recordDoseHint"><p id="recordDoseHint" class="hint">小数も入力できます（例：0.25）。全角数字・全角小数点にも対応しています。</p>';
    q("#f_dose").closest(".field").after(dose);
    q("#recordMedication").onchange = applyRecordProfile;
    if (recordSnapshot) q("#recordMedication").value = "@record";
    applyRecordProfile();
  }
  function recordData(data) {
    if (!ready) return data;
    const result = { ...data },
      p = selectedRecordProfile();
    if (!p) {
      for (const key of ["medicationId", ...profileKeys, "pkSource"])
        delete result[key];
      return result;
    }
    const doseMg = PK.normalizeDoseInput(q("#recordDoseMg").value);
    const error = PK.validateProfile({ ...p, doseMg });
    if (error) throw Error(error);
    for (const key of profileKeys) result[key] = p[key] ?? "";
    return {
      ...result,
      name: p.name,
      doseMg,
      dose: `${doseMg}mg`,
      medicationId: p.id,
      pkSource: p.source ?? p.pkSource ?? "",
    };
  }
  function updateWeight() {
    if (weightManual) return;
    const latest = records
      .filter(
        (r) =>
          r.type === "weight" &&
          Number.isFinite(Date.parse(r.time)) &&
          Date.parse(r.time) <= Date.now() &&
          PK.number(r.data.value, 0.1, 1000),
      )
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    q("#curveWeight").value = latest?.data.value ?? "";
    q("#weightSource").textContent = latest
      ? `${dateLabel(Date.parse(latest.time))}の体重記録から。変更しても記録は書き換えません。`
      : "体重記録がありません。計算用の体重を入力してください（保存しません）。";
  }
  function updateCurve() {
    if (!ready) return;
    const p = profiles().find((p) => p.id === q("#curveMedication").value);
    const weight = q("#curveWeight").value,
      start = Date.parse(q("#curveStart").value),
      hours = Number(q("#curveHours").value);
    chartState = null;
    q("#curveResult").hidden = true;
    if (!p) {
      q("#curveError").textContent = "登録薬を選択すると推移を表示できます。";
      return;
    }
    if (!PK.number(weight, 0.1, 1000)) {
      q("#curveError").textContent =
        "計算用の体重を0.1〜1000 kgで入力してください。";
      return;
    }
    if (!Number.isFinite(start) || ![24, 72, 168].includes(hours)) {
      q("#curveError").textContent =
        "表示開始日時と表示期間を確認してください。";
      return;
    }
    const preview = q("#curveMode").value === "single";
    let doses,
      skipped = { unknown: 0, invalid: 0, future: 0, estimated: 0 };
    if (preview) doses = [PK.prepareDose(p, start)].filter(Boolean);
    else ({ doses, skipped } = PK.recordedDoses(records, p.id));
    const omitted = `日時不明 ${skipped.unknown}件・未来 ${skipped.future}件・条件不足 ${skipped.invalid}件を除外。推定日時 ${skipped.estimated}件を含みます。`;
    if (doses.length > 5000) {
      q("#curveError").textContent =
        "計算対象が5000回を超えるためグラフを表示できません。記録はすべて保持されています。";
      return;
    }
    if (!doses.length) {
      q("#curveError").textContent = preview
        ? PK.modelError(p) || "登録値ではこのモデルを計算できません。"
        : "計算できる服薬記録がありません。登録薬を選んで服薬を記録するか、「登録量1回のモデル」を選んでください。" +
          omitted;
      return;
    }
    try {
      const model = PK.series(doses, start, hours, Number(weight));
      chartState = { ...model, doses, weight: Number(weight), name: p.name };
      q("#curveError").textContent = "";
      q("#curveResult").hidden = false;
      q("#curveDescription").textContent =
        `${p.name} / ${preview ? "登録量1回（服薬記録には保存されません）" : "記録時の条件による重ね合わせ"} / 体重 ${weight} kgを全期間で使用。${model.absolute ? "縦軸：モデル血中濃度（mg/L・実測ではありません）" : "縦軸：モデル内薬物量 ÷ 体重（mg/kg・血中濃度ではありません、F＝1を仮定）"}`;
      const peak = model.points.reduce((a, b) => (b.value > a.value ? b : a));
      q("#curveSummary").textContent =
        `表示範囲の標本点での最大：${valueLabel(peak.value)} ${model.unit}（${dateLabel(peak.time)}）。グラフは連続モデルの標本表示です。`;
      q("#curveCoverage").textContent = preview
        ? "表示開始日時に登録量を1回服用した仮想モデルです。服薬の提案ではありません。"
        : `${doses.length}回分の同じ登録薬の記録を使用（表示開始以前の記録も含む）。${omitted}未連携の自由入力記録や未記録の服薬は含みません。`;
      q("#curveCursor").value = "0";
      drawChart();
      inspect();
      const rows = [];
      for (let t = start; t <= model.end; t += 3 * PK.HOUR)
        rows.push(
          `<tr><th scope="row">${escape(dateLabel(t))}</th><td>${valueLabel(PK.valueAt(doses, t, Number(weight), model.absolute))}</td></tr>`,
        );
      q("#curveTable").innerHTML =
        `<caption>${escape(p.name)}：参考モデルの数値</caption><thead><tr><th scope="col">日時</th><th scope="col">${model.absolute ? "モデル濃度" : "モデル内薬物量 / 体重"}（${model.unit}）</th></tr></thead><tbody>${rows.join("")}</tbody>`;
    } catch {
      q("#curveResult").hidden = true;
      q("#curveError").textContent =
        "この条件では計算できません。登録値を確認してください。";
    }
  }
  function drawChart() {
    if (!chartState) return;
    const { points, start, end, unit } = chartState;
    const width = Math.max(
        240,
        Math.round(q("#curveChart").clientWidth) || 340,
      ),
      height = 270,
      left = 58,
      right = 16,
      top = 30,
      bottom = 52;
    const plotW = width - left - right,
      plotH = height - top - bottom,
      max = Math.max(...points.map((p) => p.value)) * 1.12 || 1;
    const x = (t) => left + ((t - start) / (end - start)) * plotW,
      y = (v) => top + (1 - v / max) * plotH;
    const line = points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`,
      )
      .join(" ");
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4;
      grid += `<line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" class="chart-grid"/><text x="${left - 7}" y="${y(v) + 4}" text-anchor="end">${escape(valueLabel(v))}</text>`;
    }
    for (let i = 0; i <= 3; i++) {
      const t = start + ((end - start) * i) / 3,
        d = new Date(t);
      grid += `<text x="${x(t)}" y="${height - 29}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${d.getMonth() + 1}/${d.getDate()}</text><text x="${x(t)}" y="${height - 12}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</text>`;
    }
    const now = Date.now();
    const nowMark =
      now >= start && now <= end
        ? `<line x1="${x(now)}" y1="${top}" x2="${x(now)}" y2="${height - bottom}" class="chart-now"/><text x="${x(now)}" y="18" text-anchor="middle">現在</text>`
        : "";
    q("#curveChart").innerHTML =
      `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="curveSvgTitle curveSvgDesc"><title id="curveSvgTitle">${escape(chartState.name)}の参考推移（${unit}）</title><desc id="curveSvgDesc">${escape(q("#curveDescription").textContent)}。下の時刻スライダーと数値一覧でも確認できます。</desc><text x="0" y="18">${unit}</text>${grid}${nowMark}<path d="${line} L${x(end)},${height - bottom} L${left},${height - bottom} Z" class="chart-area"/><path d="${line}" class="chart-line"/><line id="chartCursorLine" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" class="chart-cursor"/></svg>`;
    chartState.plot = { left, plotW };
  }
  function inspect() {
    if (!chartState) return;
    const index = Number(q("#curveCursor").value),
      time =
        chartState.start + ((chartState.end - chartState.start) * index) / 336;
    const label = `${dateLabel(time)}：${valueLabel(PK.valueAt(chartState.doses, time, chartState.weight, chartState.absolute))} ${chartState.unit}`;
    q("#curveReadout").textContent = label;
    q("#curveCursor").setAttribute("aria-valuetext", label);
    const line = q("#chartCursorLine");
    if (line) {
      const x = chartState.plot.left + (chartState.plot.plotW * index) / 336;
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
    }
  }
  function refresh(newRecords) {
    records = newRecords;
    if (ready) {
      renderLibrary();
      updateWeight();
      updateCurve();
    }
  }
  function validBackup(raw) {
    return (
      raw?.app === "life-log-medications" &&
      raw.version === 1 &&
      Array.isArray(raw.medications) &&
      raw.medications.length <= 10000 &&
      new Set(raw.medications.map((p) => p?.id)).size ===
        raw.medications.length &&
      raw.medications.every(
        (p) =>
          p &&
          typeof p.id === "string" &&
          p.id.length > 0 &&
          p.id.length <= 200 &&
          !PK.validateProfile(p),
      )
    );
  }
  async function init(options) {
    api = options;
    records = options.getRecords();
    ready = true;
    q("#curveStart").value = localDate(Date.now() - 24 * PK.HOUR);
    q("#addMedication").onclick = () => editPreset();
    q("#closeMedication").onclick = () => q("#medicationEditor").close();
    q("#medicationForm").onsubmit = savePreset;
    q("#deleteMedication").onclick = async () => {
      if (
        !editingPreset ||
        !confirm(
          "この薬の登録を削除しますか？過去の服薬記録と記録時の計算条件は残ります。",
        )
      )
        return;
      try {
        await write((s) => s.delete(editingPreset.id));
        await read();
        q("#medicationEditor").close();
        updateCurve();
        api.notify("薬の登録を削除しました");
      } catch {
        q("#medicationError").textContent =
          "削除できませんでした。再度お試しください。";
      }
    };
    document.body.addEventListener("click", (event) => {
      const el = event.target.closest(
        "[data-med-edit],[data-med-record],[data-med-chart],[data-med-new]",
      );
      if (!el) return;
      if (el.hasAttribute("data-med-new")) return editPreset();
      if (el.dataset.medEdit)
        return editPreset(library.find((p) => p.id === el.dataset.medEdit));
      if (el.dataset.medRecord) {
        api.editor("med");
        q("#recordMedication").value = el.dataset.medRecord;
        applyRecordProfile();
        q("#recordDoseMg").focus();
      }
      if (el.dataset.medChart) {
        q("#curveMedication").value = el.dataset.medChart;
        updateCurve();
        q("#modelTitle").setAttribute("tabindex", "-1");
        q("#modelTitle").focus();
      }
    });
    q("#curveForm").onsubmit = (event) => {
      event.preventDefault();
      updateCurve();
    };
    for (const id of ["curveMedication", "curveMode", "curveHours"])
      q("#" + id).onchange = updateCurve;
    q("#curveWeight").oninput = () => {
      weightManual = true;
      q("#weightSource").textContent =
        "手入力の計算用体重です。体重記録は変更しません。";
      q("#curveResult").hidden = true;
      chartState = null;
      q("#curveError").textContent =
        "体重を変更しました。「グラフを更新」で再計算してください。";
    };
    q("#curveStart").oninput = () => {
      q("#curveResult").hidden = true;
      chartState = null;
      q("#curveError").textContent =
        "開始日時を変更しました。「グラフを更新」で再計算してください。";
    };
    q("#curveCursor").oninput = inspect;
    if (typeof ResizeObserver !== "undefined")
      new ResizeObserver(() => {
        if (chartState && !q("#curveResult").hidden) {
          drawChart();
          inspect();
        }
      }).observe(q("#curveChart"));
    q("#exportMedications").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                app: "life-log-medications",
                version: 1,
                medications: library,
                exportedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      a.download =
        "life-log-medications-" +
        new Date().toISOString().slice(0, 10) +
        ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    };
    q("#importMedications").onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        if (!validBackup(raw)) throw Error("形式が不正です");
        if (
          !confirm(
            `${raw.medications.length}件の登録薬を統合しますか？同じIDはバックアップの内容で上書きします。服薬記録は変更しません。`,
          )
        )
          return;
        await write((s) => raw.medications.forEach((p) => s.put(p)));
        await read();
        updateCurve();
        api.notify("登録薬を復元しました");
      } catch {
        storageError(
          "登録薬を復元できませんでした。ファイル形式と保存領域を確認してください。",
        );
      } finally {
        event.target.value = "";
      }
    };
    try {
      database = await openDatabase();
      await read();
      libraryReady = true;
      database.onversionchange = () => {
        database.close();
        libraryReady = false;
        storageError(
          "登録薬の保存領域が更新されました。画面を再読み込みしてください。",
        );
      };
    } catch {
      storageError(
        "登録薬の保存領域を開けません。生活記録は引き続き使えます。画面を再読み込みして再度お試しください。",
      );
      q("#addMedication").disabled = true;
      q("#exportMedications").disabled = true;
      q("#importMedications").disabled = true;
    }
    updateWeight();
    renderLibrary();
    updateCurve();
  }
  return { init, refresh, decorateEditor, recordData };
})();
