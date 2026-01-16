
/* ========================================================================
 * Status Table Widget — Jotform + Standalone compatible
 * - Populates Column 1 from tasks (array or multi-line string)
 * - Reads Jotform Widget parameters via JFCustomWidget
 * - Live-updates Column 1 on settings change (populate)
 * ===================================================================== */

/* ---------------------------
 * Utilities
 * --------------------------*/
function parseSeedRows(input) {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input !== 'string') return [];
  return input
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function ensureFirstColumnText(tasks, root = document) {
  const cells = root.querySelectorAll('td.p-col1');
  cells.forEach((td, i) => {
    if (!td.textContent.trim()) {
      td.textContent = tasks[i] || '';
    }
  });
}

function toArrayLines(maybeString) {
  return parseSeedRows(maybeString || '');
}

function byId(id) {
  return document.getElementById(id);
}

/* ---------------------------
 * Builders
 * --------------------------*/
function buildStatusRadios(rowIndex, options) {
  const group = document.createElement('div');
  group.className = 'radio-group';

  const optList = (options && options.length)
    ? options
    : ['Complete', 'Not Applicable'];

  optList.forEach((label, idx) => {
    const wrap = document.createElement('label');
    wrap.className = 'radio-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `status-${rowIndex}`;
    radio.id = `status-${rowIndex}-${idx}`;

    wrap.appendChild(radio);
    wrap.appendChild(document.createTextNode(label));
    group.appendChild(wrap);
  });

  return group;
}

function buildDatePicker(rowIndex, format /* not enforced here */) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'date-input';
  input.id = `date-${rowIndex}`;
  // NOTE: Native <input type="date"> ignores custom format strings.
  // If you later want a custom format, swap to a JS date picker.
  return input;
}

/* ---------------------------
 * Rendering
 * --------------------------*/
function renderStatusTable(state) {
  const { tasks, choiceOptions, firstColLabel, secondColLabel, thirdColLabel, dateFormat } = state;
  const tbody = byId('stw-body');
  if (!tbody) return;

  // Rebuild thead labels if present
  const thead = document.querySelector('.status-table thead');
  if (thead) {
    const ths = thead.querySelectorAll('th');
    if (ths[0] && firstColLabel) ths[0].textContent = firstColLabel;
    if (ths[1] && secondColLabel) ths[1].textContent = secondColLabel;
    if (ths[2] && thirdColLabel)  ths[2].textContent  = thirdColLabel;
  }

  tbody.innerHTML = '';

  tasks.forEach((task, i) => {
    const tr = document.createElement('tr');

    // Column 1 — initially empty (we'll populate with real text right after)
    const td1 = document.createElement('td');
    td1.className = 'p-col1';
    tr.appendChild(td1);

    // Column 2 — radio group (can be overridden by ChoiceOptions)
    const td2 = document.createElement('td');
    td2.appendChild(buildStatusRadios(i, choiceOptions));
    tr.appendChild(td2);

    // Column 3 — date picker
    const td3 = document.createElement('td');
    td3.appendChild(buildDatePicker(i, dateFormat));
    tr.appendChild(td3);

    tbody.appendChild(tr);
  });

  // Immediately put real text nodes in Column 1
  ensureFirstColumnText(tasks, tbody);
}

/**
 * Update only Column 1 for an existing table body,
 * and add/remove rows if the size changed.
 */
function applyTasksToExistingTable(state) {
  const tbody = byId('stw-body');
  if (!tbody) return;

  const { tasks, choiceOptions, dateFormat } = state;
  const currentRows = Array.from(tbody.querySelectorAll('tr'));
  const delta = tasks.length - currentRows.length;

  // Add rows if we need more
  if (delta > 0) {
    for (let i = currentRows.length; i < tasks.length; i++) {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.className = 'p-col1';
      tr.appendChild(td1);

      const td2 = document.createElement('td');
      td2.appendChild(buildStatusRadios(i, choiceOptions));
      tr.appendChild(td2);

      const td3 = document.createElement('td');
      td3.appendChild(buildDatePicker(i, dateFormat));
      tr.appendChild(td3);

      tbody.appendChild(tr);
    }
  }

  // Remove extra rows if tasks shrank
  if (delta < 0) {
    for (let i = 0; i < Math.abs(delta); i++) {
      if (tbody.lastElementChild) tbody.removeChild(tbody.lastElementChild);
    }
  }

  // Now update Column 1 text
  const cells = tbody.querySelectorAll('td.p-col1');
  cells.forEach((td, i) => {
    td.textContent = tasks[i] || '';
  });
}

/* ---------------------------
 * Observer: keep Column 1 safe if host mutates DOM
 * --------------------------*/
function observeLateRows(state) {
  const tbody = byId('stw-body');
  if (!tbody) return;

  const obs = new MutationObserver(muts => {
    let added = false;
    muts.forEach(m => {
      if (m.type === 'childList' && m.addedNodes.length > 0) added = true;
    });
    if (added) ensureFirstColumnText(state.tasks, tbody);
  });

  obs.observe(tbody, { childList: true, subtree: true });
}

/* ---------------------------
 * Global State
 * --------------------------*/
const State = {
  tasks: [],
  // Optional settings (read from Jotform if provided)
  firstColLabel: 'Task',
  secondColLabel: 'Status',
  thirdColLabel: 'Date',
  choiceOptions: ['Complete', 'Not Applicable'],
  dateFormat: 'YYYY-MM-DD' // Info only; <input type="date"> uses browser locale
};

/* ---------------------------
 * Public API (Standalone-friendly)
 * --------------------------*/
window.StatusTableWidget = {
  /**
   * Initialize with tasks (array or multi-line string) and optional labels/options.
   * When running under Jotform, init is called with settings from getWidgetSetting().
   */
  init(settings = {}) {
    // Accept either { tasks: [...] } or Jotform-style RowHTML_Defaults
    const seed = settings.RowHTML_Defaults ?? settings.tasks ?? '';

    State.tasks = parseSeedRows(seed);

    // Optional labels/options if provided
    if (settings.FirstColumnLabel)  State.firstColLabel  = String(settings.FirstColumnLabel);
    if (settings.SecondColumnLabel) State.secondColLabel = String(settings.SecondColumnLabel);
    if (settings.ThirdColumnLabel)  State.thirdColLabel  = String(settings.ThirdColumnLabel);

    // Single-choice options (one per line)
    if (settings.ChoiceOptions) {
      const opts = toArrayLines(settings.ChoiceOptions);
      if (opts.length) State.choiceOptions = opts;
    }

    // Date format hint (not enforced by native input)
    if (settings.DateFormat) {
      State.dateFormat = String(settings.DateFormat);
    }

    renderStatusTable(State);
    observeLateRows(State);
  },

  /**
   * Update Column 1 at runtime (used by your "Seed rows" setting).
   * Accepts array<string> or multi-line string.
   */
  setTasks(input) {
    State.tasks = parseSeedRows(input);
    applyTasksToExistingTable(State);
  },

  /**
   * Optional helpers if you want to update labels and options live.
   */
  setLabels({ first, second, third } = {}) {
    if (typeof first  === 'string') State.firstColLabel  = first;
    if (typeof second === 'string') State.secondColLabel = second;
    if (typeof third  === 'string') State.thirdColLabel  = third;
    renderStatusTable(State);
  },

  setChoiceOptions(multiLine) {
    const opts = toArrayLines(multiLine);
    if (opts.length) {
      State.choiceOptions = opts;
      renderStatusTable(State);
    }
  }
};

/* -------------------------------------------------------------
   JOTFORM WIDGET INTEGRATION
   - Works only when JFCustomWidget is injected by Jotform.
   - No effect on GitHub standalone usage.
------------------------------------------------------------- */
(function integrateWithJotformIfPresent() {
  if (typeof window.JFCustomWidget === 'undefined') {
    // Standalone mode (e.g., GitHub pages) — nothing to do.
    return;
  }


// 1) On load, fetch initial settings from Jotform
try {
    JFCustomWidget.getWidgetSetting(function(settings) {

        console.log("Settings received from Jotform:", settings);   // <-- ADD THIS

        window.StatusTableWidget.init(settings);

        JFCustomWidget.sendData({ valid: true });
    });
} catch (e) {
    console.warn('JFCustomWidget.getWidgetSetting failed:', e);
}


  // 2) When user clicks "Update Widget" or settings change in panel
  try {
    JFCustomWidget.subscribe('populate', function (settings) {
      // Update only what changed; for Column 1 we care about RowHTML_Defaults
      if (settings && typeof settings.RowHTML_Defaults !== 'undefined') {
        window.StatusTableWidget.setTasks(settings.RowHTML_Defaults);
      }

      // Optional: support live updates for other fields
      if (settings && typeof settings.FirstColumnLabel !== 'undefined') {
        window.StatusTableWidget.setLabels({ first: settings.FirstColumnLabel });
      }
      if (settings && typeof settings.SecondColumnLabel !== 'undefined') {
        window.StatusTableWidget.setLabels({ second: settings.SecondColumnLabel });
      }
      if (settings && typeof settings.ThirdColumnLabel !== 'undefined') {
        window.StatusTableWidget.setLabels({ third: settings.ThirdColumnLabel });
      }
      if (settings && typeof settings.ChoiceOptions !== 'undefined') {
        window.StatusTableWidget.setChoiceOptions(settings.ChoiceOptions);
      }

      // Confirm to Jotform the widget is valid after update
      JFCustomWidget.sendData({ valid: true });
    });
  } catch (e) {
    console.warn('JFCustomWidget.subscribe("populate") failed:', e);
  }
})();

