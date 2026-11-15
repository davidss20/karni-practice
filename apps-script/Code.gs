/**
 * סקריפט מחובר לגיליון "מבחני קרני - נתונים".
 * נפרס כ-Web App: הרצה בתור אני, גישה לכל אחד.
 * הלקוח שולח POST עם Content-Type: text/plain וגוף JSON.
 *
 * importQuestions מושך את השאלות מהקובץ הציבורי בגיטהאב:
 * https://raw.githubusercontent.com/davidss20/karni-practice/main/apps-script/questions.json
 */
var QUESTIONS_URL = "https://raw.githubusercontent.com/davidss20/karni-practice/main/apps-script/questions.json";

var QUESTION_HEADERS = ["exam_id", "exam_title", "section", "section_time_min", "q_no", "question", "opt1", "opt2", "opt3", "opt4", "correct", "explanation", "q_id", "kind", "fig_json"];
var USER_HEADERS = ["name", "pin_hash", "created_at"];
var ATTEMPT_HEADERS = ["attempt_id", "name", "exam_id", "exam_title", "started_at", "finished_at", "duration_sec", "total_score", "max_score", "sections_json", "answers_json"];

function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    return json_(handleAction_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handleAction_(body) {
  var action = String(body.action || "");
  if (action === "register") return register_(body);
  if (action === "login") return login_(body);
  if (action === "getQuestions") return getQuestions_(body);
  if (action === "saveAttempt") return saveAttempt_(body);
  if (action === "getHistory") return getHistory_(body);
  if (action === "migrateLegacy") return migrateLegacy_(body);
  throw new Error("פעולה לא מוכרת");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("הסקריפט לא מחובר לגיליון");
  return ss;
}

function ensureSheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (c) { return String(c).trim(); });
  while (existing.length && !existing[existing.length - 1]) existing.pop();
  if (!existing.length || !existing[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  headers.forEach(function (h) {
    if (existing.indexOf(h) === -1) {
      existing.push(h);
      sh.getRange(1, existing.length).setValue(h);
    }
  });
  sh.setFrozenRows(1);
  return sh;
}

function setupSheets_() {
  ensureSheet_("questions", QUESTION_HEADERS);
  ensureSheet_("users", USER_HEADERS);
  ensureSheet_("attempts", ATTEMPT_HEADERS);
}

function readObjects_(sh) {
  var values = sh.getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var any = false;
    for (var i = 0; i < row.length; i++) if (String(row[i] == null ? "" : row[i]).trim() !== "") any = true;
    if (!any) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) if (headers[c]) obj[headers[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function withLock_(fn) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function normalizeName_(name) {
  name = String(name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) throw new Error("השם לא תקין");
  return name;
}

function assertPin_(pin) {
  pin = String(pin || "").trim();
  if (!/^\d{4}$/.test(pin)) throw new Error("הקוד צריך להיות 4 ספרות");
  return pin;
}

function toHex_(bytes) {
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    var s = v.toString(16);
    return s.length === 1 ? "0" + s : s;
  }).join("");
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return toHex_(bytes);
}

function hashPin_(pin, salt) {
  return sha256Hex_(String(salt) + ":" + String(pin));
}

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("TOKEN_SECRET");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("TOKEN_SECRET", s);
  }
  return s;
}

function b64url_(text) {
  return Utilities.base64EncodeWebSafe(String(text), Utilities.Charset.UTF_8).replace(/=+$/g, "");
}

function b64urlDecode_(text) {
  var pad = text.length % 4 === 0 ? "" : "====".slice(text.length % 4);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(text + pad)).getDataAsString();
}

function sign_(payload) {
  return toHex_(Utilities.computeHmacSha256Signature(String(payload), secret_()));
}

function makeToken_(name) {
  var payload = b64url_(JSON.stringify({ n: name, e: Date.now() + 12 * 60 * 60 * 1000 }));
  return payload + "." + sign_(payload);
}

function userFromToken_(token) {
  var parts = String(token || "").split(".");
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) throw new Error("צריך להתחבר מחדש");
  var data;
  try { data = JSON.parse(b64urlDecode_(parts[0])); } catch (e) { throw new Error("צריך להתחבר מחדש"); }
  if (!data || !data.n || Number(data.e) < Date.now()) throw new Error("פג התוקף, צריך להתחבר מחדש");
  return String(data.n);
}

function findUser_(rows, name) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i].name) === name) return rows[i];
  return null;
}

function register_(body) {
  var name = normalizeName_(body.name);
  var pin = assertPin_(body.pin);
  return withLock_(function () {
    setupSheets_();
    var sh = ensureSheet_("users", USER_HEADERS);
    if (findUser_(readObjects_(sh), name)) throw new Error("השם הזה כבר קיים. נסי כניסה.");
    var salt = randomSalt_();
    sh.appendRow([name, salt + "$" + hashPin_(pin, salt), new Date().toISOString()]);
    return { ok: true, name: name, token: makeToken_(name) };
  });
}

function login_(body) {
  var name = normalizeName_(body.name);
  var pin = assertPin_(body.pin);
  setupSheets_();
  var user = findUser_(readObjects_(ensureSheet_("users", USER_HEADERS)), name);
  if (!user) throw new Error("השם לא נמצא. אפשר ליצור משתמש חדש.");
  var parts = String(user.pin_hash || "").split("$");
  if (parts.length !== 2 || hashPin_(pin, parts[0]) !== parts[1]) throw new Error("הקוד לא נכון");
  return { ok: true, name: name, token: makeToken_(name) };
}

function getQuestions_(body) {
  userFromToken_(body.token);
  setupSheets_();
  return { ok: true, questions: readObjects_(ensureSheet_("questions", QUESTION_HEADERS)) };
}

function saveAttempt_(body) {
  var name = userFromToken_(body.token);
  var a = body.attempt || {};
  var id = String(a.attempt_id || "").trim();
  if (!id || id.length > 80) throw new Error("חסר מזהה ניסיון");
  return withLock_(function () {
    setupSheets_();
    var sh = ensureSheet_("attempts", ATTEMPT_HEADERS);
    var rows = readObjects_(sh);
    for (var i = 0; i < rows.length; i++) if (String(rows[i].attempt_id) === id) return { ok: true, duplicate: true };
    sh.appendRow([
      id,
      name,
      a.exam_id == null ? "" : a.exam_id,
      String(a.exam_title || ""),
      String(a.started_at || ""),
      String(a.finished_at || new Date().toISOString()),
      Number(a.duration_sec) || 0,
      Number(a.total_score) || 0,
      Number(a.max_score) || 0,
      JSON.stringify(a.sections || []),
      JSON.stringify(a.answers || {})
    ]);
    return { ok: true };
  });
}

function getHistory_(body) {
  var name = userFromToken_(body.token);
  setupSheets_();
  var rows = readObjects_(ensureSheet_("attempts", ATTEMPT_HEADERS)).filter(function (r) { return String(r.name) === name; });
  return {
    ok: true,
    attempts: rows.map(function (r) {
      var sections = [];
      var answers = {};
      try { sections = JSON.parse(r.sections_json || "[]"); } catch (e) {}
      try { answers = JSON.parse(r.answers_json || "{}"); } catch (e) {}
      return {
        attempt_id: String(r.attempt_id),
        name: name,
        exam_id: r.exam_id,
        exam_title: String(r.exam_title || ""),
        started_at: String(r.started_at || ""),
        finished_at: String(r.finished_at || ""),
        duration_sec: Number(r.duration_sec) || 0,
        total_score: Number(r.total_score) || 0,
        max_score: Number(r.max_score) || 0,
        sections: sections,
        answers: answers
      };
    })
  };
}

function migrateLegacy_(body) {
  if (String(body.name || "").trim() !== "מיכל") throw new Error("אפשר להעביר רק את ההיסטוריה של מיכל");
  var list = body.attempts;
  if (!Array.isArray(list)) throw new Error("רשימה לא תקינה");
  return withLock_(function () {
    setupSheets_();
    var sh = ensureSheet_("attempts", ATTEMPT_HEADERS);
    var seen = {};
    readObjects_(sh).forEach(function (r) { seen[String(r.attempt_id)] = true; });
    var added = 0;
    list.forEach(function (a) {
      if (!a) return;
      var id = String(a.attempt_id || a.id || "").trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      var examId = a.exam_id != null ? a.exam_id : a.examId;
      sh.appendRow([
        id,
        "מיכל",
        examId == null ? "" : examId,
        String(a.exam_title || a.examTitle || ("מבחן " + (examId == null ? "" : examId))),
        String(a.started_at || a.date || ""),
        String(a.finished_at || a.date || ""),
        Number(a.duration_sec != null ? a.duration_sec : a.dur) || 0,
        Number(a.total_score != null ? a.total_score : a.correct) || 0,
        Number(a.max_score != null ? a.max_score : a.total) || 0,
        JSON.stringify(a.sections || []),
        JSON.stringify(a.answers || a.ans || {})
      ]);
      added++;
    });
    return { ok: true, added: added };
  });
}

function cell_(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && isFinite(v)) return v;
  var s = String(v);
  if (s.charAt(0) === "=") return "'" + s;
  return s;
}

function importQuestions() {
  var res = UrlFetchApp.fetch(QUESTIONS_URL, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error("לא הצלחתי להוריד את השאלות (" + code + "). ודאי שהקובץ עלה לגיטהאב: " + QUESTIONS_URL);
  var data = JSON.parse(res.getContentText());
  if (!Array.isArray(data) || !data.length) throw new Error("קובץ השאלות ריק");
  var values = data.map(function (q) {
    return QUESTION_HEADERS.map(function (h) { return cell_(q[h]); });
  });
  return withLock_(function () {
    setupSheets_();
    var sh = ensureSheet_("questions", QUESTION_HEADERS);
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), QUESTION_HEADERS.length)).clearContent();
    }
    sh.getRange(2, 1, values.length, QUESTION_HEADERS.length).setValues(values);
    return "יובאו " + values.length + " שאלות";
  });
}
