
/* L&D Table – Question, Single Choice, Date
 * Fully corrected widget.js
 * - Jotform mode (JFCustomWidget present): subscribes to ready/submit and returns value via sendSubmit
 * - Standalone mode (outside Jotform): renders with fallbacks and allows CSV via ?csvUrl=
 * - HTML in Column 1 (p.innerHTML), per-row choices, code, Reload, fallback questions, auto-date
 */

(function () {
  "use strict";

  /************  Mode detection & helpers  ************/
  const insideJotform = typeof window.JFCustomWidget !== "undefined";

  function log(...args) {
    if (window.__LD_DEBUG__) {
      // eslint-disable-next-line no-console
      console.log("[L&D Widget]", ...args);
    }
  }

  function getQueryParam(name) {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get(name);
    } catch {
      return null;
    }
  }

  // Interpret common truthy strings to boolean
  function toBool(v, defaultVal = false) {
    if (v === undefined || v === null) return defaultVal;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(s);
  }

  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }

  function setHeight() {
    try {
      const h = document.body.scrollHeight + 16;
      if (insideJotform && typeof JFCustomWidget.requestFrameResize === "function") {
        JFCustomWidget.requestFrameResize({ height: h });
      }
    } catch { /* no-op */ }
  }

  /************  DOM cache  ************/
  const dom = {
    tbody: null,
    error: null,
    tableTitle: null,
    qHeader: null,
    choiceHeader: null,
    dateHeader: null,
    reloadBtn: null,
    status: null,
  };

  /************  Defaults (also serve standalone)  ************/
  const DEFAULTS = {
    // Labels / headers
    tableTitle: "Learning & Development Evaluation",
    colQuestionHeader: "Question",
    colChoiceHeader: "Response",
    colDateHeader: "Date",

    // Global choices when per-row not supplied
    choices: ["Yes", "No", "N/A"],

    // Behaviour
    enforceRequired: false,
    restrictMaxToday: true,
    updateDateOnChange: false,
    showReloadButton: true,

    // CSV
    csvUrl: "",
    csvText: "",
    csvHasHeader: true,
    csvQuestionColumn: "Question",
    csvChoicesColumn: "Choices",
    csvChoicesDelimiter: "|",
    csvCodeColumn: "Code",
    csvCacheBuster: true,

    // Fallback questions (used when CSV missing/unavailable)
    questions: [
      "Access Employee Portal within PageUp",
      "Complete Workplace Behaviour training",
      "Review HSE Essentials procedures",
    ],
  };

  // Canonical data used for rendering: array of { q (HTML), choices?, code? }
  let ROWS = [];

  /************  Settings loader  ************/
  const PARAMS = [
    "tableTitle",
    "colQuestionHeader", "colChoiceHeader", "colDateHeader",
    "choices",
    "enforceRequired", "restrictMaxToday", "updateDateOnChange", "showReloadButton",
    "csvUrl", "csvText", "csvHasHeader",
    "csvQuestionColumn", "csvChoicesColumn", "csvChoicesDelimiter", "csvCodeColumn", "csvCacheBuster",
    "questions"
  ];

  function readSettings() {
    const cfg = { ...DEFAULTS };

    const gs = (n, def) => {
      try {
        if (insideJotform && typeof JFCustomWidget.getWidgetSetting === "function") {
          const v = JFCustomWidget.getWidgetSetting(n);
          if (v !== undefined && v !== null && v !== "") return v;
        }
      } catch { /* ignore */ }
      // Standalone override via query string (useful for testing)
      const q = getQueryParam(n);
      if (q !== null) return q;
      return def;
    };

    // Text settings
    cfg.tableTitle = gs("tableTitle", cfg.tableTitle);
    cfg.colQuestionHeader = gs("colQuestionHeader", cfg.colQuestionHeader);
    cfg.colChoiceHeader = gs("colChoiceHeader", cfg.colChoiceHeader);
    cfg.colDateHeader = gs("colDateHeader", cfg.colDateHeader);

    // Choices: accept comma-separated or JSON array
    const rawChoices = gs("choices", cfg.choices);
    cfg.choices = Array.isArray(rawChoices)
      ? rawChoices
      : String(rawChoices || "")
          .trim()
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(/, */)
          .map(s => s.replace(/^"+|"+$/g, "").trim())
          .filter(Boolean);

    // Checkboxes / booleans
    cfg.enforceRequired = toBool(gs("enforceRequired", cfg.enforceRequired), cfg.enforceRequired);
    cfg.restrictMaxToday = toBool(gs("restrictMaxToday", cfg.restrictMaxToday), cfg.restrictMaxToday);
    cfg.updateDateOnChange = toBool(gs("updateDateOnChange", cfg.updateDateOnChange), cfg.updateDateOnChange);
    cfg.showReloadButton = toBool(gs("showReloadButton", cfg.showReloadButton), cfg.showReloadButton);

    // CSV
    cfg.csvUrl = String(gs("csvUrl", cfg.csvUrl) || "").trim();
    cfg.csvText = gs("csvText", cfg.csvText);
    cfg.csvHasHeader = toBool(gs("csvHasHeader", cfg.csvHasHeader), cfg.csvHasHeader);
    cfg.csvQuestionColumn = gs("csvQuestionColumn", cfg.csvQuestionColumn);
    cfg.csvChoicesColumn = gs("csvChoicesColumn", cfg.csvChoicesColumn);
    cfg.csvChoicesDelimiter = gs("csvChoicesDelimiter", cfg.csvChoicesDelimiter) || "|";
    cfg.csvCodeColumn = gs("csvCodeColumn", cfg.csvCodeColumn);
    cfg.csvCacheBuster = toBool(gs("csvCacheBuster", cfg.csvCacheBuster), cfg.csvCacheBuster);

    // Fallback questions: allow JSON array or newline text
    const rawQ = gs("questions", cfg.questions);
    if (Array.isArray(rawQ)) {
      cfg.questions = rawQ;
    } else if (typeof rawQ === "string" && rawQ.trim().startsWith("[")) {
      try {
        cfg.questions = JSON.parse(rawQ);
      } catch {
        cfg.questions = rawQ.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      }
    } else if (typeof rawQ === "string") {
      cfg.questions = rawQ.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }

    // Global debug flag via ?debug=true
    window.__LD_DEBUG__ = toBool(getQueryParam("debug"), false);
    log("Settings loaded", cfg);

    return cfg;
  }

  /************  CSV loading & parsing  ************/
  async function loadCsvText(csvUrl, csvText, useCacheBuster) {
    if (csvUrl) {
      const url = useCacheBuster
        ? csvUrl + (csvUrl.includes("?") ? "&" : "?") + "_=" + Date.now()
        : csvUrl;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`CSV HTTP ${resp.status}`);
      return await resp.text();
    }
    return csvText || "";
  }

  function resolveColumn(hasHeader, fields, columnSpecifier) {
    if (!hasHeader) {
      if (typeof columnSpecifier === "number") return columnSpecifier;
      if (/^\d+$/.test(String(columnSpecifier || ""))) return parseInt(columnSpecifier, 10);
      return 0; // default first column
    }
    // has header
    if (typeof columnSpecifier === "string" && !/^\d+$/.test(columnSpecifier)) {
      const idx = (fields || []).indexOf(columnSpecifier);
      return idx >= 0 ? idx : 0;
    }
    if (typeof columnSpecifier === "number") return columnSpecifier;
    if (/^\d+$/.test(String(columnSpecifier || ""))) return parseInt(columnSpecifier, 10);
    return 0;
  }

  function parseCsvToRows(text, hasHeader, questionCol, choicesCol, codeCol, delim) {
    const rowsOut = [];

    // Prefer Papa Parse (handles quotes/newlines). Fallback to naive split.
    if (window.Papa && typeof Papa.parse === "function") {
      const parsed = Papa.parse(text, {
        header: !!hasHeader,
        skipEmptyLines: "greedy",
        transformHeader: h => String(h || "").trim(),
      });
      if (parsed.errors?.length) {
        log("CSV parse warnings", parsed.errors.slice(0, 3));
      }

      if (hasHeader) {
        const fields = parsed.meta?.fields || [];
        const qIdx = resolveColumn(true, fields, questionCol);
        const cIdx = choicesCol != null ? resolveColumn(true, fields, choicesCol) : null;
        const codeIdx = codeCol != null ? resolveColumn(true, fields, codeCol) : null;

        parsed.data.forEach((obj) => {
          const rowArr = fields.map(f => obj[f]);
          const q = String(rowArr[qIdx] ?? "").trim();
          if (!q) return;
          const r = { q }; // HTML allowed
          if (cIdx != null) {
            const rawChoices = String(rowArr[cIdx] ?? "").trim();
            if (rawChoices) r.choices = rawChoices.split(delim).map(s => s.trim()).filter(Boolean);
          }
          if (codeIdx != null) {
