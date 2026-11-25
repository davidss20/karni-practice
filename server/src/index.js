import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { db, countQuestions } from "./db.js";
import { importWorkbook, upsertExam } from "./importer.js";

const PORT = Number(process.env.PORT || 8080);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}

function makePinHash(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}$${hashPin(pin, salt)}`;
}

function checkPin(pin, stored) {
  const [salt, hash] = String(stored || "").split("$");
  if (!salt || !hash) return false;
  const got = hashPin(pin, salt);
  if (got.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(hash));
}

function cookieToken(req) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  const hit = parts.find((p) => p.startsWith("karni_session="));
  return hit ? decodeURIComponent(hit.slice("karni_session=".length)) : "";
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token) || null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ ok: false, error: "צריך להתחבר" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  if (ADMIN_TOKEN && bearer(req) === ADMIN_TOKEN) return { id: 0, name: "mcp", role: "admin" };
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.status(403).json({ ok: false, error: "רק למנהל" });
    return null;
  }
  return user;
}

function cookieFlags(req) {
  return req.secure ? "; Secure" : "";
}

function setSession(res, req, token) {
  res.setHeader("Set-Cookie", `karni_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${cookieFlags(req)}`);
}

function clearSession(res, req) {
  res.setHeader("Set-Cookie", `karni_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieFlags(req)}`);
}

function validPin(pin) {
  return /^\d{4}$/.test(String(pin || "").trim());
}

function publicQuestion(q) {
  return {
    id: q.id,
    qNo: q.q_no,
    topic: q.topic,
    secType: q.sec_type,
    kind: q.kind,
    stem: q.stem,
    options: [q.opt1, q.opt2, q.opt3, q.opt4],
    figure: q.figure || "",
    imageKey: q.image_key || "",
    context: q.context || "",
    extra: q.extra || "",
    noshuffle: q.noshuffle === 1,
  };
}

function examSummary(userId) {
  const exams = db.prepare(
    `SELECT e.id, e.title, e.kind,
            (SELECT COUNT(*) FROM sections s WHERE s.exam_id = e.id) AS sections,
            (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS questions,
            (SELECT COALESCE(SUM(s.minutes), 0) FROM sections s WHERE s.exam_id = e.id) AS minutes
     FROM exams e
     WHERE e.id != 'practice'
     ORDER BY e.sort_order, e.id`
  ).all();
  const attempts = db.prepare(
    `SELECT exam_id AS examId, pct, finished_at AS finishedAt
     FROM attempts WHERE user_id = ? AND exam_id IS NOT NULL
     ORDER BY finished_at`
  ).all(userId);
  return exams.map((exam) => {
    const mine = attempts.filter((a) => String(a.examId) === String(exam.id));
    const last = mine[mine.length - 1] || null;
    const best = mine.reduce((m, a) => Math.max(m, a.pct), -1);
    return {
      ...exam,
      attempts: mine.length,
      best: mine.length ? best : null,
      last: last ? { pct: last.pct, finishedAt: last.finishedAt } : null,
    };
  });
}

function ensureAdmin() {
  const name = (process.env.ADMIN_NAME || "דוד").trim();
  const pin = String(process.env.ADMIN_PIN || "").trim();
  if (!validPin(pin)) {
    console.warn("ADMIN_PIN חסר או אינו 4 ספרות. לא נוצר משתמש מנהל.");
    return;
  }
  const existing = db.prepare("SELECT id, role FROM users WHERE name = ?").get(name);
  if (!existing) {
    db.prepare("INSERT INTO users (name, pin_hash, role, created_at) VALUES (?, ?, 'admin', ?)").run(
      name, makePinHash(pin), new Date().toISOString()
    );
    console.log(`נוצר מנהל: ${name}`);
  } else {
    db.prepare("UPDATE users SET role = 'admin', pin_hash = ? WHERE id = ?").run(makePinHash(pin), existing.id);
  }
}

function seed() {
  if (countQuestions() > 0 && process.env.REIMPORT !== "1") return;
  const file = process.env.XLSX_PATH || path.join(process.cwd(), "data", "karni-questions.xlsx");
  if (!fs.existsSync(file)) {
    console.warn("אין קובץ שאלות לייבוא:", file);
    return;
  }
  const result = importWorkbook(file);
  console.log(`יובאו ${result.exams} מבחנים, ${result.questions} שאלות, ${result.images} תמונות`);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    questions: countQuestions(),
    exams: db.prepare("SELECT COUNT(*) AS n FROM exams").get().n,
    images: db.prepare("SELECT COUNT(*) AS n FROM images").get().n,
  });
});

const loginFails = new Map();
function locked(key) {
  const row = loginFails.get(key);
  if (!row) return false;
  if (Date.now() - row.at > 15 * 60 * 1000) {
    loginFails.delete(key);
    return false;
  }
  return row.n >= 8;
}
function markFail(key) {
  const row = loginFails.get(key);
  if (!row || Date.now() - row.at > 15 * 60 * 1000) loginFails.set(key, { n: 1, at: Date.now() });
  else loginFails.set(key, { n: row.n + 1, at: Date.now() });
}

app.post("/api/auth/register", (req, res) => {
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
  const pin = String(req.body?.pin || "").trim();
  if (!name || name.length > 40) return res.status(400).json({ ok: false, error: "צריך שם" });
  if (!validPin(pin)) return res.status(400).json({ ok: false, error: "הקוד צריך להיות 4 ספרות" });
  if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(name)) {
    return res.status(409).json({ ok: false, error: "השם הזה כבר קיים. נסי כניסה." });
  }
  const info = db.prepare(
    "INSERT INTO users (name, pin_hash, role, created_at) VALUES (?, ?, 'student', ?)"
  ).run(name, makePinHash(pin), new Date().toISOString());
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, info.lastInsertRowid, new Date().toISOString());
  setSession(res, req, token);
  res.json({ ok: true, user: { name, role: "student" } });
});

app.post("/api/auth/login", (req, res) => {
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
  const pin = String(req.body?.pin || "").trim();
  const ip = req.ip || req.socket.remoteAddress || "";
  const key = `${ip}|${name}`;
  if (locked(key)) return res.status(429).json({ ok: false, error: "יותר מדי ניסיונות. נסי שוב בעוד רבע שעה." });
  const user = db.prepare("SELECT id, name, role, pin_hash FROM users WHERE name = ?").get(name);
  if (!user || !checkPin(pin, user.pin_hash)) {
    markFail(key);
    return res.status(401).json({ ok: false, error: "השם או הקוד לא נכונים" });
  }
  loginFails.delete(key);
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, user.id, new Date().toISOString());
  setSession(res, req, token);
  res.json({ ok: true, user: { name: user.name, role: user.role } });
});

app.post("/api/auth/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  clearSession(res, req);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { name: user.name, role: user.role } });
});

app.get("/api/home", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const attempts = db.prepare(
    `SELECT id, exam_id AS examId, exam_title AS examTitle, finished_at AS finishedAt,
            duration_sec AS durationSec, correct, total, pct, sections_json AS sectionsJson
     FROM attempts WHERE user_id = ? ORDER BY finished_at`
  ).all(user.id).map((a) => ({ ...a, sections: JSON.parse(a.sectionsJson), sectionsJson: undefined }));
  res.json({ ok: true, exams: examSummary(user.id), attempts, inProgress: readProgress(user.id) });
});

function cleanAnswers(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (!key || !Number.isInteger(n) || n < 0 || n > 3) continue;
    out[String(key).slice(0, 80)] = n;
    if (Object.keys(out).length >= 400) break;
  }
  return out;
}

function readProgress(userId) {
  const row = db.prepare(
    `SELECT exam_id AS examId, section_index AS sectionIndex, phase, answers_json AS answersJson,
            section_times_json AS sectionTimesJson, remaining_sec AS remainingSec, started_at AS startedAt
     FROM in_progress WHERE user_id = ?`
  ).get(userId);
  if (!row) return null;
  return {
    examId: row.examId,
    sectionIndex: row.sectionIndex,
    phase: row.phase === "run" ? "run" : "pre",
    answers: JSON.parse(row.answersJson || "{}"),
    sectionTimes: JSON.parse(row.sectionTimesJson || "[]"),
    remainingSec: row.remainingSec,
    startedAt: row.startedAt,
  };
}

app.put("/api/in-progress", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const examId = String(req.body?.examId || "");
  const exam = db.prepare("SELECT id FROM exams WHERE id = ?").get(examId);
  if (!exam) return res.status(404).json({ ok: false, error: "המבחן לא נמצא" });
  const count = db.prepare("SELECT COUNT(*) AS n FROM sections WHERE exam_id = ?").get(examId).n;
  const sectionIndex = Number(req.body?.sectionIndex);
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= count) {
    return res.status(400).json({ ok: false, error: "הפרק לא נמצא" });
  }
  const phase = req.body?.phase === "run" ? "run" : "pre";
  const times = Array.isArray(req.body?.sectionTimes)
    ? req.body.sectionTimes.slice(0, 40).map((n) => Math.max(0, Math.round(Number(n) || 0)))
    : [];
  const remaining = req.body?.remainingSec == null ? null : Math.max(0, Math.round(Number(req.body.remainingSec) || 0));
  const startedAt = String(req.body?.startedAt || new Date().toISOString()).slice(0, 40);
  db.prepare(
    `INSERT INTO in_progress (user_id, exam_id, section_index, phase, answers_json, section_times_json, remaining_sec, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       exam_id = excluded.exam_id, section_index = excluded.section_index, phase = excluded.phase,
       answers_json = excluded.answers_json, section_times_json = excluded.section_times_json,
       remaining_sec = excluded.remaining_sec, started_at = excluded.started_at, updated_at = excluded.updated_at`
  ).run(
    user.id, examId, sectionIndex, phase,
    JSON.stringify(cleanAnswers(req.body?.answers)),
    JSON.stringify(times),
    remaining,
    startedAt,
    new Date().toISOString()
  );
  res.json({ ok: true });
});

app.delete("/api/in-progress", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  db.prepare("DELETE FROM in_progress WHERE user_id = ?").run(user.id);
  res.json({ ok: true });
});

app.get("/api/exams/:id", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const exam = db.prepare("SELECT id, title, kind FROM exams WHERE id = ?").get(req.params.id);
  if (!exam) return res.status(404).json({ ok: false, error: "המבחן לא נמצא" });
  const sections = db.prepare(
    "SELECT id, section_key AS sectionKey, title, topic, minutes, position FROM sections WHERE exam_id = ? ORDER BY position"
  ).all(exam.id);
  const questions = db.prepare(
    "SELECT * FROM questions WHERE exam_id = ? ORDER BY q_no"
  ).all(exam.id);
  res.json({
    ok: true,
    exam: {
      ...exam,
      sections: sections.map((section) => ({
        ...section,
        questions: questions.filter((q) => q.section_id === section.id).map(publicQuestion),
      })),
    },
  });
});

app.post("/api/attempts", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const examId = String(req.body?.examId || "");
  const exam = db.prepare("SELECT id, title FROM exams WHERE id = ?").get(examId);
  if (!exam) return res.status(404).json({ ok: false, error: "המבחן לא נמצא" });
  const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  const sectionTimes = Array.isArray(req.body?.sectionTimes) ? req.body.sectionTimes : [];
  const sections = db.prepare(
    "SELECT id, section_key AS sectionKey, title FROM sections WHERE exam_id = ? ORDER BY position"
  ).all(exam.id);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id = ?").all(exam.id);
  let correct = 0;
  const sectionStats = sections.map((section, index) => {
    const mine = questions.filter((q) => q.section_id === section.id);
    let c = 0;
    mine.forEach((q) => {
      const choice = answers[q.id];
      if (Number(choice) === q.correct) c += 1;
    });
    correct += c;
    return {
      id: section.sectionKey,
      title: section.title,
      c,
      n: mine.length,
      t: Number(sectionTimes[index]) || 0,
    };
  });
  const total = questions.length;
  const pct = total ? Math.round((100 * correct) / total) : 0;
  const duration = sectionStats.reduce((sum, s) => sum + (s.t || 0), 0);
  const id = `a${Date.now()}${crypto.randomBytes(3).toString("hex")}`;
  const finished = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO attempts (id, user_id, exam_id, exam_title, started_at, finished_at, duration_sec, correct, total, pct, sections_json, answers_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, user.id, exam.id, exam.title,
      String(req.body?.startedAt || finished), finished, duration, correct, total, pct,
      JSON.stringify(sectionStats), JSON.stringify(answers)
    );
    db.prepare("DELETE FROM in_progress WHERE user_id = ?").run(user.id);
  })();
  const wrong = questions.filter((q) => Number(answers[q.id]) !== q.correct).map((q) => ({
    ...publicQuestion(q),
    correctIndex: q.correct,
    chosen: answers[q.id] == null ? null : Number(answers[q.id]),
    explanation: q.explanation || "",
    sectionTitle: sections.find((s) => s.id === q.section_id)?.title || "",
  }));
  res.json({
    ok: true,
    attempt: { id, examId: exam.id, examTitle: exam.title, finishedAt: finished, durationSec: duration, correct, total, pct, sections: sectionStats, wrong },
  });
});

app.get("/api/attempts/:id", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const row = db.prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?").get(req.params.id, user.id);
  if (!row) return res.status(404).json({ ok: false, error: "הניסיון לא נמצא" });
  res.json({
    ok: true,
    attempt: {
      id: row.id,
      examId: row.exam_id,
      examTitle: row.exam_title,
      finishedAt: row.finished_at,
      durationSec: row.duration_sec,
      correct: row.correct,
      total: row.total,
      pct: row.pct,
      sections: JSON.parse(row.sections_json),
    },
  });
});

app.get("/api/practice", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const mode = String(req.query.mode || "topic");
  const topic = String(req.query.topic || "");
  const section = String(req.query.section || "");
  const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 10));
  let rows = [];
  if (mode === "weak") {
    const attempts = db.prepare("SELECT answers_json FROM attempts WHERE user_id = ?").all(user.id);
    const misses = new Map();
    attempts.forEach((a) => {
      const answers = JSON.parse(a.answers_json || "{}");
      const ids = Object.keys(answers);
      if (!ids.length) return;
      const found = db.prepare(
        `SELECT id, correct FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`
      ).all(...ids);
      found.forEach((q) => {
        if (Number(answers[q.id]) !== q.correct) misses.set(q.id, (misses.get(q.id) || 0) + 1);
      });
    });
    const ranked = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    if (ranked.length) {
      rows = db.prepare(
        `SELECT * FROM questions WHERE id IN (${ranked.map(() => "?").join(",")})`
      ).all(...ranked);
    }
  } else {
    const where = [];
    const params = [];
    if (topic) { where.push("topic = ?"); params.push(topic); }
    if (section) { where.push("sec_type = ?"); params.push(section); }
    const sql = `SELECT * FROM questions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY RANDOM() LIMIT ?`;
    rows = db.prepare(sql).all(...params, limit);
  }
  res.json({ ok: true, questions: rows.map(publicQuestion) });
});

app.post("/api/practice/check", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const q = db.prepare("SELECT correct, explanation, opt1, opt2, opt3, opt4 FROM questions WHERE id = ?").get(String(req.body?.id || ""));
  if (!q) return res.status(404).json({ ok: false, error: "השאלה לא נמצאה" });
  const choice = Number(req.body?.choice);
  res.json({
    ok: true,
    right: choice === q.correct,
    correctIndex: q.correct,
    explanation: q.explanation || "",
  });
});

app.get(/^\/api\/images\/(.+)$/, (req, res) => {
  const key = decodeURIComponent(req.params[0] || "");
  const row = db.prepare("SELECT data_url FROM images WHERE key = ?").get(key);
  if (!row) return res.status(404).end();
  const match = String(row.data_url).match(/^data:(.+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  res.setHeader("Content-Type", match[1]);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(match[2], "base64"));
});

app.get("/api/admin/overview", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const users = db.prepare(
    `SELECT u.id, u.name, u.role, u.created_at AS createdAt,
            COUNT(a.id) AS attempts,
            ROUND(AVG(a.pct)) AS avgPct,
            MAX(a.pct) AS best,
            MAX(a.finished_at) AS lastAt
     FROM users u LEFT JOIN attempts a ON a.user_id = u.id
     GROUP BY u.id ORDER BY u.name`
  ).all();
  const recent = db.prepare(
    `SELECT a.finished_at AS finishedAt, a.exam_title AS examTitle, a.pct, a.correct, a.total, u.name
     FROM attempts a JOIN users u ON u.id = a.user_id
     ORDER BY a.finished_at DESC LIMIT 40`
  ).all();
  res.json({ ok: true, users, recent });
});

function userProgress(userId) {
  const attempts = db.prepare(
    `SELECT id, exam_id AS examId, exam_title AS examTitle, finished_at AS finishedAt,
            duration_sec AS durationSec, correct, total, pct, sections_json AS sectionsJson
     FROM attempts WHERE user_id = ? ORDER BY finished_at`
  ).all(userId).map((a) => ({ ...a, sections: JSON.parse(a.sectionsJson), sectionsJson: undefined }));
  return { exams: examSummary(userId), attempts };
}

app.post("/api/admin/users", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
  const pin = String(req.body?.pin || "").trim();
  if (!name || name.length > 40) return res.status(400).json({ ok: false, error: "צריך שם" });
  if (!validPin(pin)) return res.status(400).json({ ok: false, error: "הקוד צריך להיות 4 ספרות" });
  if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(name)) {
    return res.status(409).json({ ok: false, error: "השם הזה כבר קיים" });
  }
  const info = db.prepare(
    "INSERT INTO users (name, pin_hash, role, created_at) VALUES (?, ?, 'student', ?)"
  ).run(name, makePinHash(pin), new Date().toISOString());
  res.json({ ok: true, user: { id: info.lastInsertRowid, name, role: "student" } });
});

app.get("/api/admin/users/:id", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const person = db.prepare("SELECT id, name, role, created_at AS createdAt FROM users WHERE id = ?").get(req.params.id);
  if (!person) return res.status(404).json({ ok: false, error: "המשתמש לא נמצא" });
  res.json({ ok: true, user: person, ...userProgress(person.id) });
});

app.get("/api/admin/exams/:id", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const exam = db.prepare("SELECT id, title, kind FROM exams WHERE id = ?").get(req.params.id);
  if (!exam) return res.status(404).json({ ok: false, error: "המבחן לא נמצא" });
  const sections = db.prepare(
    "SELECT id, section_key, title, topic, minutes FROM sections WHERE exam_id = ? ORDER BY position"
  ).all(exam.id);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY q_no").all(exam.id);
  res.json({
    ok: true,
    exam: {
      id: exam.id,
      title: exam.title,
      kind: exam.kind,
      sections: sections.map((section) => ({
        section_id: section.section_key,
        title: section.title,
        topic: section.topic,
        minutes: section.minutes,
        questions: questions.filter((q) => q.section_id === section.id).map((q) => ({
          qid: q.id,
          q_no: q.q_no,
          topic: q.topic,
          sec_type: q.sec_type,
          kind: q.kind,
          question: q.stem,
          opt1: q.opt1,
          opt2: q.opt2,
          opt3: q.opt3,
          opt4: q.opt4,
          correct: q.correct + 1,
          explanation: q.explanation,
          figure: q.figure,
          image_key: q.image_key,
          extra: q.extra,
          context: q.context,
          noshuffle: q.noshuffle ? "1" : "",
        })),
      })),
    },
  });
});

app.get("/api/admin/exams", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const exams = db.prepare(
    `SELECT e.id, e.title, e.kind,
            (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS questions
     FROM exams e ORDER BY e.sort_order`
  ).all();
  res.json({ ok: true, exams });
});

app.delete("/api/admin/exams/:id", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.params.id || "");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM questions WHERE exam_id = ?").run(id);
    db.prepare("DELETE FROM sections WHERE exam_id = ?").run(id);
    return db.prepare("DELETE FROM exams WHERE id = ?").run(id).changes;
  });
  res.json({ ok: true, deleted: tx() });
});

app.post("/api/feedback", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const questionId = String(req.body?.questionId || "").trim();
  const note = String(req.body?.note || "").replace(/\s+/g, " ").trim();
  if (!questionId) return res.status(400).json({ ok: false, error: "חסר מספר שאלה" });
  if (note.length < 2 || note.length > 400) return res.status(400).json({ ok: false, error: "כתבי בקצרה מה לא תקין" });
  const question = db.prepare("SELECT id FROM questions WHERE id = ?").get(questionId);
  if (!question) return res.status(404).json({ ok: false, error: "השאלה לא נמצאה" });
  const info = db.prepare(
    "INSERT INTO feedback (user_id, question_id, note, created_at) VALUES (?, ?, ?, ?)"
  ).run(user.id, questionId, note, new Date().toISOString());
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get("/api/admin/feedback", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const items = db.prepare(
    `SELECT f.id, f.note, f.created_at AS createdAt, f.resolved, f.question_id AS questionId,
            u.name AS userName,
            q.q_no AS qNo, q.stem, q.extra, q.figure,
            e.id AS examId, e.title AS examTitle,
            s.title AS sectionTitle, s.position AS sectionIndex
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN questions q ON q.id = f.question_id
     LEFT JOIN exams e ON e.id = q.exam_id
     LEFT JOIN sections s ON s.id = q.section_id
     ORDER BY f.resolved ASC, f.created_at DESC
     LIMIT 200`
  ).all();
  res.json({ ok: true, items });
});

app.post("/api/admin/feedback/:id", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const resolved = req.body?.resolved ? 1 : 0;
  const changes = db.prepare("UPDATE feedback SET resolved = ? WHERE id = ?").run(resolved, req.params.id).changes;
  if (!changes) return res.status(404).json({ ok: false, error: "הדיווח לא נמצא" });
  res.json({ ok: true });
});

app.post("/api/admin/exams", (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = upsertExam(req.body || {});
    res.json({ ok: true, exam: result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "לא נשמר" });
  }
});

const clientDist = path.resolve(process.cwd(), process.env.CLIENT_DIST || "client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

seed();
ensureAdmin();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`karni listening on ${PORT}`);
});
