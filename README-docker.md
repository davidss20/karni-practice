# תרגול למבחן קרני — אפליקציה

אתר React עם שרת Node, מסד SQLite, ושרת MCP להוספת מבחנים. האתר הסטטי ב-GitHub Pages נשאר כמו שהוא.

## הרצה

```bash
cp .env.example .env
docker compose up -d --build
```

השירות עולה מחדש לבד. הנתונים נשמרים ב-volume בשם `karni-data`. אל תריצו `docker compose down -v`.

`REIMPORT=1` מוחק את השאלות ומייבא מחדש מהאקסל. בלי זה, מבחן שנוסף דרך MCP נשאר גם אחרי הפעלה מחדש.

מנהל נוצר מהשדות `ADMIN_NAME` ו-`ADMIN_PIN` (4 ספרות) רק אם השם עוד לא קיים. תלמידה נרשמת לבד ממסך הכניסה.

## הוספת מבחן דרך Cursor

בקובץ ההגדרות של MCP:

```json
{
  "mcpServers": {
    "karni": {
      "command": "node",
      "args": ["C:/Repo/karni-practice/mcp/server.mjs"],
      "env": {
        "KARNI_API": "http://127.0.0.1:8090",
        "KARNI_ADMIN_TOKEN": "הטוקן מקובץ ה-.env בשרת"
      }
    }
  }
}
```

הכלים: `list_exams`, `get_exam`, `upsert_exam`. בשדה `correct` הערך הוא 1 עד 4. `mode` הוא `replace` או `append`. הוספה נוגעת רק במבחן שנשלח.
