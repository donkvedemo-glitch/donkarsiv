import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databaseUrl), { recursive: true });
export const db = new Database(config.databaseUrl);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      cover_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      poster_path TEXT,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const count = db.prepare("SELECT COUNT(*) total FROM folders").get() as { total: number };
  if (count.total === 0) {
    const insert = db.prepare("INSERT INTO folders (name, category, sort_order) VALUES (?, ?, ?)");
    ["Klasor 01", "Klasor 02", "Klasor 03", "Klasor 04", "Klasor 05", "Klasor 06"].forEach((name, index) => {
      insert.run(name, index < 2 ? "Ana Arsiv" : index < 4 ? "Ozel Seri" : "Yeni Eklenen", index);
    });
  }
}
