import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { FigureBlock, OptionBody, SequencePair, Stem, parseJson } from "./figures.jsx";

const LETTERS = ["א", "ב", "ג", "ד"];
const TOPICS = [
  ["", "כל הנושאים"],
  ["verbal", "מילולי"],
  ["quant", "כמותי"],
  ["fig", "צורני"],
  ["english", "אנגלית"],
  ["speed", "זריזות ודיוק"],
];

function mmss(s) {
  s = Math.max(0, Math.round(s));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function fmt(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("he-IL")} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
}

function Header({ user, onSwitch, onProgress, onUsers, onReview, onReports }) {
  return (
    <header className="top">
      <div className="wrap headrow" style={{ padding: 0 }}>
        <div>
          <h1>{user ? `תרגול למבחן קרני — ${user.name}` : "תרגול למבחן קרני"}</h1>
          <div className="sub">הכנה למבחן הקבלה לכיתה ט' בסמינר דרכי שרה</div>
        </div>
        {user ? (
          <div className="row">
            <button className="btn light" onClick={onProgress}>ההתקדמות</button>
            {user.role === "admin" ? <button className="btn light" onClick={onReview}>בדיקת פרקים</button> : null}
            {user.role === "admin" ? <button className="btn light" onClick={onReports}>דיווחים</button> : null}
            {user.role === "admin" ? <button className="btn light" onClick={onUsers}>כל התלמידות</button> : null}
            <button className="btn light" onClick={onSwitch}>החלף משתמש</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function pairItems(value) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (Array.isArray(parsed) && parsed.length >= 2 && parsed.every((item) => typeof item === "string")) return parsed;
  return null;
}

function ExtraLine({ value }) {
  const text = String(value || "").trim();
  if (!text) return null;
  const pair = pairItems(text);
  if (pair) return <SequencePair items={pair} />;
  const hebrew = /[\u0590-\u05FF]/.test(text);
  const series = !hebrew && text.includes(",");
  return <div className={hebrew ? "extra-text" : series ? "seq extra-math" : "extra-math"}>{text}</div>;
}

function QuestionCard({ q, selected, onPick, reveal }) {
  const figure = q.figure ? parseJson(q.figure) || q.figure : null;
  const extraPair = pairItems(q.extra);
  const figurePair = pairItems(figure);
  return (
    <div className="q">
      <div><b>{q.qNo}.</b></div>
      {q.context ? <div className="note">{q.context}</div> : null}
      <Stem q={q} />
      {extraPair || figurePair ? <SequencePair items={extraPair || figurePair} /> : <ExtraLine value={q.extra} />}
      {q.imageKey ? <img className="qimg" alt="" src={`/api/images/${encodeURIComponent(q.imageKey)}`} /> : null}
      {figurePair ? null : <FigureBlock figure={figure} />}
      <div className="opts">
        {q.options.map((opt, i) => {
          if (!opt) return null;
          let cls = "opt";
          if (reveal) {
            if (i === reveal.correctIndex) cls += " right";
            else if (i === selected) cls += " wrong";
          } else if (selected === i) cls += " sel";
          return (
            <button key={i} className={cls} type="button" onClick={() => onPick?.(i)}>
              <span className="lt">{LETTERS[i]}</span>
              <OptionBody kind={q.kind} value={opt} />
            </button>
          );
        })}
      </div>
      {reveal?.explanation ? <div className="err" style={{ background: reveal.right ? "var(--okbg)" : "var(--badbg)" }}>{reveal.explanation}</div> : null}
      {q.id ? <QuestionFeedback questionId={q.id} /> : null}
    </div>
  );
}

const FEEDBACK_PRESETS = ["חסר התרגיל או המספרים", "הניסוח לא ברור", "התשובה נראית לא נכונה"];

function QuestionFeedback({ questionId }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/feedback", { method: "POST", body: { questionId, note } });
      setSent("הדיווח נשמר");
      setNote("");
      setOpen(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (sent && !open) return <div className="note feedback">{sent}</div>;
  if (!open) {
    return <button className="btn ghost feedback" type="button" onClick={() => setOpen(true)}>משהו לא ברור בשאלה?</button>;
  }
  return (
    <div className="feedback">
      <div className="row">
        {FEEDBACK_PRESETS.map((preset) => (
          <button key={preset} className="btn sec" type="button" onClick={() => setNote(preset)}>{preset}</button>
        ))}
      </div>
      <textarea value={note} maxLength={400} placeholder="מה לא תקין בשאלה?" onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button className="btn" type="button" disabled={busy || note.trim().length < 2} onClick={send}>שליחת דיווח</button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>ביטול</button>
      </div>
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}

function Chart({ attempts }) {
  if (!attempts.length) return null;
  const W = 640, H = 220, pl = 36, pr = 12, pt = 14, pb = 34;
  const n = attempts.length;
  const x = (i) => (n === 1 ? pl + (W - pl - pr) / 2 : pl + (i * (W - pl - pr)) / (n - 1));
  const y = (v) => pt + ((100 - v) * (H - pt - pb)) / 100;
  const lines = [0, 25, 50, 75, 100].map((v) =>
    `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e0ee"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6b6b80">${v}%</text>`
  ).join("");
  const pts = attempts.map((a, i) => `${x(i)},${y(a.pct)}`).join(" ");
  const dots = attempts.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.pct)}" r="5" fill="#5b4bc4"/><text x="${x(i)}" y="${y(a.pct) - 9}" font-size="11" text-anchor="middle" fill="#22223b">${a.pct}%</text>`).join("");
  return <div dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="direction:ltr">${lines}<polyline fill="none" stroke="#5b4bc4" stroke-width="3" points="${pts}"/>${dots}</svg>` }} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("login");
  const [home, setHome] = useState(null);
  const [error, setError] = useState("");
  const [exam, setExam] = useState(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [phase, setPhase] = useState("pre");
  const [answers, setAnswers] = useState({});
  const [left, setLeft] = useState(0);
  const [sectionTimes, setSectionTimes] = useState([]);
  const [startedAt, setStartedAt] = useState("");
  const [result, setResult] = useState(null);
  const [practice, setPractice] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [progress, setProgress] = useState(null);
  const [review, setReview] = useState(null);
  const [reports, setReports] = useState(null);
  const answersRef = useRef({});
  const leftRef = useRef(0);
  const timesRef = useRef([]);
  const finishing = useRef(false);
  const examRef = useRef(null);
  const sectionRef = useRef(0);
  const screenRef = useRef("login");
  const startedRef = useRef("");
  const closedRef = useRef(false);
  const lastSaved = useRef("");
  answersRef.current = answers;
  leftRef.current = left;
  timesRef.current = sectionTimes;
  examRef.current = exam;
  sectionRef.current = sectionIndex;
  screenRef.current = screen;
  startedRef.current = startedAt;

  async function loadHome() {
    const data = await api("/api/home");
    setHome(data);
    setScreen("home");
  }

  useEffect(() => {
    api("/api/me").then((d) => {
      setUser(d.user);
      return loadHome();
    }).catch(() => setScreen("login")).finally(() => setReady(true));
  }, []);

  const finishRef = useRef(async () => {});
  useEffect(() => {
    if (screen !== "run") return undefined;
    const timer = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(timer);
          finishRef.current(true);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, sectionIndex]);

  async function login(isNew, name, pin) {
    setError("");
    try {
      const data = await api(isNew ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: { name, pin } });
      setUser(data.user);
      await loadHome();
    } catch (e) { setError(e.message); }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setHome(null);
    setExam(null);
    setScreen("login");
  }

  function saveDraft(keepalive = false) {
    if (closedRef.current) return;
    const current = examRef.current;
    const where = screenRef.current;
    if (!current || (where !== "exam" && where !== "run")) return;
    const body = {
      examId: current.id,
      sectionIndex: sectionRef.current,
      phase: where === "run" ? "run" : "pre",
      answers: answersRef.current,
      sectionTimes: timesRef.current,
      remainingSec: where === "run" ? leftRef.current : null,
      startedAt: startedRef.current,
    };
    const payload = JSON.stringify(body);
    if (payload === lastSaved.current) return;
    lastSaved.current = payload;
    fetch("/api/in-progress", {
      method: "PUT",
      credentials: "include",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: payload,
    }).catch(() => { lastSaved.current = ""; });
  }

  async function startExam(id, resume) {
    const saved = home?.inProgress;
    const same = saved && String(saved.examId) === String(id);
    if (resume && !same) return;
    if (!resume && saved && !confirm(same ? "להתחיל מחדש? התשובות מההמשך יימחקו." : "יש מבחן אחר באמצע. להתחיל את זה ימחק את ההמשך.")) return;
    const data = await api(`/api/exams/${encodeURIComponent(id)}`);
    closedRef.current = false;
    lastSaved.current = "";
    setExam(data.exam);
    setResult(null);
    if (resume && same && saved.sectionIndex < data.exam.sections.length) {
      setSectionIndex(saved.sectionIndex);
      setAnswers(saved.answers || {});
      setSectionTimes(Array.isArray(saved.sectionTimes) ? saved.sectionTimes : []);
      setStartedAt(saved.startedAt || new Date().toISOString());
      if (saved.phase === "run") {
        const max = data.exam.sections[saved.sectionIndex].minutes * 60;
        setLeft(Math.max(1, Math.min(max, Number(saved.remainingSec) || max)));
        setPhase("run");
        setScreen("run");
        return;
      }
      setPhase("pre");
      setScreen("exam");
      return;
    }
    setSectionIndex(0);
    setPhase("pre");
    setAnswers({});
    setSectionTimes([]);
    setStartedAt(new Date().toISOString());
    setScreen("exam");
  }

  function beginSection() {
    const minutes = exam.sections[sectionIndex].minutes;
    setLeft(minutes * 60);
    setPhase("run");
    setScreen("run");
  }

  async function finishSection(fromTimer) {
    if (finishing.current || !exam) return;
    finishing.current = true;
    try {
      const used = exam.sections[sectionIndex].minutes * 60 - (fromTimer ? 0 : leftRef.current);
      const times = timesRef.current.slice();
      times[sectionIndex] = Math.max(0, used);
      setSectionTimes(times);
      const next = sectionIndex + 1;
      if (next >= exam.sections.length) {
        const data = await api("/api/attempts", {
          method: "POST",
          body: { examId: exam.id, startedAt, answers: answersRef.current, sectionTimes: times },
        });
        closedRef.current = true;
        await api("/api/in-progress", { method: "DELETE" }).catch(() => {});
        setResult(data.attempt);
        setScreen("result");
        return;
      }
      setSectionIndex(next);
      setPhase("pre");
      setScreen("exam");
    } catch (e) {
      setError(e.message);
    } finally {
      finishing.current = false;
    }
  }
  finishRef.current = finishSection;

  useEffect(() => {
    if (screen !== "exam" && screen !== "run") return undefined;
    saveDraft();
    const timer = screen === "run" ? setInterval(() => saveDraft(), 5000) : null;
    const hide = () => { if (document.visibilityState === "hidden") saveDraft(true); };
    const leave = () => saveDraft(true);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [screen, sectionIndex, answers]);

  function openProgress(name, exams, attempts, mine) {
    setProgress({ name, exams, attempts, mine });
    setScreen("progress");
  }

  async function openReports() {
    const data = await api("/api/admin/feedback");
    setReports(data.items);
    setScreen("reports");
  }

  async function setReportResolved(id, resolved) {
    await api(`/api/admin/feedback/${id}`, { method: "POST", body: { resolved } });
    setReports(await api("/api/admin/feedback").then((data) => data.items));
  }

  async function openReview() {
    const data = await api("/api/admin/exams");
    setReview({ exams: data.exams, exam: null, sectionIndex: 0 });
    setScreen("review");
  }

  async function openReviewExam(id, sectionIndex = 0) {
    if (!id) {
      const list = await api("/api/admin/exams");
      setReview({ exams: list.exams, exam: null, sectionIndex: 0 });
      setScreen("review");
      return;
    }
    const [data, list] = await Promise.all([
      api(`/api/admin/exams/${encodeURIComponent(id)}`),
      api("/api/admin/exams"),
    ]);
    setReview({ exams: list.exams, exam: data.exam, sectionIndex });
    setScreen("review");
  }

  async function openStudent(id) {
    const data = await api(`/api/admin/users/${id}`);
    openProgress(data.user.name, data.exams, data.attempts, false);
  }

  async function startPractice(query) {
    const data = await api(`/api/practice?${query}`);
    setPractice({ list: data.questions, index: 0, correct: 0, reveal: null, picked: null });
    setScreen("practice");
  }

  async function checkPractice(choice) {
    const q = practice.list[practice.index];
    const data = await api("/api/practice/check", { method: "POST", body: { id: q.id, choice } });
    setPractice({
      ...practice,
      picked: choice,
      reveal: data,
      correct: practice.correct + (data.right ? 1 : 0),
    });
  }

  const topicBars = useMemo(() => {
    if (!home?.attempts?.length) return [];
    const map = new Map();
    home.attempts.forEach((a) => (a.sections || []).forEach((s) => {
      const cur = map.get(s.title) || { title: s.title, c: 0, n: 0 };
      cur.c += s.c || 0;
      cur.n += s.n || 0;
      map.set(s.title, cur);
    }));
    return [...map.values()].filter((s) => s.n).sort((a, b) => a.c / a.n - b.c / b.n);
  }, [home]);

  if (!ready) return <div className="wrap">טוען...</div>;

  return (
    <>
      <Header
        user={user}
        onSwitch={logout}
        onProgress={() => { if (home) openProgress(user.name, home.exams, home.attempts, true); }}
        onUsers={async () => { setAdmin(await api("/api/admin/overview")); setScreen("admin"); }}
        onReview={openReview}
        onReports={openReports}
      />
      <div className="wrap">
        {error && screen !== "login" ? <div className="err">{error}</div> : null}
        {screen === "login" ? <Login onSubmit={login} error={error} /> : null}
        {screen === "home" && home ? (
          <>
            <div className="card">
              <h2>מבחנים וחוברות</h2>
              <div className="muted" style={{ marginBottom: 10 }}>לכל פרק יש זמן משלו. כשהזמן נגמר עוברים הלאה, ואי אפשר לחזור לפרק שנסגר. אם האתר נסגר באמצע, אפשר להמשיך מאותו פרק.</div>
              {home.inProgress ? (
                <div className="note" style={{ marginBottom: 10 }}>
                  יש מבחן באמצע: {home.exams.find((e) => String(e.id) === String(home.inProgress.examId))?.title || "מבחן"} · פרק {home.inProgress.sectionIndex + 1}.
                  {" "}
                  <button className="btn" type="button" onClick={() => startExam(home.inProgress.examId, true)}>להמשיך</button>
                </div>
              ) : null}
              <div className="grid">
                {home.exams.map((e) => {
                  const paused = home.inProgress && String(home.inProgress.examId) === String(e.id);
                  return (
                    <div className="exam-card" key={e.id}>
                      <b>{e.title}</b>
                      <div className="muted">{e.kind === "booklet" ? "חוברת" : "מבחן"} · {e.sections} פרקים · {e.questions} שאלות · {e.minutes} דקות</div>
                      {paused ? <div><span className="pill">אפשר להמשיך · פרק {home.inProgress.sectionIndex + 1}</span></div> : null}
                      {e.attempts ? (
                        <div>
                          <div><span className="pill ok">הציון הכי טוב: {e.best}%</span></div>
                          <div><span className="pill">ניסיון אחרון: {e.last.pct}%</span> <span className="muted">{fmt(e.last.finishedAt)}</span></div>
                        </div>
                      ) : <div className="muted">עוד לא נעשה</div>}
                      <div className="row">
                        <button className="btn" onClick={() => startExam(e.id, paused)}>{paused ? "להמשיך" : e.attempts ? "לעשות שוב" : "להתחיל"}</button>
                        {paused ? <button className="btn ghost" onClick={() => startExam(e.id, false)}>להתחיל מחדש</button> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card">
              <h2>ההיסטוריה שלי</h2>
              {home.attempts.length ? (
                <>
                  <Chart attempts={home.attempts} />
                  <div className="tablewrap">
                    <table>
                      <thead><tr><th>תאריך</th><th>מבחן</th><th>ציון</th><th>זמן</th></tr></thead>
                      <tbody>
                        {[...home.attempts].reverse().map((a) => (
                          <tr key={a.id}><td>{fmt(a.finishedAt)}</td><td>{a.examTitle}</td><td><b>{a.pct}%</b> <span className="muted">({a.correct}/{a.total})</span></td><td>{mmss(a.durationSec)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : <div className="muted">אחרי המבחן הראשון הציונים יופיעו כאן.</div>}
            </div>
            <div className="card">
              <h2>איפה כדאי להתחזק</h2>
              {topicBars.length ? topicBars.map((s) => {
                const p = Math.round((100 * s.c) / s.n);
                return <div className="stat" key={s.title}><div>{s.title}</div><div className="bar"><i style={{ width: `${p}%`, background: p >= 80 ? "#1f8a5b" : p >= 60 ? "#b7791f" : "#c0392b" }} /></div><div>{p}%</div></div>;
              }) : <div className="muted">יופיע אחרי מבחן.</div>}
            </div>
            <PracticeCard onStart={startPractice} />
          </>
        ) : null}
        {screen === "exam" && exam ? (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="muted">{exam.title} · פרק {sectionIndex + 1} מתוך {exam.sections.length}</div>
            <h2>{exam.sections[sectionIndex].title}</h2>
            <div>{exam.sections[sectionIndex].questions.length} שאלות · {exam.sections[sectionIndex].minutes} דקות</div>
            {sectionIndex > 0 ? <div className="note" style={{ marginTop: 10 }}>הפרקים הקודמים כבר נסגרו. ההמשך נשמר גם אם האתר נסגר.</div> : <div className="muted" style={{ marginTop: 8 }}>ההמשך נשמר גם אם האתר נסגר.</div>}
            <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
              <button className="btn" onClick={beginSection}>להתחיל את הפרק</button>
            </div>
          </div>
        ) : null}
        {screen === "run" && exam ? (
          <>
            <div className={`timerbar ${left < 60 ? "low" : ""}`}>
              <b>פרק {sectionIndex + 1}/{exam.sections.length}: {exam.sections[sectionIndex].title}</b>
              <div className="clock">{mmss(left)}</div>
              <button className="btn sec" onClick={() => { if (confirm("לסיים את הפרק? אי אפשר לחזור.")) finishSection(false); }}>סיימתי את הפרק</button>
            </div>
            <div className="card">
              {exam.sections[sectionIndex].questions.map((q) => (
                <QuestionCard key={q.id} q={{ ...q, qNo: q.qNo }} selected={answers[q.id]} onPick={(i) => setAnswers({ ...answers, [q.id]: i })} />
              ))}
            </div>
          </>
        ) : null}
        {screen === "result" && result ? (
          <div className="card">
            <h2>תוצאות {result.examTitle}</h2>
            <div className="big">{result.pct}%</div>
            <div>{result.correct} נכונות מתוך {result.total} · זמן {mmss(result.durationSec)}</div>
            <div className="note" style={{ marginTop: 8 }}>הציון נשמר.</div>
            <h3>לפי פרקים</h3>
            <div className="tablewrap">
              <table>
                <thead><tr><th>פרק</th><th>נכונות</th><th>אחוז</th></tr></thead>
                <tbody>
                  {result.sections.map((s) => {
                    const p = s.n ? Math.round((100 * s.c) / s.n) : 0;
                    return <tr key={s.id}><td>{s.title}</td><td>{s.c}/{s.n}</td><td><span className={`pill ${p >= 80 ? "ok" : p < 60 ? "bad" : ""}`}>{p}%</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={loadHome}>לדף הבית</button>
            {result.wrong?.length ? (
              <>
                <h3>שאלות לבדיקה ({result.wrong.length})</h3>
                {result.wrong.map((q) => (
                  <QuestionCard key={q.id} q={q} selected={q.chosen} reveal={{ correctIndex: q.correctIndex, right: false, explanation: q.explanation }} />
                ))}
              </>
            ) : null}
          </div>
        ) : null}
        {screen === "practice" && practice ? (
          <div className="card">
            {practice.index >= practice.list.length ? (
              <>
                <h2>סיום התרגול</h2>
                <div className="big">{practice.list.length ? Math.round((100 * practice.correct) / practice.list.length) : 0}%</div>
                <button className="btn" onClick={loadHome}>לדף הבית</button>
              </>
            ) : (
              <>
                <div className="muted">שאלה {practice.index + 1} מתוך {practice.list.length}</div>
                <QuestionCard
                  q={{ ...practice.list[practice.index], qNo: practice.index + 1 }}
                  selected={practice.picked}
                  onPick={practice.reveal ? undefined : checkPractice}
                  reveal={practice.reveal ? { ...practice.reveal, right: practice.reveal.right } : null}
                />
                {practice.reveal ? <button className="btn" onClick={() => setPractice({ ...practice, index: practice.index + 1, reveal: null, picked: null })}>לשאלה הבאה</button> : null}
              </>
            )}
          </div>
        ) : null}
        {screen === "progress" && progress ? <ProgressBoard data={progress} onHome={loadHome} /> : null}
        {screen === "admin" && admin ? (
          <UsersBoard
            admin={admin}
            onOpen={openStudent}
            onAdded={async () => setAdmin(await api("/api/admin/overview"))}
            onHome={loadHome}
          />
        ) : null}
        {screen === "review" && review ? (
          <ReviewBoard review={review} onPickExam={openReviewExam} onSection={(index) => setReview({ ...review, sectionIndex: index })} onHome={loadHome} />
        ) : null}
        {screen === "reports" && reports ? (
          <ReportsBoard
            items={reports}
            onToggle={setReportResolved}
            onOpenSection={(examId, sectionIndex) => openReviewExam(examId, sectionIndex)}
            onHome={loadHome}
          />
        ) : null}
      </div>
    </>
  );
}

function ReportsBoard({ items, onToggle, onOpenSection, onHome }) {
  const open = items.filter((item) => !item.resolved);
  const done = items.filter((item) => item.resolved);
  return (
    <div className="card">
      <h2>דיווחים על שאלות</h2>
      <div className="muted">כאן נשמר מה שמשתמשות סימנו כלא תקין. {open.length} פתוחים.</div>
      {open.length ? open.map((item) => <ReportCard key={item.id} item={item} onToggle={onToggle} onOpenSection={onOpenSection} />) : <div className="note" style={{ marginTop: 10 }}>אין דיווחים פתוחים.</div>}
      {done.length ? <h3>שכבר נבדקו</h3> : null}
      {done.map((item) => <ReportCard key={item.id} item={item} onToggle={onToggle} onOpenSection={onOpenSection} />)}
      <button className="btn" style={{ marginTop: 12 }} onClick={onHome}>לדף הבית</button>
    </div>
  );
}

function ReportCard({ item, onToggle, onOpenSection }) {
  const chapter = Number.isInteger(item.sectionIndex) ? `פרק ${item.sectionIndex + 1}` : "";
  return (
    <div className="exam-card" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{item.userName}</b>
        <span className={item.resolved ? "pill ok" : "pill bad"}>{item.resolved ? "נבדק" : "פתוח"}</span>
      </div>
      <div className="muted">{fmt(item.createdAt)} · {item.examTitle || "תרגול"} {chapter} {item.qNo ? `· שאלה ${item.qNo}` : ""}</div>
      {item.stem ? <div>{item.stem}</div> : <div className="muted">{item.questionId}</div>}
      {pairItems(item.figure) || pairItems(item.extra) ? <SequencePair items={pairItems(item.figure) || pairItems(item.extra)} /> : item.extra ? <div className="extra-math">{item.extra}</div> : null}
      <div className="note">{item.note}</div>
      <div className="row">
        <button className="btn sec" type="button" onClick={() => onToggle(item.id, !item.resolved)}>{item.resolved ? "להחזיר לפתוח" : "סמן כנבדק"}</button>
        {item.examId && item.examId !== "practice" && Number.isInteger(item.sectionIndex) ? (
          <button className="btn ghost" type="button" onClick={() => onOpenSection(item.examId, item.sectionIndex)}>לפרק</button>
        ) : null}
      </div>
    </div>
  );
}

function reviewQuestion(q) {
  return {
    id: q.qid,
    qNo: q.q_no,
    kind: q.kind,
    stem: q.question,
    options: [q.opt1, q.opt2, q.opt3, q.opt4],
    figure: q.figure || "",
    imageKey: q.image_key || "",
    context: q.context || "",
    extra: q.extra || "",
    explanation: q.explanation || "",
    correct: Number(q.correct) - 1,
  };
}

function ReviewBoard({ review, onPickExam, onSection, onHome }) {
  if (!review.exam) {
    return (
      <div className="card">
        <h2>בדיקת פרקים</h2>
        <div className="muted">נכנסים לפרק אחד, בלי שעון ובלי שמירת ציון. התשובה הנכונה מסומנת.</div>
        <div className="note" style={{ margin: "10px 0" }}>
          כדי לבדוק את התרגילים שהיו חסרים: חוברת 1, פרק 9 (סדרות מספרים) ופרק 11 (שברים).
        </div>
        <div className="grid">
          {review.exams.map((exam) => (
            <button className="exam-card userbtn" key={exam.id} type="button" onClick={() => onPickExam(exam.id)}>
              <b>{exam.title}</b>
              <div className="muted">{exam.questions} שאלות</div>
            </button>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={onHome}>לדף הבית</button>
      </div>
    );
  }
  const sections = review.exam.sections || [];
  const section = sections[review.sectionIndex];
  const questions = (section?.questions || []).map(reviewQuestion);
  const watch = questions.filter((q) => q.extra).map((q) => q.qNo);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{review.exam.title}</h2>
        <button className="btn ghost" onClick={() => onPickExam(null)}>לכל המבחנים</button>
      </div>
      <div className="muted" style={{ margin: "8px 0" }}>פרק {review.sectionIndex + 1} מתוך {sections.length}</div>
      <div className="row">
        <button className="btn sec" type="button" disabled={review.sectionIndex === 0} onClick={() => onSection(review.sectionIndex - 1)}>הפרק הקודם</button>
        <select value={String(review.sectionIndex)} onChange={(e) => onSection(Number(e.target.value))}>
          {sections.map((item, index) => <option key={item.section_id || index} value={index}>פרק {index + 1}: {item.title}</option>)}
        </select>
        <button className="btn sec" type="button" disabled={review.sectionIndex >= sections.length - 1} onClick={() => onSection(review.sectionIndex + 1)}>הפרק הבא</button>
      </div>
      {section ? <h3>{section.title}</h3> : null}
      {watch.length ? <div className="note">בפרק הזה כדאי לבדוק את שאלות {watch.join(", ")}. התרגיל אמור להופיע מתחת לניסוח.</div> : null}
      {questions.map((q) => (
        <QuestionCard key={q.id} q={q} selected={q.correct} reveal={{ correctIndex: q.correct, right: true, explanation: q.explanation }} />
      ))}
      <button className="btn" style={{ marginTop: 12 }} onClick={onHome}>לדף הבית</button>
    </div>
  );
}

function Login({ onSubmit, error }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  return (
    <form className="card namebox" onSubmit={(e) => { e.preventDefault(); onSubmit(false, name.trim(), pin.trim()); }}>
      <h2>מי מתרגלת היום?</h2>
      <div className="muted">שם וקוד בן 4 ספרות. הציונים נשמרים בשרת, לכל אחת בנפרד.</div>
      <div className="row" style={{ marginTop: 10 }}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: מיכל" maxLength={40} /></div>
      <div className="row" style={{ marginTop: 8 }}><input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="קוד בן 4 ספרות" inputMode="numeric" maxLength={4} type="password" autoComplete="off" /></div>
      {error ? <div className="err">{error}</div> : null}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" type="submit">כניסה</button>
        <button className="btn sec" type="button" onClick={() => onSubmit(true, name.trim(), pin.trim())}>משתמש חדש</button>
      </div>
    </form>
  );
}

function topicBarsOf(attempts) {
  const map = new Map();
  attempts.forEach((a) => (a.sections || []).forEach((s) => {
    const cur = map.get(s.title) || { title: s.title, c: 0, n: 0 };
    cur.c += s.c || 0;
    cur.n += s.n || 0;
    map.set(s.title, cur);
  }));
  return [...map.values()].filter((s) => s.n).sort((a, b) => a.c / a.n - b.c / b.n);
}

function ProgressBoard({ data, onHome }) {
  const done = data.exams.filter((e) => e.attempts);
  const avg = data.attempts.length ? Math.round(data.attempts.reduce((s, a) => s + a.pct, 0) / data.attempts.length) : 0;
  const best = data.attempts.reduce((m, a) => Math.max(m, a.pct), 0);
  const bars = topicBarsOf(data.attempts);
  const weak = bars[0];
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>מבחנים שבוצעו</span><b>{done.length}/{data.exams.length}</b></div>
        <div className="kpi"><span>ממוצע</span><b>{data.attempts.length ? `${avg}%` : "—"}</b></div>
        <div className="kpi"><span>הציון הכי טוב</span><b>{data.attempts.length ? `${best}%` : "—"}</b></div>
        <div className="kpi"><span>ניסיונות</span><b>{data.attempts.length}</b></div>
      </div>
      <div className="card">
        <h2>ההתקדמות של {data.name}</h2>
        {data.attempts.length ? <Chart attempts={data.attempts} /> : <div className="muted">עוד אין ציונים. אחרי המבחן הראשון הגרף יופיע כאן.</div>}
        {weak ? <div className="note" style={{ marginTop: 10 }}>הכי כדאי להתחזק ב{weak.title}: {Math.round((100 * weak.c) / weak.n)}%</div> : null}
      </div>
      <div className="card">
        <h2>לפי מבחן</h2>
        {data.exams.map((e) => {
          const pct = e.best ?? 0;
          return (
            <div className="stat" key={e.id}>
              <div>{e.title}</div>
              <div className="bar"><i style={{ width: `${e.attempts ? pct : 0}%`, background: !e.attempts ? "#d9d7e6" : pct >= 80 ? "#1f8a5b" : pct >= 60 ? "#b7791f" : "#c0392b" }} /></div>
              <div>{e.attempts ? `${pct}%` : "—"}</div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <h2>לפי פרק</h2>
        {bars.length ? bars.map((s) => {
          const p = Math.round((100 * s.c) / s.n);
          return <div className="stat" key={s.title}><div>{s.title}</div><div className="bar"><i style={{ width: `${p}%`, background: p >= 80 ? "#1f8a5b" : p >= 60 ? "#b7791f" : "#c0392b" }} /></div><div>{p}%</div></div>;
        }) : <div className="muted">יופיע אחרי מבחן.</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={onHome}>לדף הבית</button>
      </div>
    </>
  );
}

function UsersBoard({ admin, onOpen, onAdded, onHome }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function addUser(event) {
    event.preventDefault();
    setErr("");
    setNote("");
    try {
      await api("/api/admin/users", { method: "POST", body: { name: name.trim(), pin: pin.trim() } });
      setNote(`${name.trim()} נוספה. הקוד נשמר אצלה.`);
      setName("");
      setPin("");
      await onAdded();
    } catch (error) {
      setErr(error.message);
    }
  }
  return (
    <>
      <div className="card">
        <h2>כל התלמידות</h2>
        <div className="grid">
          {admin.users.map((u) => (
            <button className="exam-card userbtn" key={u.id} type="button" onClick={() => onOpen(u.id)}>
              <b>{u.name}</b>
              <div><span className={`pill ${u.role === "admin" ? "" : "ok"}`}>{u.role === "admin" ? "מנהל" : "תלמידה"}</span></div>
              <div className="muted">{u.attempts ? `${u.attempts} ניסיונות · ממוצע ${u.avgPct}% · שיא ${u.best}%` : "עוד אין תרגול"}</div>
              {u.lastAt ? <div className="muted">פעם אחרונה: {fmt(u.lastAt)}</div> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>הוספת תלמידה</h2>
        <div className="muted">בוחרים שם וקוד בן 4 ספרות. היא נכנסת אחר כך עם אותו שם ואותו קוד.</div>
        <form onSubmit={addUser}>
          <div className="row" style={{ marginTop: 10 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם" maxLength={40} />
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="קוד בן 4 ספרות" inputMode="numeric" maxLength={4} />
            <button className="btn" type="submit">הוספה</button>
          </div>
        </form>
        {note ? <div className="note" style={{ marginTop: 10 }}>{note}</div> : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
      <div className="card">
        <h2>ניסיונות אחרונים</h2>
        {admin.recent.length ? admin.recent.map((a, i) => <div key={i}>{fmt(a.finishedAt)} · {a.name} · {a.examTitle} · {a.pct}%</div>) : <div className="muted">עוד אין ציונים.</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={onHome}>לדף הבית</button>
      </div>
    </>
  );
}

function PracticeCard({ onStart }) {
  const [topic, setTopic] = useState("");
  const [limit, setLimit] = useState(10);
  return (
    <div className="card">
      <h2>תרגול לפי נושא</h2>
      <div className="muted">משוב מיד אחרי כל שאלה.</div>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[10, 15, 20].map((n) => <option key={n} value={n}>{n} שאלות</option>)}</select>
        <button className="btn" onClick={() => onStart(`topic=${encodeURIComponent(topic)}&limit=${limit}`)}>להתחיל</button>
      </div>
      <h3>תרגול חולשות</h3>
      <button className="btn sec" onClick={() => onStart("mode=weak&limit=15")}>שאלות שטעיתי בהן</button>
    </div>
  );
}
