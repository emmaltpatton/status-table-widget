
/* globals JFCustomWidget */
(function () {
  // --------- Utilities ----------
  const el = (sel, ctx = document) => ctx.querySelector(sel);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  const csvToRows = (text) => {
    const rows = []; let row = []; let i = 0; let inQ = false; let cell = '';
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { inQ = false; } }
        else { cell += c; }
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cell.trim()); cell = ''; }
        else if (c === '\n' || c === '\r') {
          if (cell || row.length) { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
          if (c === '\r' && text[i + 1] === '\n') i++;
        } else { cell += c; }
      }
      i++;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows;
  };

  // Allow-listed HTML for Column 1
  function sanitize(html) {
    const allowedTags = new Set(['A','B','STRONG','I','EM','UL','OL','LI','BR','P','SPAN']);
    const allowedAttrs = { 'A': ['href','target','rel'] };
    const tmp = document.createElement('div'); tmp.innerHTML = html || '';
    (function walk(node) {
      const kids = Array.from(node.childNodes);
      for (const n of kids) {
        if (n.nodeType === 1) {
          if (!allowedTags.has(n.tagName)) { n.replaceWith(...Array.from(n.childNodes)); continue; }
          Array.from(n.attributes).forEach(attr => {
            const ok = (allowedAttrs[n.tagName] || []).includes(attr.name.toLowerCase());
            if (!ok) n.removeAttribute(attr.name);
          });
          if (n.tagName === 'A') {
            if (!n.hasAttribute('target')) n.setAttribute('target', '_blank');
            n.setAttribute('rel', 'noopener noreferrer');
          }
          walk(n);
        }
      }
    })(tmp);
    return tmp.innerHTML;
  }

  function toISO(str, fmt) {
    if (!str) return '';
    const v = String(str).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // ISO
    if (fmt === 'DD/MM/YYYY') {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
    if (fmt === 'MM/DD/YYYY') {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    }
    return '';
  }

  function autoHeight() {
    const h = Math.max(document.body.scrollHeight + 20, 360);
    if (window.JFCustomWidget && JFCustomWidget.setHeight) {
      JFCustomWidget.setHeight(h);
    }
  }

  // --------- Model & State ----------
  let SETTINGS = {};
  let ROWS = [];
  let OPTIONS = [];
  let COLORS = {};

  function parseKV(input) {
    const map = {};
    String(input || '').split(';').forEach(pair => {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k && v) map[k] = v;
      }
    });
    return map;
  }

  function fallbackOptions() {
    const fromSetting = String(SETTINGS.ChoiceOptions || '')
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return fromSetting.length ? fromSetting : ['Not started','In progress','Completed'];
  }

  function buildOptions() {
    const remoteURL = SETTINGS.RemoteOptionsURL?.trim();
    const auth = SETTINGS.APIAuthToken?.trim();
    if (remoteURL) {
      return fetch(remoteURL, { headers: auth ? { 'Authorization': `Bearer ${auth}` } : {} })
        .then(r => r.json())
        .then(arr => { OPTIONS = Array.isArray(arr) ? arr.map(String) : []; if (!OPTIONS.length) throw new Error('Empty remote options'); })
        .catch(() => { OPTIONS = fallbackOptions(); });
    }
    OPTIONS = fallbackOptions();
    return Promise.resolve();
  }

  function buildRowsFromSettings() {
    if (SETTINGS.__csvRows && SETTINGS.__csvRows.length) {
      ROWS = SETTINGS.__csvRows.map((r, i) => ({
        id: i + 1,
        col1_html: sanitize(r[0] || ''),
        status: '',
        date: ''
      }));
      return;
    }
    const lines = String(SETTINGS.RowHTML_Defaults || '').split(/\r?\n/)
      .map(s => s.trim()).filter(Boolean);
    ROWS = lines.map((html, i) => ({ id: i + 1, col1_html: sanitize(html), status: '', date: '' }));
  }

  function valueForForm() {
    return {
      columns: [SETTINGS.FirstColumnLabel, SETTINGS.SecondColumnLabel, SETTINGS.ThirdColumnLabel],
      options: OPTIONS,
      meta: { dateFormat: SETTINGS.DateFormat, allowBackdate: !!SETTINGS.AllowBackdate },
      rows: ROWS
    };
  }

  // --------- DOM Builders ----------
  function render() {
    el('#th-col1').textContent = SETTINGS.FirstColumnLabel || 'Item / Requirement';
    el('#th-col2').textContent = SETTINGS.SecondColumnLabel || 'Status';
    el('#th-col3').textContent = SETTINGS.ThirdColumnLabel || 'Date';
    document.documentElement.style.setProperty('--brand', SETTINGS.ThemeColor || '#0f3b5f');

    const tb = document.querySelector('#tbody'); tb.innerHTML = '';
    ROWS.forEach((r) => {
      const tr = document.createElement('tr');

      // Column 1: rich HTML
      const td1 = document.createElement('td'); td1.className = 'p-col1';
      td1.innerHTML = r.col1_html;
      tr.appendChild(td1);

      // Column 2: radio buttons
      const td2 = document.createElement('td');
      const radioGroup = document.createElement('div');
      radioGroup.className = 'p-radio-group';

      OPTIONS.forEach(opt => {
        const label = document.createElement('label');
        label.className = 'p-radio-label';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `status-${r.id}`;
        radio.value = opt;
        radio.className = 'p-radio';

        if (r.status === opt) radio.checked = true;

        radio.addEventListener('change', () => {
          r.status = opt;
          if (r.status && COLORS[r.status]) {
            label.style.color = COLORS[r.status];
          }
          r.date = todayISO();
          dateInput.value = r.date;
          pushDraft();
        });

        label.appendChild(radio);
        label.appendChild(document.createTextNode(opt));
        radioGroup.appendChild(label);
      });

      td2.appendChild(radioGroup);
      tr.appendChild(td2);

      // Column 3: date
      const td3 = document.createElement('td');
      const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.className = 'p-date';
      dateInput.value = toISO(r.date, SETTINGS.DateFormat) || '';
      dateInput.addEventListener('change', () => {
        if (SETTINGS.AllowBackdate === false) {
          dateInput.value = r.date || todayISO();
          return;
        }
        r.date = toISO(dateInput.value, 'YYYY-MM-DD');
        pushDraft();
      });
      td3.appendChild(dateInput);
      tr.appendChild(td3);

      tb.appendChild(tr);
    });

    autoHeight();
  }

  function pushDraft() {
    const msg = { value: JSON.stringify(valueForForm()), valid: true };
    if (window.JFCustomWidget && typeof JFCustomWidget.sendData === 'function') {
      JFCustomWidget.sendData(msg);
    }
    autoHeight();
  }

  // --------- Jotform integration ----------
  function initFromSettings() {
    const name = (k) => JFCustomWidget.getWidgetSetting(k);
    SETTINGS = {
      FirstColumnLabel: name('FirstColumnLabel'),
      SecondColumnLabel: name('SecondColumnLabel'),
      ThirdColumnLabel: name('ThirdColumnLabel'),
      ChoiceOptions: name('ChoiceOptions'),
      RowHTML_Defaults: name('RowHTML_Defaults'),
      CSVSource: name('CSVSource'),
      DateFormat: name('DateFormat') || 'YYYY-MM-DD',
      AllowBackdate: name('AllowBackdate') !== false,
      ThemeColor: name('ThemeColor'),
      RemoteOptionsURL: name('RemoteOptionsURL'),
      APIAuthToken: name('APIAuthToken'),
      KV_StatusColor: name('KV_StatusColor'),
      ExternalCSS: name('ExternalCSS')
    };

    COLORS = parseKV(SETTINGS.KV_StatusColor);

    if (SETTINGS.ExternalCSS) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = SETTINGS.ExternalCSS;
      document.head.appendChild(link);
    }

    return (async () => {
      if (SETTINGS.CSVSource) {
        try {
          const res = await fetch(SETTINGS.CSVSource, { credentials: 'omit' });
          const text = await res.text();
          const arr = csvToRows(text);
          SETTINGS.__csvRows = arr.slice(1).map(r => [r[0] || '']);
        } catch { SETTINGS.__csvRows = []; }
      }
    })();
  }

  function restoreIfProvided(saved) {
    try {
      if (!saved) return false;
      const obj = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (!obj || !Array.isArray(obj.rows)) return false;
      ROWS = obj.rows.map((r, i) => ({
        id: i + 1,
        col1_html: sanitize(r.col1_html || r.col1 || ''),
        status: r.status || '',
        date: toISO(r.date || '', 'YYYY-MM-DD')
      }));
      return true;
    } catch { return false; }
  }

  // --------- Preview Mode Defaults ----------
  const urlParams = new URLSearchParams(window.location.search);
  const devMode = urlParams.has('dev');

  JFCustomWidget.subscribe('ready', async function () {
    await initFromSettings();
    await buildOptions();

    if (devMode) {
      if (!SETTINGS.FirstColumnLabel) SETTINGS.FirstColumnLabel = "Item / Requirement";
      if (!SETTINGS.SecondColumnLabel) SETTINGS.SecondColumnLabel = "Status";
      if (!SETTINGS.ThirdColumnLabel) SETTINGS.ThirdColumnLabel = "Date";
      if (!SETTINGS.RowHTML_Defaults) SETTINGS.RowHTML_Defaults =
        "<b>Policy induction</b><br><i>Read and acknowledge</i>\nDevice setup & VPN\nCreate LMS account & enrol in core modules";
      if (!SETTINGS.ChoiceOptions) SETTINGS.ChoiceOptions = "Not started\nIn progress\nCompleted";
    }

    buildRowsFromSettings();
    render();

    JFCustomWidget.subscribe('submit', function () {
      const payload = { value: JSON.stringify(valueForForm()), valid: true };
      JFCustomWidget.sendSubmit(payload);
    });

    if (JFCustomWidget.subscribe) {
      JFCustomWidget.subscribe('populate', function (data) {
        if (restoreIfProvided(data && (data.value || data))) { render(); }
      });
    }
  });
})();
