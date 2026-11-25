import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "karni.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  exam_id TEXT NOT NULL,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  section_id INTEGER NOT NULL,
  q_no INTEGER NOT NULL,
  topic TEXT,
  sec_type TEXT,
  kind TEXT,
  stem TEXT NOT NULL,
  opt1 TEXT, opt2 TEXT, opt3 TEXT, opt4 TEXT,
  correct INTEGER NOT NULL,
  explanation TEXT,
  figure TEXT,
  image_key TEXT,
  extra TEXT,
  context TEXT,
  noshuffle INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  data_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  exam_id TEXT,
  exam_title TEXT,
  started_at TEXT,
  finished_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  sections_json TEXT NOT NULL,
  answers_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS in_progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  exam_id TEXT NOT NULL,
  section_index INTEGER NOT NULL,
  phase TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  section_times_json TEXT NOT NULL,
  remaining_sec INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_open ON feedback(resolved, created_at);
`);

export function countQuestions() {
  return db.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
}
