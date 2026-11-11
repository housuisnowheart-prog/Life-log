"use strict";
const TYPES = {
  med: ["服薬", "💊"],
  sleep: ["睡眠", "🌙"],
  drink: ["飲酒", "🥛"],
  temp: ["体温", "🌡"],
  weight: ["体重", "⚖"],
  bleed: ["不正出血", "✳"],
  note: ["日記・体調メモ", "✎"],
  schedule: ["予定", "▦"],
};
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  nowLocal = () => {
    let d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  },
  fmt = (s) => (s ? new Date(s).toLocaleString("ja-JP") : "日時未指定");
const fields = {
  med: [
    ["name", "薬剤名", "text", 1],
    ["dose", "服用量（例：20mg）", "text", 1],
    ["time", "服薬日時", "datetime-local"],
    [
      "certainty",
      "時刻の確実性",
      "select",
      "confirmed|確認した;estimated|推定;unknown|不明",
    ],
    ["memo", "メモ", "textarea"],
  ],
  sleep: [
    ["start", "寝始めた日時", "datetime-local", 1],
    ["time", "起きた日時", "datetime-local", 1],
    ["memo", "メモ", "textarea"],
  ],
  drink: [
    ["name", "飲み物", "text", 1],
    ["volume", "容量（mL）", "number", 1],
    ["abv", "度数（%）", "number", 1],
    ["time", "飲酒日時", "datetime-local", 1],
    ["memo", "メモ", "textarea"],
  ],
  temp: [
    ["value", "体温（℃）", "number", 1],
    ["time", "測定日時", "datetime-local", 1],
  ],
  weight: [
    ["value", "体重（kg）", "number", 1],
    ["time", "測定日時", "datetime-local", 1],
  ],
  bleed: [
    ["status", "不正出血", "select", "yes|あり;no|なし;unknown|不明"],
    [
      "amount",
      "出血量",
      "select",
      "|未選択;small|少量;medium|中程度;large|多量",
    ],
    ["pain", "痛み・症状", "textarea"],
    ["time", "確認日時", "datetime-local", 1],
    ["memo", "メモ", "textarea"],
  ],
  note: [
    ["name", "日記のタイトル・体調", "text", 1],
    ["time", "日時", "datetime-local", 1],
    ["memo", "詳細", "textarea"],
  ],
  schedule: [
    ["name", "予定名", "text", 1],
    ["time", "予定日時（任意）", "datetime-local"],
    ["date", "予定日", "date"],
    ["status", "状態", "select", "todo|未完了;done|完了;postponed|延期"],
    ["memo", "メモ", "textarea"],
  ],
};
let db,
  items = [],
  editing = null,
  kind = "",
  savingRecord = false;
function openDB() {
  return new Promise((ok, no) => {
    let r = indexedDB.open("life-log", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("records", { keyPath: "id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function tx(mode, fn) {
  return new Promise((ok, no) => {
    let t = db.transaction("records", mode);
    t.oncomplete = ok;
    t.onerror = t.onabort = () => no(t.error || Error("Transaction aborted"));
    try {
      fn(t.objectStore("records"));
    } catch (error) {
      t.abort();
      no(error);
    }
  });
}
async function load() {
  items = await new Promise((ok, no) => {
    let r = db.transaction("records").objectStore("records").getAll();
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  items.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  render();
}
function field(f, d) {
  let [key, label, type, req] = f,
    v =
      d?.[key] ??
      (key === "time" && type === "datetime-local" && !d && kind !== "schedule"
        ? nowLocal()
        : "");
  let input =
    type === "select"
      ? '<select id="f_' +
        key +
        '" name="' +
        key +
        '">' +
        String(req)
          .split(";")
          .map((x) => {
            let [a, b] = x.split("|");
            return (
              '<option value="' +
              esc(a) +
              '" ' +
              (v === a ? "selected" : "") +
              ">" +
              esc(b) +
              "</option>"
            );
          })
          .join("") +
        "</select>"
      : type === "textarea"
        ? '<textarea id="f_' +
          key +
          '" name="' +
          key +
          '">' +
          esc(v) +
          "</textarea>"
        : '<input id="f_' +
          key +
          '" name="' +
          key +
          '" type="' +
          type +
          '" value="' +
          esc(v) +
          '" ' +
          (req === 1 ? "required" : "") +
          " " +
          (type === "number" ? 'min="0" step="any"' : "") +
          ">";
  return (
    '<div class="field"><label for="f_' +
    key +
    '">' +
    esc(label) +
    "</label>" +
    input +
    "</div>"
  );
}
function editor(type, r = null) {
  kind = type;
  editing = r;
  $("#formTitle").textContent = (r ? "編集：" : "記録：") + TYPES[type][0];
  $("#fields").innerHTML = fields[type].map((f) => field(f, r?.data)).join("");
  MedicationUI.decorateEditor(type, r);
  $("#delete").hidden = !r;
  $("#formError").textContent = "";
  $("#editor").showModal();
}
function summary(r) {
  let d = r.data;
  switch (r.type) {
    case "med":
      return (
        d.name +
        " " +
        d.dose +
        "（" +
        ({ confirmed: "時刻確認", estimated: "推定", unknown: "不明" }[
          d.certainty
        ] || "") +
        "）"
      );
    case "sleep": {
      let n = (new Date(d.time) - new Date(d.start)) / 3600000;
      return Number.isFinite(n) && n >= 0
        ? "睡眠 " + n.toFixed(1) + "時間"
        : "睡眠日時を確認";
    }
    case "drink":
      return (
        d.name +
        " " +
        d.volume +
        "mL / 純アルコール約" +
        (Number(d.volume) * Number(d.abv) * 0.008).toFixed(1) +
        "g"
      );
    case "temp":
      return d.value + "℃";
    case "weight":
      return d.value + "kg";
    case "bleed":
      return (
        "出血：" +
        ({ yes: "あり", no: "なし", unknown: "不明" }[d.status] || "不明")
      );
    case "schedule":
      return (
        d.name +
        "（" +
        ({ todo: "未完了", done: "完了", postponed: "延期" }[d.status] || "") +
        "）"
      );
    default:
      return d.name || d.memo || "";
  }
}
function recordTime(r) {
  return r.type === "med" && r.data.certainty === "unknown" ? "" : r.time || "";
}
function timeline(records) {
  let last;
  return records
    .map((r) => {
      let day = recordTime(r).slice(0, 10),
        heading =
          day !== last
            ? '<h4 class="day-heading">' + esc(day || "日時未指定") + "</h4>"
            : "";
      last = day;
      return heading + row(r);
    })
    .join("");
}
function row(r) {
  return (
    '<div class="entry"><div><strong>' +
    esc(TYPES[r.type][1] + " " + TYPES[r.type][0]) +
    "</strong><small>" +
    esc(summary(r)) +
    "</small><small>" +
    esc(fmt(r.type === "med" && r.data.certainty === "unknown" ? "" : r.time)) +
    "</small>" +
    (r.data.memo ? '<p class="entry-memo">' + esc(r.data.memo) + "</p>" : "") +
    '</div><button aria-label="' +
    esc(TYPES[r.type][0] + "：" + summary(r) + "を編集") +
    '" data-edit="' +
    esc(r.id) +
    '">編集</button></div>'
  );
}
function render() {
  MedicationUI.refresh(items);
  let f = $("#filter").value;
  $("#recent").innerHTML =
    timeline(items.filter((r) => r.type !== "schedule").slice(0, 20)) ||
    '<p class="empty">まだ記録がありません。</p>';
  $("#records").innerHTML =
    timeline(items.filter((r) => !f || r.type === f)) ||
    '<p class="empty">該当する記録はありません。</p>';
  $("#schedules").innerHTML =
    items
      .filter((r) => r.type === "schedule")
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
      .map(row)
      .join("") || '<p class="empty">予定はありません。</p>';
  let recent = items.filter(
      (r) =>
        r.time &&
        !(r.type === "med" && r.data.certainty === "unknown") &&
        new Date(r.time) <= new Date() &&
        new Date(r.time) >= new Date(Date.now() - 7 * 86400000),
    ),
    grams = recent
      .filter((r) => r.type === "drink")
      .reduce(
        (a, r) => a + Number(r.data.volume) * Number(r.data.abv) * 0.008,
        0,
      ),
    sleep = recent
      .filter((r) => r.type === "sleep")
      .map((r) => (new Date(r.data.time) - new Date(r.data.start)) / 3600000)
      .filter((n) => n >= 0 && n <= 36);
  $("#statistics").innerHTML =
    '<div class="metric">過去7日間の記録<strong>' +
    recent.length +
    '件</strong></div><div class="metric">純アルコール量<strong>' +
    grams.toFixed(1) +
    'g</strong></div><div class="metric">平均睡眠時間<strong>' +
    (sleep.length
      ? (sleep.reduce((a, b) => a + b, 0) / sleep.length).toFixed(1) + "時間"
      : "データなし") +
    '</strong></div><p class="muted">未記録は集計対象外です。医学的評価ではありません。</p>';
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2500);
}
async function save(e) {
  e.preventDefault();
  if (savingRecord) return;
  savingRecord = true;
  $("#formError").textContent = "";
  try {
    let d = {
      ...editing?.data,
      ...Object.fromEntries(new FormData(e.target).entries()),
    };
    if (kind === "med") {
      try {
        d = MedicationUI.recordData(d);
      } catch (error) {
        return formError(error.message);
      }
    }
    if (kind === "med") {
      if (d.certainty === "unknown") d.time = "";
      else if (!d.time)
        return formError("日時を入力するか不明を選択してください");
    }
    if (kind === "sleep" && new Date(d.time) < new Date(d.start))
      return formError("起床日時を確認してください");
    if (kind === "drink" && Number(d.abv) > 100)
      return formError("度数は100%以下にしてください");
    if (kind === "temp" && (Number(d.value) < 25 || Number(d.value) > 45))
      return formError("体温を確認してください");
    if (kind === "weight" && Number(d.value) <= 0)
      return formError("体重を確認してください");
    let time =
        kind === "med" && d.certainty === "unknown"
          ? ""
          : d.time ||
            (kind === "schedule"
              ? d.date
                ? d.date + "T00:00"
                : ""
              : nowLocal()),
      r = {
        ...editing,
        id: editing?.id || crypto.randomUUID(),
        type: kind,
        time,
        data: d,
        createdAt: editing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    await tx("readwrite", (s) => s.put(r));
    $("#editor").close();
    await load();
    toast("保存しました");
  } catch (err) {
    formError(
      "保存できませんでした。入力内容を残しています。再度お試しください。",
    );
  } finally {
    savingRecord = false;
  }
}
function formError(message) {
  $("#formError").textContent = message;
}
function tab(t) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.toggle("active", p.id === t));
  document.querySelectorAll("#nav button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.tab === t);
    if (b.dataset.tab === t) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("#" + t + " h2").setAttribute("tabindex", "-1");
  $("#" + t + " h2").focus();
  window.scrollTo(0, 0);
}
function applyTheme(value) {
  $(".record-tools").open = value !== "diary";
  document.body.dataset.theme = value === "diary" ? "diary" : "dads";
  $("#theme").value = document.body.dataset.theme;
}
async function init() {
  try {
    applyTheme(localStorage.getItem("life-log-theme"));
  } catch {
    applyTheme("dads");
  }
  $("#theme").onchange = (e) => {
    applyTheme(e.target.value);
    try {
      localStorage.setItem("life-log-theme", e.target.value);
    } catch {
      toast("このブラウザではテーマを保存できません");
    }
  };
  try {
    db = await openDB();
  } catch (e) {
    alert("保存領域を開けません");
    return;
  }
  $("#today").textContent = new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  $("#quick").innerHTML = Object.entries(TYPES)
    .filter(([k]) => k !== "schedule")
    .map(
      ([k, v]) =>
        '<button data-add="' +
        k +
        '"><span aria-hidden="true">' +
        v[1] +
        "</span>" +
        v[0] +
        "<small>＋ 記録する</small></button>",
    )
    .join("");
  $("#filter").innerHTML += Object.entries(TYPES)
    .map(([k, v]) => '<option value="' + k + '">' + v[0] + "</option>")
    .join("");
  document.body.addEventListener("click", (e) => {
    let a = e.target.closest("[data-add]"),
      b = e.target.closest("[data-edit]"),
      c = e.target.closest("[data-tab]");
    if (a) editor(a.dataset.add);
    if (b) {
      let r = items.find((x) => x.id === b.dataset.edit);
      if (r) editor(r.type, r);
    }
    if (c) tab(c.dataset.tab);
  });
  $("#addSchedule").onclick = () => editor("schedule");
  $("#close").onclick = () => $("#editor").close();
  $("#recordForm").onsubmit = save;
  $("#delete").onclick = async () => {
    if (!editing || !confirm("この記録を削除しますか？")) return;
    try {
      await tx("readwrite", (s) => s.delete(editing.id));
      $("#editor").close();
      await load();
      toast("削除しました");
    } catch {
      formError("削除できませんでした。再度お試しください。");
    }
  };
  $("#filter").onchange = render;
  $("#export").onclick = () => {
    let blob = new Blob(
        [
          JSON.stringify(
            {
              app: "life-log",
              version: 1,
              records: items,
              exportedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "life-log-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  $("#import").onchange = async (e) => {
    let file = e.target.files[0];
    if (!file) return;
    try {
      let raw = JSON.parse(await file.text());
      if (
        raw.app !== "life-log" ||
        raw.version !== 1 ||
        !Array.isArray(raw.records) ||
        raw.records.length > 100000 ||
        raw.records.some(
          (r) =>
            typeof r.id !== "string" ||
            !TYPES[r.type] ||
            !r.data ||
            typeof r.data !== "object" ||
            Array.isArray(r.data) ||
            typeof r.time !== "string" ||
            Object.values(r.data).some(
              (v) =>
                typeof v !== "string" && typeof v !== "number" && v !== null,
            ),
        )
      )
        throw Error("形式が不正です");
      if (!confirm(raw.records.length + "件を統合しますか？")) return;
      await tx("readwrite", (s) => raw.records.forEach((r) => s.put(r)));
      await load();
      toast("復元しました");
    } catch (err) {
      alert("復元失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  };
  $("#persist").onclick = async () => {
    $("#persistStatus").textContent = navigator.storage?.persist
      ? (await navigator.storage.persist())
        ? "永続保存が許可されました"
        : "許可されませんでした"
      : "このブラウザは非対応です";
  };
  await load();
  await MedicationUI.init({
    getRecords: () => items,
    editor,
    tab,
    notify: toast,
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:")
    navigator.serviceWorker.register("./sw.js").catch(() => {});
}
init();
