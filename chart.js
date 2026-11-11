/* Presentation only: scaling and labels never change the underlying model values. */
(function (root) {
  "use strict";
  const esc = (value) =>
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
  const valueLabel = (v) =>
    v === 0
      ? "0"
      : v < 0.001 || v >= 10000
        ? v.toExponential(2)
        : String(Number(v.toPrecision(4)));
  const dash = (i) =>
    i
      ? `stroke-dasharray="${["", "9 4", "3 4", "12 3 3 3", "2 3 2 3 9 3", "14 6"][i]}"`
      : "";
  function niceMax(value) {
    if (!Number.isFinite(value) || value < 0) throw Error("Invalid axis range");
    if (!value) return 1;
    const target = value * 1.12,
      scale = 10 ** Math.floor(Math.log10(target));
    return [1, 2, 5, 10].find((n) => n * scale >= target) * scale;
  }
  function timeTick(time, start, mode) {
    const d = new Date(time),
      duration = time - start;
    if (mode === "calendar")
      return [
        `${d.getMonth() + 1}/${d.getDate()}`,
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      ];
    const [divisor, unit] = {
      minutes: [60000, "分"],
      hours: [3600000, "時間"],
      days: [86400000, "日"],
    }[mode];
    return [String(Number((duration / divisor).toFixed(3))), unit];
  }
  function render(
    series,
    {
      width,
      start,
      end,
      unit,
      mode = "shared",
      timeMode = "calendar",
      assignments = {},
      now = Date.now(),
    },
  ) {
    if (
      !["shared", "dual", "separate"].includes(mode) ||
      !["calendar", "minutes", "hours", "days"].includes(timeMode) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !series.length ||
      series.length > 6
    )
      throw Error("Invalid chart settings");
    if (
      series.some(
        (line) =>
          line.unit !== unit ||
          !line.points.length ||
          line.points.some(
            (p) =>
              !Number.isFinite(p.value) ||
              p.value < 0 ||
              !Number.isFinite(p.time),
          ),
      )
    )
      throw Error("Invalid or mixed series");
    width = Math.max(240, Math.round(width) || 340);
    const sideOf = (line) => {
      const side = Object.hasOwn(assignments, line.id)
        ? assignments[line.id]
        : line.index === 0
          ? "left"
          : "right";
      if (!["left", "right"].includes(side))
        throw Error("Invalid axis assignment");
      return side;
    };
    const indexed = series.map((line, index) => ({ ...line, index }));
    const groups =
      mode === "separate" ? indexed.map((line) => [line]) : [indexed];
    const descriptors = [];
    const html = groups
      .map((lines, panel) => {
        const height = mode === "separate" ? 220 : 270,
          top = 30,
          bottom = 52;
        const axes =
          mode === "dual"
            ? ["left", "right"]
                .map((side) => ({
                  side,
                  lines: lines.filter((line) => sideOf(line) === side),
                }))
                .filter((axis) => axis.lines.length)
            : [{ side: "left", lines }];
        for (const axis of axes) {
          axis.max = niceMax(
            axis.lines.reduce(
              (max, line) =>
                line.points.reduce((max, p) => Math.max(max, p.value), max),
              0,
            ),
          );
          axis.label =
            mode === "shared"
              ? "共通軸"
              : mode === "dual"
                ? axis.side === "left"
                  ? "左軸"
                  : "右軸"
                : "薬別軸";
          for (const line of axis.lines)
            descriptors.push({
              id: line.id,
              index: line.index,
              side: axis.side,
              label: axis.label,
              max: axis.max,
              unit,
            });
        }
        const left = axes.some((a) => a.side === "left") ? 58 : 16,
          right = axes.some((a) => a.side === "right") ? 58 : 16;
        const plotW = width - left - right,
          plotH = height - top - bottom;
        const x = (t) => left + ((t - start) / (end - start)) * plotW;
        const y = (v, axis) => top + (1 - v / axis.max) * plotH;
        let grid = "";
        for (let i = 0; i <= 4; i++)
          grid += `<line x1="${left}" x2="${width - right}" y1="${top + (plotH * i) / 4}" y2="${top + (plotH * i) / 4}" class="chart-grid"/>`;
        for (const axis of axes) {
          const axisX = axis.side === "left" ? left : width - right;
          for (let i = 0; i <= 4; i++) {
            const v = (axis.max * i) / 4;
            grid += `<text data-axis="${axis.side}" x="${axisX + (axis.side === "left" ? -7 : 7)}" y="${y(v, axis) + 4}" text-anchor="${axis.side === "left" ? "end" : "start"}">${esc(valueLabel(v))}</text>`;
          }
          grid += `<text class="chart-axis-title" x="${axis.side === "left" ? 0 : width}" y="18" text-anchor="${axis.side === "left" ? "start" : "end"}">${mode === "dual" ? (axis.side === "left" ? "左 " : "右 ") : ""}${unit}</text>`;
        }
        for (let i = 0; i <= 3; i++) {
          const t = start + ((end - start) * i) / 3,
            [first, second] = timeTick(t, start, timeMode);
          grid += `<text class="chart-time-tick" x="${x(t)}" y="${height - 29}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${esc(first)}</text><text x="${x(t)}" y="${height - 12}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${esc(second)}</text>`;
        }
        const nowMark =
          now >= start && now <= end
            ? `<line x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${height - bottom}" class="chart-now"/><text x="${x(now)}" y="18" text-anchor="middle">現在</text>`
            : "";
        const paths = lines
          .map((line) => {
            const axis = axes.find((axis) => axis.lines.includes(line));
            const d = line.points
              .map(
                (p, i) =>
                  `${i ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.value, axis).toFixed(2)}`,
              )
              .join(" ");
            return `<path d="${d}" class="chart-line series-${line.index}" data-series="${esc(line.id)}" data-axis="${axis.side}" data-axis-max="${axis.max}" ${dash(line.index)}/>`;
          })
          .join("");
        const title = lines.map((line) => line.name).join("・");
        const description = `${unit}。${mode === "shared" ? "全ての線は共通目盛りです。" : "縦軸ごとに倍率が異なり、線の高さは直接比較できません。"}${timeMode === "calendar" ? "横軸は日時です。" : "横軸は表示開始からの経過時間です。"}値は下のスライダーと数値表でも確認できます。`;
        return `<div class="chart-panel">${mode === "separate" ? `<p class="chart-panel-title">${lines[0].index + 1}. ${esc(title)} <span>0〜${valueLabel(axes[0].max)} ${unit}</span></p>` : ""}<svg data-plot="true" data-plot-left="${left}" data-plot-width="${plotW}" data-view-width="${width}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="curveSvgTitle-${panel} curveSvgDesc-${panel}"><title id="curveSvgTitle-${panel}">${esc(title)}の参考推移（${unit}）</title><desc id="curveSvgDesc-${panel}">${esc(description)}</desc>${grid}${nowMark}${paths}<line data-chart-cursor="true" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" class="chart-cursor"/></svg></div>`;
      })
      .join("");
    return { html, axes: descriptors };
  }
  const api = { niceMax, timeTick, render, dash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ChartView = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
