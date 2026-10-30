// TMT-UA data receiver: a Google Apps Script web app (decision 50).
// Deploy as "Execute as: me", "Who has access: anyone"; setup steps are in
// receiver/README.md. The app POSTs one message per finished block:
//
//   { session_id, participant_code, mode, app_version, block,
//     seq?: message number within the session (1, 2, ...),
//     summary?: { column: number | string | boolean | null, ... },
//     log?: any JSON,            -> <logs folder>/<session_id>/<block>.json
//     contact?: { email?, letter?, retest_done_at? } }
//
// summary goes into one row per session in the "sessions" sheet; new keys
// become new columns. contact goes only into the separate contacts
// spreadsheet (decisions 37, 52). main writes to the main storage; pilot and
// dev write to the pilot copies (decision 53). Writing the same message twice
// changes nothing, so the app may safely retry. Messages may arrive out of
// order (beacons sent on page close travel in parallel), so last_block only
// moves forward: a message with a lower seq than one already received does
// not change it.

const RECEIVER_VERSION = '1.1.0';

const STORE_FOR_MODE = { main: 'main', pilot: 'pilot', dev: 'pilot' };

// 'Europe/Kiev' rather than 'Europe/Kyiv': older time zone tables only know
// the former, and an unknown zone silently falls back to GMT.
const TIME_ZONE = 'Europe/Kiev';
const RETEST_INTERVAL_DAYS = 7; // decision 34

const SESSION_COLUMNS = [
  'session_id',
  'participant_code',
  'mode',
  'app_version',
  'received_first_at',
  'received_last_at',
  'last_block',
  'last_seq',
  'log_folder',
];
const CONTACT_COLUMNS = [
  'participant_code',
  'email',
  'created_on',
  'invite_from',
  'invited',
  'retest_done_at',
  'letter',
];
const CONTACT_FIELDS = ['email', 'letter', 'retest_done_at'];
const PAYLOAD_FIELDS = [
  'session_id',
  'participant_code',
  'mode',
  'app_version',
  'block',
  'seq',
  'summary',
  'log',
  'contact',
];

const MAX_BYTES = 5000000;
const MAX_STRING = 5000;
const MAX_SUMMARY_KEYS = 300;
const MAX_COLUMNS = 1000;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const BLOCK_RE = /^[a-z][a-z0-9_]{0,39}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Web app entry points ----------

function doGet() {
  const ready = Boolean(PropertiesService.getScriptProperties().getProperty('main.results'));
  return reply({ ok: true, service: 'tmt-ua-receiver', receiver_version: RECEIVER_VERSION, ready });
}

function doPost(e) {
  const raw = e && e.postData ? e.postData.contents : '';
  if (!raw || raw.length > MAX_BYTES) return reply(invalid('size'));

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return reply(invalid('json'));
  }
  const problem = validatePayload(payload);
  if (problem) return reply(invalid(problem));

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return reply({ ok: false, error: 'busy' });
  try {
    const store = openStorage(STORE_FOR_MODE[payload.mode]);
    writeSession(store, payload);
    if (payload.contact) writeContact(store.contacts(), payload);
    return reply({ ok: true, receiver_version: RECEIVER_VERSION });
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// permanent: resending the same message will not help, so the app stops retrying.
function invalid(detail) {
  return { ok: false, error: 'invalid', detail, permanent: true };
}

// ---------- Validation (pure, covered by tests/test_receiver.py) ----------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function matches(v, re) {
  return typeof v === 'string' && re.test(v);
}

// Returns null for a valid payload, otherwise the name of the first problem.
function validatePayload(p) {
  if (!isPlainObject(p)) return 'payload';
  for (const key of Object.keys(p)) {
    if (PAYLOAD_FIELDS.indexOf(key) === -1) return 'field ' + key;
  }
  if (!matches(p.session_id, ID_RE)) return 'session_id';
  if (!matches(p.participant_code, ID_RE)) return 'participant_code';
  if (!Object.prototype.hasOwnProperty.call(STORE_FOR_MODE, p.mode)) return 'mode';
  if (!matches(p.app_version, VERSION_RE)) return 'app_version';
  if (!matches(p.block, BLOCK_RE)) return 'block';
  if (p.seq !== undefined && !(Number.isInteger(p.seq) && p.seq >= 1 && p.seq <= 100000)) return 'seq';

  if (p.summary !== undefined) {
    if (!isPlainObject(p.summary)) return 'summary';
    const keys = Object.keys(p.summary);
    if (keys.length > MAX_SUMMARY_KEYS) return 'summary size';
    for (const key of keys) {
      // email never goes into the results table (decision 37).
      if (!KEY_RE.test(key) || SESSION_COLUMNS.indexOf(key) !== -1 || key === 'email') {
        return 'summary key ' + key;
      }
      if (!isCellValue(p.summary[key])) return 'summary value ' + key;
    }
  }

  if (p.log !== undefined && (p.log === null || typeof p.log !== 'object')) return 'log';

  if (p.contact !== undefined) {
    const c = p.contact;
    if (!isPlainObject(c)) return 'contact';
    for (const key of Object.keys(c)) {
      if (CONTACT_FIELDS.indexOf(key) === -1) return 'contact field ' + key;
    }
    if (c.email !== undefined && !(matches(c.email, EMAIL_RE) && c.email.length <= 254)) {
      return 'contact email';
    }
    if (c.letter !== undefined && !(typeof c.letter === 'string' && c.letter.length <= MAX_STRING)) {
      return 'contact letter';
    }
    if (
      c.retest_done_at !== undefined &&
      !(typeof c.retest_done_at === 'string' && c.retest_done_at.length <= 40)
    ) {
      return 'contact retest_done_at';
    }
  }
  return null;
}

function isCellValue(v) {
  return (
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && isFinite(v)) ||
    (typeof v === 'string' && v.length <= MAX_STRING)
  );
}

// What actually goes into a cell. A leading apostrophe keeps text that starts
// with "=" from turning into a formula; Sheets does not show or export it.
function cellValue(v) {
  if (v === null) return '';
  if (typeof v === 'string' && v.charAt(0) === '=') return "'" + v;
  return v;
}

// ---------- Writing ----------

function openStorage(store) {
  const props = PropertiesService.getScriptProperties();
  const id = (key) => {
    const value = props.getProperty(store + '.' + key);
    if (!value) throw new Error('Storage is not set up: run setup() first');
    return value;
  };
  return {
    sessions: SpreadsheetApp.openById(id('results')).getSheetByName('sessions'),
    logs: DriveApp.getFolderById(id('logs')),
    contacts: () => SpreadsheetApp.openById(id('contacts')).getSheetByName('contacts'),
  };
}

function writeSession(store, p) {
  const sheet = store.sessions;
  const now = new Date().toISOString();
  const values = Object.assign({}, p.summary, {
    session_id: p.session_id,
    participant_code: p.participant_code,
    mode: p.mode,
    app_version: p.app_version,
    received_last_at: now,
  });
  if (p.log !== undefined) {
    const folder = childFolder(store.logs, p.session_id);
    saveJson(folder, p.block + '.json', p.log);
    values.log_folder = folder.getUrl();
  }

  let row = findRow(sheet, p.session_id);
  if (!row) {
    row = nextRow(sheet);
    values.received_first_at = now;
  }
  if (isNewer(sheet, row, p.seq)) {
    values.last_block = p.block;
    if (p.seq !== undefined) values.last_seq = p.seq;
  }
  writeValues(sheet, row, values);
}

// True unless this session already has a message with a higher or equal seq.
function isNewer(sheet, row, seq) {
  if (seq === undefined) return true;
  const column = ensureColumns(sheet, ['last_seq']).last_seq;
  return !(Number(sheet.getRange(row, column).getValue()) >= seq);
}

function writeContact(sheet, p) {
  const c = p.contact;
  let row = findRow(sheet, p.participant_code);
  const values = {};
  for (const key of CONTACT_FIELDS) {
    if (c[key] !== undefined) values[key] = c[key];
  }
  if (!row) {
    // A retest mark for someone who left no email has nowhere to go.
    if (c.email === undefined) return;
    row = nextRow(sheet);
    const today = new Date();
    const inviteFrom = new Date(today.getTime() + RETEST_INTERVAL_DAYS * 24 * 3600 * 1000);
    values.participant_code = p.participant_code;
    values.created_on = Utilities.formatDate(today, TIME_ZONE, 'yyyy-MM-dd');
    values.invite_from = Utilities.formatDate(inviteFrom, TIME_ZONE, 'yyyy-MM-dd');
    const columns = ensureColumns(sheet, ['invited']);
    sheet.getRange(row, columns.invited).insertCheckboxes();
  }
  writeValues(sheet, row, values);
}

function writeValues(sheet, row, values) {
  const columns = ensureColumns(sheet, Object.keys(values));
  for (const key of Object.keys(values)) {
    const cell = sheet.getRange(row, columns[key]);
    // Text stays text: an id like "1E5..." or a value like "1-2" is not
    // reinterpreted as a number or a date.
    if (typeof values[key] === 'string') cell.setNumberFormat('@');
    cell.setValue(cellValue(values[key]));
  }
}

// Returns { header: column number }, adding headers that are missing.
function ensureColumns(sheet, keys) {
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  const missing = keys.filter((key) => headers.indexOf(key) === -1);
  if (missing.length) {
    if (headers.length + missing.length > MAX_COLUMNS) throw new Error('Too many columns');
    const extra = headers.length + missing.length - sheet.getMaxColumns();
    if (extra > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extra);
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers.push(...missing);
  }
  const columns = {};
  headers.forEach((header, i) => (columns[header] = i + 1));
  return columns;
}

function findRow(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const hit = sheet
    .getRange(2, 1, last - 1, 1)
    .createTextFinder(id)
    .matchCase(true)
    .matchEntireCell(true)
    .findNext();
  return hit ? hit.getRow() : null;
}

function nextRow(sheet) {
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  return row;
}

function childFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function saveJson(folder, name, data) {
  const content = JSON.stringify(data);
  const found = folder.getFilesByName(name);
  if (found.hasNext()) found.next().setContent(content);
  else folder.createFile(name, content, 'application/json');
}

// ---------- One-time setup: run from the editor ----------

// Creates the "TMT-UA" folder with the results and contacts spreadsheets and
// the logs folder, for main and pilot, and prints their links. Running it
// again reuses what exists and recreates only what was deleted.
function setup() {
  const props = PropertiesService.getScriptProperties();
  const root = ensureFolder(props, 'root', 'TMT-UA', null);
  const lines = ['TMT-UA: ' + root.getUrl()];
  for (const store of ['main', 'pilot']) {
    const suffix = store === 'pilot' ? ' — пілот' : '';
    const results = ensureSpreadsheet(
      props, store + '.results', 'TMT-UA — результати' + suffix, 'sessions', SESSION_COLUMNS, root,
    );
    const contacts = ensureSpreadsheet(
      props, store + '.contacts', 'TMT-UA — контакти ретесту' + suffix, 'contacts', CONTACT_COLUMNS, root,
    );
    const logs = ensureFolder(props, store + '.logs', 'TMT-UA — журнали' + suffix, root);
    lines.push(results.getName() + ': ' + results.getUrl());
    lines.push(contacts.getName() + ': ' + contacts.getUrl());
    lines.push(logs.getName() + ': ' + logs.getUrl());
  }
  console.log(lines.join('\n'));
}

function existing(props, key, open) {
  const id = props.getProperty(key);
  if (!id) return null;
  try {
    const item = open(id);
    return item.isTrashed() ? null : item;
  } catch (err) {
    return null;
  }
}

function ensureFolder(props, key, name, parent) {
  const found = existing(props, key, (id) => DriveApp.getFolderById(id));
  if (found) return found;
  const folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function ensureSpreadsheet(props, key, name, sheetName, columns, parent) {
  const found = existing(props, key, (id) => DriveApp.getFileById(id));
  if (found) return found;
  const ss = SpreadsheetApp.create(name);
  // en_US keeps the decimal point in CSV exports, so Jamovi reads numbers as numbers.
  ss.setSpreadsheetLocale('en_US');
  ss.setSpreadsheetTimeZone(TIME_ZONE);
  const sheet = ss.getSheets()[0].setName(sheetName);
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(parent);
  props.setProperty(key, ss.getId());
  return file;
}
