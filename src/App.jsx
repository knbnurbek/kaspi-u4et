import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";
import {
  Plus, Trash2, Settings, LayoutDashboard, History, Upload,
  TrendingUp, Wallet, Landmark, PiggyBank, X, AlertTriangle, ChevronDown, Pencil,
} from "lucide-react";

const CATEGORIES = [
  "Закуп товара",
  "Комиссия за продажи (Kaspi)",
  "Доставка",
  "Акции и бонусы за отзывы",
  "Возвраты",
  "Реклама",
  "Абонентская плата",
  "Накопление",
  "Снятие на свой счёт",
  "Перевод на свой счёт",
  "Пополнение со своего счёта",
  "Прочее",
];
const INK = "#1a1a18";
const PAPER = "#faf8f3";
const GREEN = "#1d6f4c";
const RUST = "#b23a2e";
const NAVY = "#2b4c6f";
const GOLD = "#a8792f";
const CHART_COLORS = [RUST, GOLD, NAVY, GREEN, "#6250d6", "#e87ba4", "#e34948", "#008300"];
const PERSONAL_CATEGORIES = ["Снятие на свой счёт", "Перевод на свой счёт", "Пополнение со своего счёта"];

const money = (n) => (Math.round(n || 0)).toLocaleString("ru-RU") + " ₸";
const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);

function startOfWeek(d) {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7; // Monday = 0
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function monthsInRange(start, end) {
  const s = new Date(start), e = new Date(end);
  const seen = new Set();
  const cur = new Date(s.getFullYear(), s.getMonth(), 1);
  const last = new Date(e.getFullYear(), e.getMonth(), 1);
  while (cur <= last) {
    seen.add(`${cur.getFullYear()}-${cur.getMonth()}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return seen.size;
}

function rangeFor(period, customStart, customEnd) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let start, end;
  if (period === "day") { start = new Date(now); end = new Date(now); }
  else if (period === "week") { start = startOfWeek(now); end = new Date(now); }
  else if (period === "month") { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now); }
  else if (period === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now); }
  else { start = customStart ? new Date(customStart) : new Date(now); end = customEnd ? new Date(customEnd) : new Date(now); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function useCloudStorage(key, initial, userId) {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const skipNextSave = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoaded(false);
    (async () => {
      const { data, error } = await supabase
        .from("kv")
        .select("value")
        .eq("user_id", userId)
        .eq("key", key)
        .maybeSingle();
      if (active) {
        if (!error && data && data.value !== undefined) setValue(data.value);
        setLoaded(true);
      }
    })();

    const channel = supabase
      .channel(`kv-${userId}-${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kv", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new && payload.new.key === key && payload.new.value !== undefined) {
            skipNextSave.current = true;
            setValue(payload.new.value);
          }
        }
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [key, userId]);

  useEffect(() => {
    if (!loaded || !userId) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const t = setTimeout(() => {
      supabase.from("kv").upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }).then(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [key, value, loaded, userId]);

  return [value, setValue, loaded];
}

function Dashboard({ userId, onSignOut }) {
  const [entries, setEntries, entriesLoaded] = useCloudStorage("kaspi:entries", [], userId);
  const [settings, setSettings] = useCloudStorage("kaspi:settings", {
    mySalary: 300000,
    employeeSalary: 150000,
    taxRate: 2,
    savings: [
      { name: "Резерв", percent: 50 },
      { name: "Развитие", percent: 30 },
      { name: "Личное", percent: 20 },
    ],
  }, userId);

  const [tab, setTab] = useState("dashboard");
  const [period, setPeriod] = useState("month");
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [formEntry, setFormEntry] = useState(null); // null=closed, "new"=blank form, entry object=editing
  const [expandedId, setExpandedId] = useState(null);
  const fileInput = useRef(null);
  const [importMsg, setImportMsg] = useState(null);

  const { start, end } = useMemo(() => rangeFor(period, customStart, customEnd), [period, customStart, customEnd]);

  const filtered = useMemo(
    () => entries.filter((e) => e.date >= start && e.date <= end).sort((a, b) => a.date.localeCompare(b.date)),
    [entries, start, end]
  );

  const stats = useMemo(() => {
    let revenue = 0, businessExpenses = 0;
    const byCategory = {};
    const byDate = {};
    const categorySeries = [];
    for (const e of filtered) {
      revenue += e.revenue;
      let dayExp = 0;
      const catRow = { date: e.date };
      for (const x of e.expenses || []) {
        byCategory[x.category] = (byCategory[x.category] || 0) + x.amount;
        catRow[x.category] = (catRow[x.category] || 0) + x.amount;
        if (!PERSONAL_CATEGORIES.includes(x.category)) {
          businessExpenses += x.amount;
          dayExp += x.amount;
        }
      }
      const tax = e.revenue * (settings.taxRate / 100);
      if (tax) catRow["Налог"] = tax;
      categorySeries.push(catRow);
      byDate[e.date] = { date: e.date, revenue: e.revenue, net: e.revenue - dayExp - tax };
    }
    const taxReserve = revenue * (settings.taxRate / 100);
    const net = revenue - businessExpenses - taxReserve;
    const series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const pie = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
    if (taxReserve > 0) pie.push({ name: "Налог", value: taxReserve });
    const catTotals = { ...byCategory };
    if (taxReserve > 0) catTotals["Налог"] = taxReserve;
    const categoryNames = Object.keys(catTotals)
      .filter((c) => !PERSONAL_CATEGORIES.includes(c))
      .sort((a, b) => catTotals[b] - catTotals[a])
      .slice(0, 8);
    const personalWithdrawals = PERSONAL_CATEGORIES
      .map((name) => ({ name, value: byCategory[name] || 0 }))
      .filter((x) => x.value !== 0);
    if (byCategory["Накопление"] > 0) personalWithdrawals.push({ name: "Накопление", value: byCategory["Накопление"] });
    return { revenue, expenses: businessExpenses, taxReserve, net, series, pie, categorySeries: categorySeries.sort((a, b) => a.date.localeCompare(b.date)), categoryNames, personalWithdrawals };
  }, [filtered, settings.taxRate, start, end]);

  const distribution = useMemo(() => {
    const fixed = settings.mySalary + settings.employeeSalary;
    const remaining = stats.net - fixed;
    const totalPercent = settings.savings.reduce((s, x) => s + Number(x.percent || 0), 0) || 1;
    const split = settings.savings.map((s) => ({
      name: s.name,
      amount: remaining > 0 ? (remaining * s.percent) / totalPercent : 0,
    }));
    return { fixed, remaining, split };
  }, [stats.net, settings]);

  function addEntry(entry) {
    setEntries((prev) => {
      const others = prev.filter((e) => e.date !== entry.date);
      return [...others, entry];
    });
  }

  function deleteEntry(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function normalizeStatementDate(raw) {
    const str = String(raw || "").trim();
    const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  function classifyPurpose(purposeRaw) {
    const p = (purposeRaw || "").toLowerCase();
    if (/возврат.*продаж/.test(p)) return { cat: "__REFUND__", col: "debit", sign: 1 };
    if (/продаж.*kaspi\.kz/.test(p)) return { cat: "__REVENUE__", col: "credit", sign: 1 };
    if (/возврат.*процессинг/.test(p)) return { cat: "Комиссия за продажи (Kaspi)", col: "credit", sign: -1 };
    if (/возврат.*обработке данных/.test(p)) return { cat: "Комиссия за продажи (Kaspi)", col: "credit", sign: -1 };
    if (/возврат.*бонус/.test(p)) return { cat: "Акции и бонусы за отзывы", col: "credit", sign: -1 };
    if (/абонентская плата|ведение счета/.test(p)) return { cat: "Абонентская плата", col: "debit", sign: 1 };
    if (/процессинг/.test(p)) return { cat: "Комиссия за продажи (Kaspi)", col: "debit", sign: 1 };
    if (/доставк/.test(p)) return { cat: "Доставка", col: "debit", sign: 1 };
    if (/обработке данных/.test(p)) return { cat: "Комиссия за продажи (Kaspi)", col: "debit", sign: 1 };
    if (/рекламн/.test(p)) return { cat: "Реклама", col: "debit", sign: 1 };
    if (/бонус/.test(p)) return { cat: "Акции и бонусы за отзывы", col: "debit", sign: 1 };
    if (/операц.*карт/.test(p)) return { cat: "Комиссия за продажи (Kaspi)", col: "debit", sign: 1 };
    if (/снятие|снятия наличных/.test(p)) return { cat: "Снятие на свой счёт", col: "debit", sign: 1 };
    if (/перевод.*со своего/.test(p)) return { cat: "Пополнение со своего счёта", col: "credit", sign: 1 };
    if (/депозит/.test(p)) return { cat: "Накопление", col: "debit", sign: 1 };
    if (/перевод/.test(p)) return { cat: "Перевод на свой счёт", col: "debit", sign: 1 };
    return { cat: "__UNKNOWN__" };
  }

  function handleKaspiFile(file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        const normCell = (c) => String(c || "").replace(/\s+/g, " ").toLowerCase();
        let headerIdx = -1, dateCol = -1, debitCol = -1, creditCol = -1, purposeCol = -1;
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].map(normCell);
          const dc = cells.findIndex((c) => c.includes("дата операции"));
          const pc = cells.findIndex((c) => c.includes("назначение платежа"));
          if (dc !== -1 && pc !== -1) {
            headerIdx = i; dateCol = dc; purposeCol = pc;
            debitCol = cells.findIndex((c) => c.includes("дебет"));
            creditCol = cells.findIndex((c) => c.includes("кредит"));
            break;
          }
        }
        if (headerIdx === -1) {
          setImportMsg({ ok: false, text: "Не нашёл в файле таблицу с колонками «Дата операции» и «Назначение платежа». Это точно выписка по счёту Kaspi?" });
          return;
        }

        const byDate = {};
        let unknownSum = 0, unknownCount = 0;

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const d = normalizeStatementDate(r[dateCol]);
          if (!d) continue; // numbering row, totals row, blank row, etc.
          const debit = Number(r[debitCol]) || 0;
          const credit = Number(r[creditCol]) || 0;
          const purpose = String(r[purposeCol] || "");
          const cls = classifyPurpose(purpose);

          if (!byDate[d]) byDate[d] = { revenue: 0, expenses: {} };

          if (cls.cat === "__REVENUE__") { byDate[d].revenue += credit; continue; }
          if (cls.cat === "__REFUND__") { byDate[d].revenue -= debit; continue; }
          if (cls.cat === "__UNKNOWN__") {
            if (debit) { byDate[d].expenses["Прочее"] = (byDate[d].expenses["Прочее"] || 0) + debit; }
            else if (credit) { unknownSum += credit; unknownCount++; }
            continue;
          }
          const amount = (cls.col === "credit" ? credit : debit) * cls.sign;
          byDate[d].expenses[cls.cat] = (byDate[d].expenses[cls.cat] || 0) + amount;
        }

        const days = Object.keys(byDate);
        if (days.length === 0) {
          setImportMsg({ ok: false, text: "Не нашёл ни одной операции с распознаваемой датой в файле." });
          return;
        }

        setEntries((prev) => {
          const map = new Map(prev.map((e) => [e.date, e]));
          for (const [d, data] of Object.entries(byDate)) {
            const expenses = Object.entries(data.expenses).map(([category, amount]) => ({ category, amount }));
            map.set(d, { id: uid(), date: d, revenue: data.revenue, expenses, note: "Импорт из выписки Kaspi" });
          }
          return Array.from(map.values());
        });

        let text = `Загружено ${days.length} дн. из выписки.`;
        if (unknownCount) text += ` Не распознано ${unknownCount} операций (входящих) на ${money(unknownSum)} — проверь их в выписке вручную.`;
        setImportMsg({ ok: true, text });
      } catch (err) {
        setImportMsg({ ok: false, text: "Не удалось прочитать файл. Убедись, что это выгрузка выписки Kaspi в формате .xlsx." });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  if (!entriesLoaded) return <div style={{ padding: "2rem", color: "var(--text-secondary, #666)" }}>Загрузка...</div>;

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: PAPER, color: INK, minHeight: 400, padding: "1.5rem", borderRadius: 12 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
        .num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .tab-btn { display:flex; align-items:center; gap:6px; padding:8px 4px; border:none; background:none; font-size:14px; cursor:pointer; color:#77756c; border-bottom:2px solid transparent; font-family:inherit; }
        .tab-btn.active { color:${INK}; border-bottom-color:${GREEN}; font-weight:500; }
        .field { width:100%; border:1px solid #ddd9cc; background:#fff; border-radius:4px; padding:7px 9px; font-size:14px; font-family:inherit; }
        .field:focus { outline:1px solid ${GREEN}; }
        .btn { border:1px solid #ddd9cc; background:#fff; padding:7px 12px; border-radius:4px; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-family:inherit; }
        .btn:hover { background:#f2efe6; }
        .btn-primary { background:${INK}; color:#fff; border-color:${INK}; }
        .btn-primary:hover { background:#333; }
        .row-line { border-bottom:1px solid #e8e5da; }
        select.field { appearance:none; }
      `}</style>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Учёт Kaspi-магазина</h1>
          <p style={{ fontSize: 13, color: "#77756c", margin: "2px 0 0" }}>{start === end ? start : `${start} — ${end}`}</p>
        </div>
        <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <button className={`tab-btn ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}><LayoutDashboard size={16} aria-hidden="true" />Обзор</button>
          <button className={`tab-btn ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}><History size={16} aria-hidden="true" />История</button>
          <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}><Settings size={16} aria-hidden="true" />Настройки</button>
          <button className="btn" onClick={onSignOut} style={{ marginLeft: 8 }}>Выйти</button>
        </nav>
      </header>

      {tab !== "settings" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {["day", "week", "month", "year", "custom"].map((p) => (
            <button key={p} className="btn" style={period === p ? { background: INK, color: "#fff", borderColor: INK } : {}} onClick={() => setPeriod(p)}>
              {{ day: "День", week: "Неделя", month: "Месяц", year: "Год", custom: "Свой период" }[p]}
            </button>
          ))}
          {period === "custom" && (
            <>
              <input type="date" className="field" style={{ width: 140 }} value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <span style={{ color: "#77756c" }}>—</span>
              <input type="date" className="field" style={{ width: 140 }} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden="true" />Импорт из Kaspi (.xlsx)</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden onChange={(e) => e.target.files[0] && handleKaspiFile(e.target.files[0])} />
          <button className="btn btn-primary" onClick={() => setFormEntry("new")}><Plus size={14} aria-hidden="true" />Внести день</button>
        </div>
      )}

      {importMsg && tab !== "settings" && (
        <div style={{ marginBottom: "1rem", fontSize: 13, padding: "8px 12px", borderRadius: 4, background: importMsg.ok ? "#eaf3de" : "#fcebeb", color: importMsg.ok ? "#27500a" : "#791f1f", display: "flex", justifyContent: "space-between" }}>
          {importMsg.text}
          <button onClick={() => setImportMsg(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {tab === "dashboard" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: "1.5rem" }}>
            <StatCard icon={<TrendingUp size={16} color={GREEN} />} label="Выручка" value={stats.revenue} />
            <StatCard icon={<Wallet size={16} color={RUST} />} label="Расходы" value={stats.expenses} />
            <StatCard icon={<Landmark size={16} color={GOLD} />} label="Налог (резерв)" value={stats.taxReserve} />
            <StatCard icon={<PiggyBank size={16} color={NAVY} />} label="Доход" value={stats.net} bold />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px" }}>Динамика по дням</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.series}>
                  <CartesianGrid stroke="#e8e5da" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#77756c" }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: "#77756c" }} width={70} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => money(v)} labelFormatter={(l) => l} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="revenue" name="Выручка" stroke={GREEN} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="net" name="Доход" stroke={NAVY} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px" }}>Динамика расходов по категориям</h3>
              {stats.categoryNames.length === 0 ? (
                <p style={{ fontSize: 13, color: "#77756c" }}>Нет расходов за период.</p>
              ) : (
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.categorySeries}>
                      <CartesianGrid stroke="#e8e5da" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#77756c" }} tickFormatter={(d) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: "#77756c" }} width={70} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                      <Tooltip formatter={(v) => money(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {stats.categoryNames.map((name, i) => (
                        <Bar key={name} dataKey={name} stackId="exp" fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px" }}>Доля расходов за период</h3>
              {(() => {
                const businessPie = stats.pie.filter((x) => !PERSONAL_CATEGORIES.includes(x.name) && x.name !== "Накопление");
                return businessPie.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#77756c" }}>Нет расходов за период.</p>
                ) : (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={businessPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                          {businessPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => money(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </div>
          </div>

          {stats.personalWithdrawals.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e8e5da", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px" }}>Личные операции по счёту</h3>
              <p style={{ fontSize: 12, color: "#77756c", margin: "0 0 8px" }}>Личные операции по счёту — не показаны на графике динамики расходов. Из них «Доход» по-прежнему уменьшает только «Накопление»; снятия и переводы — нет.</p>
              {stats.personalWithdrawals.map((x) => (
                <Row key={x.name} label={x.name} value={x.value} />
              ))}
            </div>
          )}

          <div style={{ background: "#fff", border: "1px solid #e8e5da", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px" }}>Расходы на Kaspi</h3>
            {stats.pie.filter((x) => !PERSONAL_CATEGORIES.includes(x.name) && x.name !== "Накопление").length === 0 ? (
              <p style={{ fontSize: 13, color: "#77756c" }}>Нет расходов за период.</p>
            ) : (
              stats.pie
                .filter((x) => !PERSONAL_CATEGORIES.includes(x.name) && x.name !== "Накопление")
                .sort((a, b) => b.value - a.value)
                .map((x) => <Row key={x.name} label={x.name} value={x.value} />)
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #e8e5da", borderRadius: 8, padding: "1rem 1.25rem" }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Распределение чистой прибыли за период</h3>
            <Row label="Чистая прибыль" value={stats.net} />
            <Row label={`Оклад: ты`} value={-settings.mySalary} />
            <Row label={`Оклад: сотрудник`} value={-settings.employeeSalary} />
            <div className="row-line" style={{ margin: "6px 0" }} />
            <Row label="Остаток к распределению" value={distribution.remaining} strong />
            {distribution.remaining < 0 && (
              <p style={{ fontSize: 13, color: RUST, display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                <AlertTriangle size={14} aria-hidden="true" /> За этот период прибыли не хватает на полные оклады.
              </p>
            )}
            {distribution.split.map((s) => (
              <Row key={s.name} label={`↳ ${s.name}`} value={s.amount} muted />
            ))}
          </div>
        </>
      )}

      {tab === "history" && (
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr className="row-line">
                <th style={{ width: 24 }}></th>
                <th style={{ textAlign: "left", padding: "6px 4px", color: "#77756c", fontWeight: 500 }}>Дата</th>
                <th style={{ textAlign: "right", padding: "6px 4px", color: "#77756c", fontWeight: 500 }}>Выручка</th>
                <th style={{ textAlign: "right", padding: "6px 4px", color: "#77756c", fontWeight: 500 }}>Расходы</th>
                <th style={{ textAlign: "right", padding: "6px 4px", color: "#77756c", fontWeight: 500 }}>Доход</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...filtered].sort((a, b) => b.date.localeCompare(a.date)).map((e) => {
                const exp = (e.expenses || []).filter((x) => !PERSONAL_CATEGORIES.includes(x.category)).reduce((s, x) => s + x.amount, 0);
                const tax = e.revenue * (settings.taxRate / 100);
                const isOpen = expandedId === e.id;
                return (
                  <React.Fragment key={e.id}>
                    <tr className="row-line">
                      <td style={{ padding: "8px 0 8px 4px" }}>
                        <button onClick={() => setExpandedId(isOpen ? null : e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#77756c", display: "flex" }} aria-label={isOpen ? "Свернуть" : "Развернуть"}>
                          <ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : "none" }} />
                        </button>
                      </td>
                      <td style={{ padding: "8px 4px" }}>{e.date}</td>
                      <td className="num" style={{ padding: "8px 4px", textAlign: "right" }}>{money(e.revenue)}</td>
                      <td className="num" style={{ padding: "8px 4px", textAlign: "right", color: RUST }}>{money(exp)}</td>
                      <td className="num" style={{ padding: "8px 4px", textAlign: "right", fontWeight: 500 }}>{money(e.revenue - exp - tax)}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button onClick={() => setFormEntry(e)} style={{ background: "none", border: "none", cursor: "pointer", color: "#77756c", marginRight: 6 }} aria-label="Изменить"><Pencil size={14} /></button>
                        <button onClick={() => deleteEntry(e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#a9a79c" }} aria-label="Удалить"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: "0 4px 12px 30px", background: "#f5f3ec" }}>
                          {(e.expenses || []).length === 0 ? (
                            <p style={{ fontSize: 12, color: "#77756c", padding: "8px 0" }}>Расходов за этот день нет.</p>
                          ) : (
                            <table style={{ width: "100%", fontSize: 12 }}>
                              <tbody>
                                {e.expenses.map((x, i) => (
                                  <tr key={i}>
                                    <td style={{ padding: "4px 0", color: "#52514e" }}>{x.category}</td>
                                    <td className="num" style={{ padding: "4px 0", textAlign: "right", color: x.amount < 0 ? GREEN : RUST }}>{money(x.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "1.5rem 4px", color: "#77756c" }}>Нет записей за выбранный период.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && (
        <SettingsPanel settings={settings} setSettings={setSettings} />
      )}

      {formEntry && (
        <EntryForm
          initial={formEntry === "new" ? null : formEntry}
          onClose={() => setFormEntry(null)}
          onSave={(e) => { addEntry(e); setFormEntry(null); }}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, bold }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8e5da", borderRadius: 8, padding: "0.9rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color: "#77756c", fontSize: 13 }}>{icon}{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: bold ? 600 : 500 }}>{money(value)}</div>
    </div>
  );
}

function Row({ label, value, strong, muted }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14, color: muted ? "#77756c" : INK, fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span>
      <span className="num">{money(value)}</span>
    </div>
  );
}

function EntryForm({ initial, onClose, onSave }) {
  const [date, setDate] = useState(initial?.date || todayStr());
  const [revenue, setRevenue] = useState(initial ? String(initial.revenue) : "");
  const [expenses, setExpenses] = useState(
    initial ? (initial.expenses || []).map((x) => ({ category: x.category, amount: String(x.amount) })) : []
  );
  const [error, setError] = useState("");

  function addExpense() { setExpenses((p) => [...p, { category: CATEGORIES[0], amount: "" }]); }
  function updateExpense(i, field, val) { setExpenses((p) => p.map((x, idx) => idx === i ? { ...x, [field]: val } : x)); }
  function removeExpense(i) { setExpenses((p) => p.filter((_, idx) => idx !== i)); }

  function submit() {
    if (!date || revenue === "" || isNaN(parseFloat(revenue))) { setError("Укажи дату и сумму выручки."); return; }
    const parsedExpenses = expenses.filter((x) => x.amount !== "").map((x) => ({ category: x.category, amount: parseFloat(x.amount) || 0 }));
    onSave({ id: initial?.id || uid(), date, revenue: parseFloat(revenue), expenses: parsedExpenses, note: initial?.note || "" });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: PAPER, borderRadius: 10, padding: "1.5rem", width: 420, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{initial ? "Изменить день" : "Внести день"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <label style={{ fontSize: 13, color: "#77756c" }}>Дата</label>
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 10, marginTop: 4 }} />
        <label style={{ fontSize: 13, color: "#77756c" }}>Выручка за день, ₸</label>
        <input type="number" className="field" placeholder="Например, 85000" value={revenue} onChange={(e) => setRevenue(e.target.value)} style={{ marginBottom: 12, marginTop: 4 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <label style={{ fontSize: 13, color: "#77756c" }}>Расходы</label>
          <button className="btn" onClick={addExpense}><Plus size={13} />Добавить</button>
        </div>
        {expenses.map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <select className="field" value={x.category} onChange={(e) => updateExpense(i, "category", e.target.value)} style={{ flex: 1.3 }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" className="field" placeholder="Сумма" value={x.amount} onChange={(e) => updateExpense(i, "amount", e.target.value)} style={{ flex: 1 }} />
            <button onClick={() => removeExpense(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#a9a79c" }}><Trash2 size={15} /></button>
          </div>
        ))}

        {error && <p style={{ color: RUST, fontSize: 13, marginTop: 8 }}>{error}</p>}
        <button className="btn btn-primary" onClick={submit} style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>{initial ? "Сохранить изменения" : "Сохранить"}</button>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, setSettings }) {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);

  function save() { setSettings(local); }
  function updateSavings(i, field, val) {
    setLocal((p) => ({ ...p, savings: p.savings.map((s, idx) => idx === i ? { ...s, [field]: field === "percent" ? Number(val) : val } : s) }));
  }
  function addCategory() { setLocal((p) => ({ ...p, savings: [...p.savings, { name: "Новая категория", percent: 0 }] })); }
  function removeCategory(i) { setLocal((p) => ({ ...p, savings: p.savings.filter((_, idx) => idx !== i) })); }
  const totalPercent = local.savings.reduce((s, x) => s + Number(x.percent || 0), 0);

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 13, color: "#77756c" }}>Оклад тебе, ₸/мес</label>
        <input type="number" className="field" value={local.mySalary} onChange={(e) => setLocal((p) => ({ ...p, mySalary: Number(e.target.value) }))} style={{ marginTop: 4, marginBottom: 12 }} />
        <label style={{ fontSize: 13, color: "#77756c" }}>Оклад сотруднику, ₸/мес</label>
        <input type="number" className="field" value={local.employeeSalary} onChange={(e) => setLocal((p) => ({ ...p, employeeSalary: Number(e.target.value) }))} style={{ marginTop: 4, marginBottom: 12 }} />
        <label style={{ fontSize: 13, color: "#77756c" }}>Налоговая ставка, %</label>
        <input type="number" step="0.1" className="field" value={local.taxRate} onChange={(e) => setLocal((p) => ({ ...p, taxRate: Number(e.target.value) }))} style={{ marginTop: 4 }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 13, color: "#77756c" }}>Распределение остатка после окладов и налога</label>
        <button className="btn" onClick={addCategory}><Plus size={13} />Категория</button>
      </div>
      {local.savings.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input className="field" value={s.name} onChange={(e) => updateSavings(i, "name", e.target.value)} style={{ flex: 1.4 }} />
          <input type="number" className="field" value={s.percent} onChange={(e) => updateSavings(i, "percent", e.target.value)} style={{ flex: 0.6 }} />
          <span style={{ fontSize: 13, color: "#77756c" }}>%</span>
          <button onClick={() => removeCategory(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#a9a79c" }}><Trash2 size={15} /></button>
        </div>
      ))}
      <p style={{ fontSize: 12, color: totalPercent === 100 ? "#77756c" : RUST, marginTop: 4 }}>
        Сумма долей: {totalPercent}% {totalPercent !== 100 && "(проценты будут пересчитаны пропорционально)"}
      </p>

      <button className="btn btn-primary" onClick={save} style={{ marginTop: 16 }}>Сохранить настройки</button>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Готово! Если в проекте включено подтверждение почты — проверь письмо, затем войди.");
      }
    } catch (err) {
      setError(err.message || "Что-то пошло не так.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: PAPER, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');`}</style>
      <form onSubmit={submit} style={{ width: 340, maxWidth: "90vw", background: "#fff", border: "1px solid #e8e5da", borderRadius: 10, padding: "2rem" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px", color: INK }}>Учёт Kaspi-магазина</h1>
        <p style={{ fontSize: 13, color: "#77756c", margin: "0 0 20px" }}>
          {mode === "signin" ? "Войди в свой аккаунт" : "Создай аккаунт для своего магазина"}
        </p>
        <label style={{ fontSize: 13, color: "#77756c" }}>Email</label>
        <input type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 4, marginBottom: 12, width: "100%", boxSizing: "border-box", border: "1px solid #ddd9cc", borderRadius: 4, padding: "7px 9px", fontSize: 14 }} />
        <label style={{ fontSize: 13, color: "#77756c" }}>Пароль</label>
        <input type="password" required minLength={6} className="field" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 4, marginBottom: 16, width: "100%", boxSizing: "border-box", border: "1px solid #ddd9cc", borderRadius: 4, padding: "7px 9px", fontSize: 14 }} />
        {error && <p style={{ color: RUST, fontSize: 13, marginBottom: 12 }}>{error}</p>}
        {info && <p style={{ color: GREEN, fontSize: 13, marginBottom: 12 }}>{info}</p>}
        <button type="submit" disabled={busy} style={{ width: "100%", background: INK, color: "#fff", border: "none", borderRadius: 4, padding: "9px 0", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
          {busy ? "Подождите..." : mode === "signin" ? "Войти" : "Зарегистрироваться"}
        </button>
        <p style={{ fontSize: 13, color: "#77756c", marginTop: 14, textAlign: "center" }}>
          {mode === "signin" ? (
            <>Нет аккаунта? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setError(""); setInfo(""); }} style={{ color: NAVY }}>Зарегистрироваться</a></>
          ) : (
            <>Уже есть аккаунт? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); setError(""); setInfo(""); }} style={{ color: NAVY }}>Войти</a></>
          )}
        </p>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out, object = signed in

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: PAPER, color: "#77756c", fontFamily: "'Inter', system-ui, sans-serif" }}>Загрузка...</div>;
  }
  if (!session) {
    return <AuthScreen />;
  }
  return <Dashboard userId={session.user.id} onSignOut={() => supabase.auth.signOut()} />;
}
