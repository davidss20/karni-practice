import XLSX from "xlsx";
import { db } from "./db.js";

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function correctIndex(value) {
  const n = Number(text(value));
  if (!Number.isFinite(n)) return null;
  if (n >= 1 && n <= 4) return n - 1;
  if (n >= 0 && n <= 3) return n;
  return null;
}

export function importWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const questions = XLSX.utils.sheet_to_json(wb.Sheets.questions || {}, { defval: "" });
  const examRows = XLSX.utils.sheet_to_json(wb.Sheets.exams || {}, { defval: "" });
  const imageRows = XLSX.utils.sheet_to_json(wb.Sheets.images || {}, { defval: "" });

  const meta = new Map();
  examRows.forEach((row, index) => {
    const id = text(row.exam_id);
    const title = text(row.exam_title);
    const kind = text(row.exam_kind) || "exam";
    if (!id || !title || id === "practice") return;
    if (kind !== "exam" && kind !== "booklet") return;
    meta.set(id, { id, title, kind, sort_order: index });
  });

  const grouped = new Map();
  for (const row of questions) {
    const examId = text(row.exam_id);
    const qid = text(row.qid);
    const stem = text(row.question);
    const correct = correctIndex(row.correct);
    if (!examId || !qid || !stem || correct == null) continue;
    if (!grouped.has(examId)) grouped.set(examId, []);
    grouped.get(examId).push(row);
    if (examId !== "practice" && !meta.has(examId)) {
      meta.set(examId, {
        id: examId,
        title: text(row.exam_title) || `מבחן ${examId}`,
        kind: text(row.exam_kind) || "exam",
        sort_order: 1000 + meta.size,
      });
    }
  }

  const insertExam = db.prepare(
    "INSERT INTO exams (id, title, kind, sort_order) VALUES (@id, @title, @kind, @sort_order)"
  );
  const insertSection = db.prepare(
    `INSERT INTO sections (exam_id, section_key, title, topic, minutes, position)
     VALUES (@exam_id, @section_key, @title, @topic, @minutes, @position)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO questions (
      id, exam_id, section_id, q_no, topic, sec_type, kind, stem,
      opt1, opt2, opt3, opt4, correct, explanation, figure, image_key, extra, context, noshuffle
    ) VALUES (
      @id, @exam_id, @section_id, @q_no, @topic, @sec_type, @kind, @stem,
      @opt1, @opt2, @opt3, @opt4, @correct, @explanation, @figure, @image_key, @extra, @context, @noshuffle
    )`
  );
  const insertImage = db.prepare("INSERT INTO images (key, data_url) VALUES (?, ?)");

  const tx = db.transaction(() => {
    db.exec("DELETE FROM questions; DELETE FROM sections; DELETE FROM exams; DELETE FROM images;");
    let qCount = 0;
    let imgCount = 0;
    for (const exam of meta.values()) insertExam.run(exam);
    for (const [examId, rows] of grouped) {
      const sections = new Map();
      rows.forEach((row) => {
        const key = text(row.section_id) || "section";
        if (!sections.has(key)) {
          const minutes = Number(text(row.section_time_min));
          const info = insertSection.run({
            exam_id: examId,
            section_key: key,
            title: text(row.section_title) || key,
            topic: text(row.section_topic) || text(row.topic) || "other",
            minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 10,
            position: sections.size,
          });
          sections.set(key, info.lastInsertRowid);
        }
        insertQuestion.run({
          id: text(row.qid),
          exam_id: examId,
          section_id: sections.get(key),
          q_no: Number(text(row.q_no)) || qCount + 1,
          topic: text(row.topic),
          sec_type: text(row.sec_type),
          kind: text(row.kind) || "text",
          stem: text(row.question),
          opt1: text(row.opt1),
          opt2: text(row.opt2),
          opt3: text(row.opt3),
          opt4: text(row.opt4),
          correct: correctIndex(row.correct),
          explanation: text(row.explanation),
          figure: text(row.figure),
          image_key: text(row.image_key),
          extra: text(row.extra),
          context: text(row.context),
          noshuffle: text(row.noshuffle) === "1" ? 1 : 0,
        });
        qCount += 1;
      });
    }
    for (const row of imageRows) {
      const key = text(row.key);
      const data = text(row.data);
      if (!key || !data.startsWith("data:image")) continue;
      insertImage.run(key, data);
      imgCount += 1;
    }
    return { questions: qCount, images: imgCount, exams: meta.size };
  });

  return tx();
}

export function upsertExam(payload) {
  const id = text(payload.id);
  const title = text(payload.title);
  if (!id || !title) throw new Error("חסרים id או title");
  const kind = text(payload.kind) || "exam";
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const tx = db.transaction(() => {
    const existingOrder = db.prepare("SELECT sort_order FROM exams WHERE id = ?").get(id);
    const sort = existingOrder ? existingOrder.sort_order : (db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM exams").get().n);
    if (text(payload.mode) !== "append") {
      db.prepare("DELETE FROM questions WHERE exam_id = ?").run(id);
      db.prepare("DELETE FROM sections WHERE exam_id = ?").run(id);
    }
    db.prepare(
      "INSERT INTO exams (id, title, kind, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, kind = excluded.kind"
    ).run(id, title, kind, sort);
    let added = 0;
    sections.forEach((section, position) => {
      const minutes = Number(section.minutes ?? section.section_time_min);
      const info = db.prepare(
        `INSERT INTO sections (exam_id, section_key, title, topic, minutes, position)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        text(section.section_id || section.section_key) || `s${position + 1}`,
        text(section.title || section.section_title) || `פרק ${position + 1}`,
        text(section.topic || section.section_topic) || "other",
        Number.isFinite(minutes) && minutes > 0 ? minutes : 10,
        position
      );
      const list = Array.isArray(section.questions) ? section.questions : [];
      list.forEach((q, index) => {
        const qid = text(q.qid || q.id) || `${id}-${position + 1}-${index + 1}`;
        const correct = correctIndex(q.correct);
        if (correct == null || !text(q.question || q.stem)) return;
        db.prepare(
          `INSERT INTO questions (
            id, exam_id, section_id, q_no, topic, sec_type, kind, stem,
            opt1, opt2, opt3, opt4, correct, explanation, figure, image_key, extra, context, noshuffle
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            exam_id = excluded.exam_id, section_id = excluded.section_id, q_no = excluded.q_no,
            topic = excluded.topic, sec_type = excluded.sec_type, kind = excluded.kind, stem = excluded.stem,
            opt1 = excluded.opt1, opt2 = excluded.opt2, opt3 = excluded.opt3, opt4 = excluded.opt4,
            correct = excluded.correct, explanation = excluded.explanation, figure = excluded.figure,
            image_key = excluded.image_key, extra = excluded.extra, context = excluded.context, noshuffle = excluded.noshuffle`
        ).run(
          qid, id, info.lastInsertRowid, Number(q.q_no) || index + 1,
          text(q.topic || section.topic), text(q.sec_type || section.section_id), text(q.kind) || "text",
          text(q.question || q.stem), text(q.opt1), text(q.opt2), text(q.opt3), text(q.opt4),
          correct, text(q.explanation), text(q.figure), text(q.image_key), text(q.extra), text(q.context),
          text(q.noshuffle) === "1" ? 1 : 0
        );
        added += 1;
      });
    });
    return { id, title, questions: added };
  });
  return tx();
}
