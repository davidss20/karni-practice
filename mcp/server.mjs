#!/usr/bin/env node
const API = (process.env.KARNI_API || "http://127.0.0.1:8090").replace(/\/$/, "");
const TOKEN = process.env.KARNI_ADMIN_TOKEN || "";

const tools = [
  {
    name: "list_exams",
    description: "רשימת המבחנים והחוברות שכבר שמורים באתר התרגול, כולל מספר השאלות.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_exam",
    description: "מחזיר מבחן מלא כולל שאלות. השדה correct הוא 1 עד 4.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה המבחן, למשל 1 או b1" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_exam",
    description: "מוחק מבחן אחד לפי מזהה, כולל השאלות שלו. לא מוחק מבחנים אחרים ולא מוחק ציונים.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "upsert_exam",
    description: "מוסיף או מחליף מבחן אחד. לא מוחק מבחנים אחרים. mode=replace (ברירת מחדל) מחליף את כל השאלות של המבחן הזה. mode=append מוסיף פרקים ושאלות בלי למחוק את הקיימות. correct הוא 1 עד 4.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        kind: { type: "string", enum: ["exam", "booklet"] },
        mode: { type: "string", enum: ["replace", "append"] },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section_id: { type: "string" },
              title: { type: "string" },
              topic: { type: "string" },
              minutes: { type: "number" },
              questions: { type: "array" },
            },
            required: ["title", "questions"],
          },
        },
      },
      required: ["id", "title", "sections"],
      additionalProperties: false,
    },
  },
];

function send(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

async function callApi(method, path, body) {
  if (!TOKEN) throw new Error("KARNI_ADMIN_TOKEN חסר");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runTool(name, args) {
  if (name === "list_exams") return callApi("GET", "/api/admin/exams");
  if (name === "get_exam") return callApi("GET", `/api/admin/exams/${encodeURIComponent(args.id || "")}`);
  if (name === "upsert_exam") return callApi("POST", "/api/admin/exams", args);
  if (name === "delete_exam") return callApi("DELETE", `/api/admin/exams/${encodeURIComponent(args.id || "")}`);
  throw new Error("כלי לא מוכר");
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const text = buffer.toString("utf8");
    const sep = text.indexOf("\r\n\r\n");
    if (sep === -1) return;
    const match = text.slice(0, sep).match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number(match[1]);
    const start = Buffer.byteLength(text.slice(0, sep + 4));
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    let message;
    try { message = JSON.parse(body); } catch { continue; }
    handle(message).catch((error) => {
      if (message.id != null) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } });
      }
    });
  }
});

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.id == null) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "karni-exams", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const data = await runTool(message.params?.name, message.params?.arguments || {});
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { isError: true, content: [{ type: "text", text: error.message }] },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}
