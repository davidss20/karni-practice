let figN = 0;

function glyphSVG(g, pid) {
  const [sh, cx, cy, sz, rot, fill] = g;
  const r = sz / 2;
  const fillv = fill === 1 ? "#2b2350" : fill === 2 ? `url(#${pid})` : "#fff";
  const st = `fill="${fillv}" stroke="#2b2350" stroke-width="1.8"`;
  const poly = (pts) =>
    `<polygon points="${pts.map(([x, y]) => `${(cx + x * r).toFixed(1)},${(cy + y * r).toFixed(1)}`).join(" ")}" ${st}/>`;
  if (sh === "c") return `<circle cx="${cx}" cy="${cy}" r="${r}" ${st}/>`;
  if (sh === "s") return `<rect x="${cx - r * 0.9}" y="${cy - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" ${st}/>`;
  if (sh === "t") return poly([[0, -1], [0.95, 0.8], [-0.95, 0.8]]);
  if (sh === "d") return poly([[0, -1], [0.8, 0], [0, 1], [-0.8, 0]]);
  if (sh === "h") return poly([0, 1, 2, 3, 4, 5].map((i) => [Math.cos((Math.PI / 3) * i), Math.sin((Math.PI / 3) * i) * 0.95]));
  if (sh === "x") {
    const a = 0.33;
    return poly([[-a, -1], [a, -1], [a, -a], [1, -a], [1, a], [a, a], [a, 1], [-a, 1], [-a, a], [-1, a], [-1, -a], [-a, -a]]);
  }
  if (sh === "a") {
    const pts = [[0, -1], [0.62, -0.2], [0.24, -0.2], [0.24, 1], [-0.24, 1], [-0.24, -0.2], [-0.62, -0.2]];
    return `<g transform="rotate(${rot} ${cx} ${cy})">${poly(pts)}</g>`;
  }
  return "";
}

export function Frame({ glyphs, size = 62 }) {
  const pid = `pat${figN++}`;
  const inner = [
    `<defs><pattern id="${pid}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#2b2350" stroke-width="2.2"/></pattern></defs>`,
    ...(glyphs || []).map((g) => glyphSVG(g, pid)),
  ].join("");
  return (
    <svg className="f" viewBox="0 0 60 60" width={size} height={size} xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML={{ __html: inner }} />
  );
}

export function parseJson(value) {
  if (typeof value !== "string") return value ?? null;
  const t = value.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function isGlyph(value) {
  return Array.isArray(value) && Array.isArray(value[0]);
}

export function SequencePair({ items }) {
  return (
    <div className="seqpair">
      {items.map((item, i) => {
        const text = String(item);
        const hebrew = /[\u0590-\u05FF]/.test(text);
        const chars = [...text].filter((ch) => ch.trim());
        return (
          <div className="seqbox" key={i}>
            <span className="seqtag">רצף {i + 1}</span>
            <div className={hebrew ? "seqchars rtl" : "seqchars"}>
              {chars.map((ch, n) => <span key={n}>{ch}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FigureBlock({ figure }) {
  const f = typeof figure === "string" ? parseJson(figure) : figure;
  if (!f) return null;
  if (Array.isArray(f) && f.every((x) => typeof x === "string")) {
    return <SequencePair items={f} />;
  }
  if (f.seq) {
    return (
      <div className="fig">
        {f.seq.map((frame, i) => (
          <div className="cell" key={i}><Frame glyphs={frame} /><span>{i + 1}</span></div>
        ))}
        <div className="cell"><div className="qbox">?</div><span>{f.seq.length + 1}</span></div>
      </div>
    );
  }
  if (f.grid) {
    return <div className="mgrid">{f.grid.flat().map((cell, i) => (cell ? <Frame key={i} glyphs={cell} /> : <div key={i} className="qbox">?</div>))}</div>;
  }
  if (f.ana) {
    const [A, B, C] = f.ana;
    return (
      <div className="fig">
        <div className="cell"><Frame glyphs={A} /><span>A</span></div>
        <div className="cell"><Frame glyphs={B} /><span>B</span></div>
        <div className="like">כמו</div>
        <div className="cell"><Frame glyphs={C} /><span>C</span></div>
        <div className="cell"><div className="qbox">?</div></div>
      </div>
    );
  }
  return null;
}

export function OptionBody({ kind, value }) {
  const parsed = parseJson(value);
  if (isGlyph(parsed) || (kind === "fig" && Array.isArray(parsed))) return <Frame glyphs={parsed} size={70} />;
  if (kind === "mono") return <span className="mono">{value}</span>;
  if (kind === "en") return <span className="ltr">{value}</span>;
  return <span>{value}</span>;
}

export function Stem({ q }) {
  if (q.kind === "en") return <div className="stem ltr">{q.stem}</div>;
  if (q.kind === "ltr") {
    const parts = String(q.stem).split("?");
    const nums = (parts.slice(1).join("?") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return <div className="stem">{parts[0]}?{nums.length ? <div className="seq">{nums.join("  →  ")}</div> : null}</div>;
  }
  if (q.kind === "mono") return <div className="stem">{q.stem}</div>;
  return <div className="stem">{q.stem}</div>;
}
