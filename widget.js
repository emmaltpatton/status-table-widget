
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

/* ---------------------------
 * Builders
 * --------------------------*/
function buildStatusRadios(rowIndex) {
  const group = document.createElement('div');
  group.className = 'radio-group';

  const options = [
    { id: `complete-${rowIndex}`, label: 'Complete' },
    { id: `na-${rowIndex}`,       label: 'Not Applicable' }
  ];

  options.forEach(opt => {
    const wrap = document.createElement('label');
    wrap.className = 'radio-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `status-${rowIndex}`;
    radio.id = opt.id;

    wrap.appendChild(radio);
    wrap.appendChild(document.createTextNode(opt.label));
    group.appendChild(wrap);
  });

  return group;
}

function buildDatePicker(rowIndex) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'date-input';
  input.id = `date-${rowIndex}`;
  return input;
}

/* ---------------------------
 * Rendering
 * --------------------------*/
function renderStatusTable(tasks) {
  const tbody = document.getElementById('stw-body');
  tbody.innerHTML = '';

  tasks.forEach((task, i) => {
    const tr = document.createElement('tr');

    // Column 1 — initially empty (we'll populate with real text right after)
    const td1 = document.createElement('td');
    td1.className = 'p-col1';
    tr.appendChild(td1);

    // Column 2 — radio group
    const td2 = document.createElement('td');
    td2.appendChild(buildStatusRadios(i));
    tr.appendChild(td2);

    // Column 3 — date picker
    const td3 = document.createElement('td');
    td3.appendChild(buildDatePicker(i));
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
function applyTasksToExistingTable(tasks) {
  const tbody = document.getElementById('stw-body');
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
      td2.appendChild(buildStatusRadios(i));
      tr.appendChild(td2);

      const td3 = document.createElement('td');
      td3.appendChild(buildDatePicker(i));
      tr.appendChild(td3);

      tbody.appendChild(tr);
    }
  }

  // Remove extra rows if tasks shrank
  if (delta < 0) {
    for (let i = 0; i < Math.abs(delta); i++) {
      tbody.removeChild(tbody.lastElementChild);
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
function observeLateRows(tasks) {
  const tbody = document.getElementById('stw-body');
  if (!tbody) return;

  const obs = new MutationObserver(muts => {
    let added = false;
    muts.forEach(m => {
      if (m.type === 'childList' && m.addedNodes.length > 0) added = true;
    });
    if (added) ensureFirstColumnText(tasks, tbody);
  });

  obs.observe(tbody, { childList: true, subtree: true });
}

/* ---------------------------
 * Public API
 * --------------------------*/
const State = {
  tasks: []
};

window.StatusTableWidget = {
  /**
   * Initialize with tasks (array or multi-line string).
   */
  init({ tasks = [] } = {}) {
    State.tasks = parseSeedRows(tasks);
    renderStatusTable(State.tasks);
    observeLateRows(State.tasks);
  },

  /**
   * Update Column 1 at runtime (used by your "Seed rows" setting).
   * Accepts array<string> or multi-line string.
   */
  setTasks(input) {
    State.tasks = parseSeedRows(input);
    applyTasksToExistingTable(State.tasks);
  }
};
