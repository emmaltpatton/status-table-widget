
/* Learning & Development Table – widget.js (Enterprise, 2026-01-15)
 * - Jotform-ready + Standalone
 * - CSV Upload via `csvFile` (file setting), or csvUrl / ?csvUrl / inline csvText
 * - Column mapping: header names or numeric indices
 * - Fallback questions: supports newline, <br>, JSON array
 * - Snapshot + rehydrate across reloads
 * - Height auto-resize in Jotform
 */

(function () {
  "use strict";

  /************  Env detection & helpers  ************/
  const isInIframe = window.self !== window.top;
  const insideJotform = isInIframe && typeof window.JFCustomWidget !== "undefined";

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

  function toBool(v, def = false) {
    if (v === undefined || v === null) return def;
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

  // CSS.escape fallback for older engines
  const CSS_ESCAPE = (window.CSS && CSS.escape) ? window.CSS.escape : (s) =>
    String(s).replace(/"/g, '\\"');

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

  /************  Defaults  ************/
  const DEFAULTS = {
    // Labels
    tableTitle: "Learning & Development Evaluation",
    colQuestionHeader: "Question",
    colChoiceHeader: "Response",
    colDateHeader: "Date",

    // Behaviour
    choices: ["Yes", "No", "N/A"],
    enforceRequired: false,
    restrictMaxToday: true,
    updateDateOnChange: false,
    showReloadButton: true,

    // CSV (all sources)
    csvFile: "",           // Jotform file upload → URL (may be object/array; coerced below)
    csvUrl: "",
    csvText: "",
    csvHasHeader: true,
    csvQuestionColumn: "Question",
    csvChoicesColumn: "Choices",
    csvChoicesDelimiter: "|",
    csvCodeColumn: "Code",
    csvCacheBuster: true,

    // Fallback questions
    questions: [
      "Access Employee Portal within PageUp",
      "Complete Workplace Behaviour training",
      "Review HSE Essentials procedures",
    ],
  };

  const PARAMS = [
    "tableTitle",
    "colQuestionHeader", "colChoiceHeader", "colDateHeader",
    "choices",
    "enforceRequired", "restrictMaxToday", "updateDateOnChange", "showReloadButton",
    "csvFile", "csvUrl", "csvText", "csvHasHeader",
    "csvQuestionColumn", "csvChoicesColumn", "csvChoicesDelimiter", "csvCodeColumn", "csvCacheBuster",
    "questions"
  ];

  let ROWS = [];

  /************  Load settings (Jotform + query overrides)  ************/
  function readSettings() {
    const cfg = { ...DEFAULTS };

    const gs = (n, def) => {
      try {
        if (insideJotform && typeof JFCustomWidget.getWidgetSetting === "function") {
          const v = JFCustomWidget.getWidgetSetting(n);
          if (v !== undefined && v !== null && v !== "") return v;
        }
      } catch {}
      const q = getQueryParam(n);
      if (q !== null) return q;
      return def;
    };

    PARAMS.forEach((key) => {
      const base = DEFAULTS[key];
      const val = gs(key, base);

      if (typeof base === "boolean") {
        cfg[key] = toBool(val, base);
      } else if (Array.isArray(base)) {
        // Arrays like `choices`: accept JSON array or comma-separated text
        if (Array.isArray(val)) {
          cfg[key] = val;
        } else if (typeof val === "string") {
          const s = val.trim();
          if (s.startsWith("[") && s.endsWith("]")) {
            try { cfg[key] = JSON.parse(s); }
            catch {
              cfg[key] = s.split(/, */)
                .map(x => x.replace(/^"+|"+$/g, "").trim())
                .filter(Boolean);
            }
          } else {
            cfg[key] = s.split(/, */)
              .map(x => x.replace(/^"+|"+$/g, "").trim())
              .filter(Boolean);
          }
        } else {
          cfg[key] = base;
        }
      } else {
        cfg[key] = val;
      }
    });

    // Debug via ?debug=true
    window.__LD_DEBUG__ = toBool(getQueryParam("debug"), false);

    // Coerce csvFile → URL string (handles object/array shapes from Jotform)
    (function coerceCsvFile() {
      const v = cfg.csvFile;
      if (!v) return;
      if (typeof v === "object") {
        if (Array.isArray(v) && v.length) {
          cfg.csvFile = v[0]?.url || v[0]?.value || v[0] || "";
        } else {
          cfg.csvFile = v.url || v.value || "";
        }
      }
      cfg.csvFile = String(cfg.csvFile || "").trim();
    })();

    // Normalize `questions` (array, JSON array string, newline text, or HTML with <br>)
    (function normalizeQuestions() {
      const rawQ = cfg.questions;

      if (Array.isArray(rawQ)) {
        cfg.questions = rawQ.map(String).map(s => s.trim()).filter(Boolean);
        return;
      }

      if (typeof rawQ === "string") {
        let s = rawQ.trim()
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/&#13;|&#10;|\r\n|\r/g, "\n");

        if (s.startsWith("[") && s.endsWith("]")) {
          try {
            const arr = JSON.parse(s);
            cfg.questions = Array.isArray(arr)
              ? arr.map(String).map(x => x.trim()).filter(Boolean)
              : [];
            return;
          } catch { /* fall through to newline split */ }
        }

        cfg.questions = s.split("\n").map(t => t.trim()).filter(Boolean);
        return;
      }

      cfg.questions = (DEFAULTS.questions || []).slice();
    })();

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
    // with header: allow header name or numeric index
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
    if (!text) return rowsOut;

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

          const r = { q };
          if (cIdx != null) {
            const rawChoices = String(rowArr[cIdx] ?? "").trim();
            if (rawChoices) {
              r.choices = rawChoices.split(delim).map(s => s.trim()).filter(Boolean);
            }
          }
          if (codeIdx != null) {
            const code = String(rowArr[codeIdx] ?? "").trim();
            if (code) r.code = code;
          }
          rowsOut.push(r);
        });
      } else {
        const qIdx = resolveColumn(false, null, questionCol);
        const cIdx = choicesCol != null ? resolveColumn(false, null, choicesCol) : null;
        const codeIdx = codeCol != null ? resolveColumn(false, null, codeCol) : null;

        parsed.data.forEach((arr) => {
          if (!Array.isArray(arr)) return;
          const q = String(arr[qIdx] ?? "").trim();
          if (!q) return;

          const r = { q };
          if (cIdx != null) {
            const rawChoices = String(arr[cIdx] ?? "").trim();
            if (rawChoices) {
              r.choices = rawChoices.split(delim).map(s => s.trim()).filter(Boolean);
            }
          }
          if (codeIdx != null) {
            const code = String(arr[codeIdx] ?? "").trim();
            if (code) r.code = code;
          }
          rowsOut.push(r);
        });
      }
      return rowsOut;
    }

    // Naive fallback (no quotes/escapes)
    const lines = (text || "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return rowsOut;
    let start = 0;
    let headers = [];
    if (hasHeader) {
      headers = lines[0].split(",").map(s => s.trim());
      start = 1;
    }
    const qIdx = resolveColumn(hasHeader, headers, questionCol);
    const cIdx = choicesCol != null ? resolveColumn(hasHeader, headers, choicesCol) : null;
    const codeIdx = codeCol != null ? resolveColumn(hasHeader, headers, codeCol) : null;

    for (let i = start; i < lines.length; i++) {
      const cells = lines[i].split(",").map(s => s.trim());
      const q = String(cells[qIdx] ?? "").trim();
      if (!q) continue;

      const r = { q };
      if (cIdx != null) {
        const rawChoices = String(cells[cIdx] ?? "").trim();
        if (rawChoices) r.choices = rawChoices.split(delim).map(s => s.trim()).filter(Boolean);
      }
      if (codeIdx != null) {
        const code = String(cells[codeIdx] ?? "").trim();
        if (code) r.code = code;
      }
      rowsOut.push(r);
    }
    return rowsOut;
  }

  async function getRowsFromConfig(cfg) {
    // Priority: uploaded CSV → ?csvUrl override → csvUrl → csvText → fallback
    const qsCsv = getQueryParam("csvUrl");
    const effectiveCsvUrl = cfg.csvFile || qsCsv || cfg.csvUrl;

    if (effectiveCsvUrl || cfg.csvText) {
      try {
        const text = await loadCsvText(effectiveCsvUrl, cfg.csvText, cfg.csvCacheBuster);
        const rows = parseCsvToRows(
          text,
          cfg.csvHasHeader,
          cfg.csvQuestionColumn,
          cfg.csvChoicesColumn || null,
          cfg.csvCodeColumn || null,
          cfg.csvChoicesDelimiter || "|"
        );
        if (rows?.length) return rows;
      } catch (e) {
        log("CSV load failed; will fallback to questions", e);
      }
    }

    // Fallback: questions array
    return (cfg.questions || []).map(q => ({ q }));
  }

  /************  UI  ************/
  function setStatus(msg) {
    if (dom.status) dom.status.textContent = msg || "";
  }

  function setError(msg) {
    if (!dom.error) return;
    if (!msg) { dom.error.hidden = true; dom.error.textContent = ""; return; }
    dom.error.hidden = false;
    dom.error.textContent = msg;
  }

  function applyHeaders(cfg) {
    if (dom.tableTitle) dom.tableTitle.textContent = cfg.tableTitle;
    if (dom.qHeader) dom.qHeader.textContent = cfg.colQuestionHeader;
    if (dom.choiceHeader) dom.choiceHeader.textContent = cfg.colChoiceHeader;
    if (dom.dateHeader) dom.dateHeader.textContent = cfg.colDateHeader;
    if (dom.reloadBtn) dom.reloadBtn.style.display = cfg.showReloadButton ? "inline-flex" : "none";
  }

  function renderTable(rows, cfg) {
    dom.tbody.innerHTML = "";
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");

      // Column 1: Question (HTML allowed)
      const tdQ = document.createElement("td");
      const p = document.createElement("p");
      p.className = "q";
      p.innerHTML = row.q;
      p.setAttribute("aria-readonly", "true");
      tdQ.appendChild(p);
      tr.appendChild(tdQ);

      // Column 2: Radios
      const tdChoice = document.createElement("td");
      tdChoice.className = "choice-cell";
      const groupName = `row-${rowIndex}-choice`;

      const group = document.createElement("div");
      group.className = "radio-group";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", `${stripHtml(row.q)} response`);

      const options = Array.isArray(row.choices) && row.choices.length
        ? row.choices
        : cfg.choices;

      options.forEach((label, idx) => {
        const id = `${groupName}-${idx}`;
        const wrap = document.createElement("div");
        wrap.className = "radio-wrap";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = groupName;
        input.id = id;
        input.value = label;

        const lab = document.createElement("label");
        lab.setAttribute("for", id);
        lab.textContent = label;

        wrap.appendChild(input);
        wrap.appendChild(lab);
        group.appendChild(wrap);
      });

      tdChoice.appendChild(group);
      tr.appendChild(tdChoice);

      // Column 3: Date
      const tdDate = document.createElement("td");
      const date = document.createElement("input");
      date.type = "date";
      date.className = "date";
      date.placeholder = "YYYY-MM-DD";
      if (cfg.restrictMaxToday) date.max = todayStr();
      tdDate.appendChild(date);
      tr.appendChild(tdDate);

      // Auto-set date on change
      group.addEventListener("change", () => {
        const shouldSet = cfg.updateDateOnChange || !date.value;
        if (shouldSet) {
          const t = todayStr();
          date.value = t;
          if (cfg.restrictMaxToday) date.max = t;
        }
        setHeight();
      });

      date.addEventListener("input", setHeight);
      dom.tbody.appendChild(tr);
    });

    setHeight();
  }

  function collectData(rows) {
    const out = [];
    const trs = dom.tbody.querySelectorAll("tr");
    trs.forEach((tr) => {
      const qHtml = tr.querySelector(".q")?.innerHTML ?? "";
      const qText = stripHtml(qHtml);
      const choice = tr.querySelector('input[type="radio"]:checked')?.value ?? "";
      const date = tr.querySelector('input[type="date"]')?.value ?? "";

      const meta = rows.find(r => stripHtml(r.q) === qText);
      const code = meta?.code;

      const rowOut = { question: qText, choice, date };
      if (code) rowOut.code = code;
      out.push(rowOut);
    });
    return out;
  }

  function validateAllAnswered(cfg) {
    if (!cfg.enforceRequired) return { valid: true, message: "" };
    const missing = Array.from(dom.tbody.querySelectorAll("tr"))
      .some(tr => !tr.querySelector('input[type="radio"]:checked'));
    if (missing) {
      return { valid: false, message: "Please answer all rows before submitting." };
    }
    return { valid: true, message: "" };
  }

  /************  Fetch & render  ************/
  async function fetchAndRender(cfg, { preserve = true } = {}) {
    const snapshot = preserve ? collectData(ROWS) : [];
    setStatus("Loading…");
    if (dom.reloadBtn) dom.reloadBtn.disabled = true;

    try {
      const rows = await getRowsFromConfig(cfg);
      ROWS = rows;
      setError("");
      applyHeaders(cfg);
      renderTable(ROWS, cfg);

      // Rehydrate by matching by question text
      if (snapshot.length) {
        snapshot.forEach(s => {
          const tr = Array.from(dom.tbody.querySelectorAll("tr"))
            .find(tr0 => stripHtml(tr0.querySelector(".q")?.innerHTML || "") === s.question);
          if (!tr) return;
          if (s.choice) {
            const input = tr.querySelector(`input[type="radio"][value="${CSS_ESCAPE(s.choice)}"]`);
            if (input) input.checked = true;
          }
          if (s.date) {
            const date = tr.querySelector('input[type="date"]');
            if (date) date.value = s.date;
          }
        });
      }
    } catch (err) {
      log("CSV load failed; using fallback questions", err);
      setError("Could not load CSV questions. Using fallback list.");
      if (!ROWS.length) {
        ROWS = (DEFAULTS.questions || []).map(q => ({ q }));
        applyHeaders(cfg);
        renderTable(ROWS, cfg);
      }
    } finally {
      setStatus("");
      if (dom.reloadBtn) dom.reloadBtn.disabled = false;
      setHeight();
    }
  }

  /************  Init  ************/
  async function init() {
    // DOM refs
    dom.tbody = document.getElementById("tbody");
    dom.error = document.getElementById("error");
    dom.tableTitle = document.getElementById("tableTitle");
    dom.qHeader = document.getElementById("qHeader");
    dom.choiceHeader = document.getElementById("choiceHeader");
    dom.dateHeader = document.getElementById("dateHeader");
    dom.reloadBtn = document.getElementById("reloadBtn");
    dom.status = document.getElementById("status");

    // Settings + headers
    const cfg = readSettings();
    applyHeaders(cfg);

    // Reload
    if (dom.reloadBtn) {
      dom.reloadBtn.addEventListener("click", () => {
        fetchAndRender(cfg, { preserve: true }).catch(e => log("Reload error", e));
      });
    }

    // First render
    await fetchAndRender(cfg, { preserve: false });

    // Rehydrate saved Jotform value (if exists)
    try {
      if (insideJotform && typeof JFCustomWidget.getValue === "function") {
        const existing = JFCustomWidget.getValue();
        if (existing) {
          let saved;
          try { saved = typeof existing === "string" ? JSON.parse(existing) : existing; } catch {}
          if (Array.isArray(saved)) {
            saved.forEach(s => {
              const tr = Array.from(dom.tbody.querySelectorAll("tr"))
                .find(tr0 => stripHtml(tr0.querySelector(".q")?.innerHTML || "") === s.question);
              if (!tr) return;
              if (s.choice) {
                const input = tr.querySelector(`input[type="radio"][value="${CSS_ESCAPE(s.choice)}"]`);
                if (input) input.checked = true;
              }
              if (s.date) {
                const date = tr.querySelector('input[type="date"]');
                if (date) date.value = s.date;
              }
            });
          }
        }
      }
    } catch { /* ignore */ }

    setHeight();

    // Submit
    if (insideJotform) {
      JFCustomWidget.subscribe("submit", function () {
        const check = validateAllAnswered(cfg);
        if (!check.valid) {
          setError(check.message);
          JFCustomWidget.sendSubmit({ valid: false });
          return;
        }
        setError("");
        const value = collectData(ROWS);
        JFCustomWidget.sendSubmit({ valid: true, value: JSON.stringify(value) });
      });
    } else {
      // Standalone dev helper
      if (!document.getElementById("ld-log-btn")) {
        const btn = document.createElement("button");
        btn.id = "ld-log-btn";
        btn.className = "btn";
        btn.style.margin = "10px 0";
        btn.textContent = "Log Data (Standalone Test)";
        btn.addEventListener("click", () => {
          const value = collectData(ROWS);
          // eslint-disable-next-line no-console
          console.log("L&D Widget value:", value);
          alert("Open the browser console to see the collected data.");
        });
        (document.querySelector(".container") || document.body).appendChild(btn);
      }
    }
  }

  /************  Bootstrap (Jotform + fallback)  ************/
  try {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      init().catch(e => log("init error", e));
    };

    if (insideJotform && typeof JFCustomWidget?.subscribe === "function") {
      JFCustomWidget.subscribe("ready", () => {
        log("JFCustomWidget ready");
        start();
      });
      // In case not truly inside JF iframe, still start
      setTimeout(() => { if (!started) start(); }, 800);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        log("Standalone mode");
        start();
      });
    }
  } catch (e) {
    log("bootstrap error", e);
    document.addEventListener("DOMContentLoaded", () =>
      init().catch(err => log("init error", err))
    );
  }
})();
