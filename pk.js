/* One-compartment, first-order oral absorption model. No clinical dosing logic. */
(function (root) {
  "use strict";
  const HOUR = 3600000;
  const RANGE_HOURS = Object.freeze([6, 12, 24, 48, 72, 168]);
  function number(value, min, max) {
    if (value === "" || !["string", "number"].includes(typeof value))
      return false;
    return (
      Number.isFinite(Number(value)) &&
      Number(value) >= min &&
      Number(value) <= max
    );
  }
  function normalizeDoseInput(value) {
    const normalized = String(value ?? "")
      .normalize("NFKC")
      .trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
      throw Error(
        "服用量は小数点「.」を使った数値で入力してください（例：0.25）。単位やカンマは入力しないでください。",
      );
    }
    if (!number(normalized, 0.001, 100000))
      throw Error("1回量を0.001〜100000 mgで入力してください。");
    return String(Number(normalized));
  }
  function validateProfile(p) {
    if (
      !p ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 120
    )
      return "薬の名前を1〜120文字で入力してください。";
    if (!number(p.doseMg, 0.001, 100000))
      return "1回量を0.001〜100000 mgで入力してください。";
    if (
      !number(p.tmaxHours, 0.001, 10000) ||
      !number(p.halfLifeHours, 0.001, 10000)
    )
      return "T-maxと消失半減期を0.001〜10000時間で入力してください。";
    const hasF = p.bioavailability !== "" && p.bioavailability != null;
    const hasV = p.vdLKg !== "" && p.vdLKg != null;
    if (hasF !== hasV)
      return "濃度モデルにはFと分布容積の両方が必要です。分からない場合は両方を空欄にしてください。";
    if (
      hasF &&
      (!number(p.bioavailability, 0.0001, 1) || !number(p.vdLKg, 0.001, 10000))
    )
      return "Fは0より大きく1以下、分布容積は0.001〜10000 L/kgで入力してください。";
    if (
      p.source != null &&
      (typeof p.source !== "string" || p.source.length > 1000)
    )
      return "出典メモは1000文字以内で入力してください。";
    return "";
  }
  function modelError(p) {
    const error = validateProfile(p);
    if (error) return error;
    // ka >= ke: the supplied half-life is the terminal elimination half-life.
    if ((Number(p.tmaxHours) * Math.LN2) / Number(p.halfLifeHours) > 1 + 1e-12)
      return "このモデルはT-maxが消失半減期÷ln(2)以下の場合に対応します。値と単位をご確認ください。徐放製剤などには適用できない場合があります。";
    return "";
  }
  function rates(tmax, halfLife) {
    const ke = Math.LN2 / halfLife,
      rawTarget = tmax * ke,
      target = Math.min(1, rawTarget);
    if (!(rawTarget > 0 && rawTarget <= 1 + 1e-12))
      throw Error("Unsupported Tmax/half-life");
    if (Math.abs(1 - target) < 1e-10) return { ka: ke, ke };
    const ratioTime = (r) => Math.log(r) / (r - 1);
    let low = 1,
      high = 2;
    while (ratioTime(high) > target) high *= 2;
    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      if (ratioTime(mid) > target) low = mid;
      else high = mid;
    }
    return { ka: (ke * (low + high)) / 2, ke };
  }
  function fraction(hours, ka, ke) {
    if (hours <= 0) return 0;
    if (Math.abs(ka - ke) < ke * 1e-8)
      return ke * hours * Math.exp(-ke * hours);
    return Math.max(
      0,
      (ka / (ka - ke)) *
        Math.exp(-ke * hours) *
        -Math.expm1(-(ka - ke) * hours),
    );
  }
  function prepareDose(profile, at, doseMg = profile.doseMg) {
    if (modelError({ ...profile, doseMg }) || !Number.isFinite(at)) return null;
    return {
      ...profile,
      doseMg: Number(doseMg),
      at,
      ...rates(Number(profile.tmaxHours), Number(profile.halfLifeHours)),
    };
  }
  function valueAt(doses, time, weightKg, absolute) {
    if (!number(weightKg, 0.1, 1000)) throw Error("Invalid weight");
    return doses.reduce((total, d) => {
      const scaled = absolute
        ? (d.doseMg * Number(d.bioavailability)) / (weightKg * Number(d.vdLKg))
        : d.doseMg / weightKg;
      if (!Number.isFinite(scaled))
        throw Error("Missing concentration parameters");
      return total + scaled * fraction((time - d.at) / HOUR, d.ka, d.ke);
    }, 0);
  }
  function recordedDoses(records, medicationId, now = Date.now()) {
    const doses = [],
      skipped = { unknown: 0, invalid: 0, future: 0, estimated: 0 };
    for (const r of records) {
      if (r.type !== "med" || r.data.medicationId !== medicationId) continue;
      const d = r.data,
        at = Date.parse(d.time);
      if (d.certainty === "unknown" || !d.time) {
        skipped.unknown++;
        continue;
      }
      if (
        !["confirmed", "estimated"].includes(d.certainty) ||
        !Number.isFinite(at) ||
        Date.parse(r.time) !== at
      ) {
        skipped.invalid++;
        continue;
      }
      if (at > now) {
        skipped.future++;
        continue;
      }
      // Legacy clients can edit the old text dose while retaining unknown PK keys.
      // Do not graph a stale numeric snapshot that disagrees with the saved text.
      const textDose =
        typeof d.dose === "string" &&
        d.dose.match(/^\s*((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*mg\s*$/i);
      if (!textDose || Number(textDose[1]) !== Number(d.doseMg)) {
        skipped.invalid++;
        continue;
      }
      const dose = prepareDose(d, at);
      if (!dose) {
        skipped.invalid++;
        continue;
      }
      if (d.certainty === "estimated") skipped.estimated++;
      doses.push(dose);
    }
    return { doses, skipped };
  }
  function series(doses, start, hours, weightKg, absoluteOverride = null) {
    if (!RANGE_HOURS.includes(hours) || !Number.isFinite(start))
      throw Error("Invalid range");
    if (doses.length > 5000) throw Error("Too many doses");
    const end = start + hours * HOUR;
    const absolute =
      absoluteOverride ??
      doses.every(
        (d) =>
          number(d.bioavailability, 0.0001, 1) && number(d.vdLKg, 0.001, 10000),
      );
    // Include exact dose times and single-dose peak times to retain short peaks.
    const times = new Set(
      Array.from({ length: 337 }, (_, i) => start + ((end - start) * i) / 336),
    );
    for (const d of doses)
      for (const time of [d.at, d.at + Number(d.tmaxHours) * HOUR])
        if (time >= start && time <= end) times.add(time);
    const points = [...times]
      .sort((a, b) => a - b)
      .map((time) => ({
        time,
        value: valueAt(doses, time, weightKg, absolute),
      }));
    return { points, absolute, unit: absolute ? "mg/L" : "mg/kg", start, end };
  }
  function groupSeries(groups, start, hours, weightKg) {
    if (
      !groups.length ||
      groups.length > 6 ||
      groups.some((g) => !g.doses.length)
    )
      throw Error("Select one to six nonempty series");
    const absolute = groups.every((g) =>
      g.doses.every(
        (d) =>
          number(d.bioavailability, 0.0001, 1) && number(d.vdLKg, 0.001, 10000),
      ),
    );
    return groups.map((g) => ({
      ...g,
      ...series(g.doses, start, hours, weightKg, absolute),
    }));
  }
  const API = {
    HOUR,
    RANGE_HOURS,
    number,
    validateProfile,
    normalizeDoseInput,
    modelError,
    rates,
    fraction,
    prepareDose,
    valueAt,
    recordedDoses,
    series,
    groupSeries,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.PK = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
