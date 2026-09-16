import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { db, migrate } from "./db.js";

migrate();

const app = express();
const uploadRoot = path.resolve(config.uploadDir);
const coverDir = path.join(uploadRoot, "covers");
const videoDir = path.join(uploadRoot, "videos");
const posterDir = path.join(uploadRoot, "posters");

for (const dir of [coverDir, videoDir, posterDir]) fs.mkdirSync(dir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, file, cb) {
      if (file.fieldname === "cover") return cb(null, coverDir);
      if (file.fieldname === "poster") return cb(null, posterDir);
      return cb(null, videoDir);
    },
    filename(_req, file, cb) {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      const isLocalDev = ["localhost", "127.0.0.1"].includes(url.hostname) || /^192\.168\./.test(url.hostname);
      return callback(null, isLocalDev || origin === config.clientOrigin);
    } catch {
      return callback(null, false);
    }
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 240 }));
app.use("/uploads", express.static(uploadRoot, { fallthrough: false, maxAge: "7d" }));

const clean = (value: string) => value.trim().replace(/[<>]/g, "");
const folderSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
});

function publicPath(filePath: string | null | undefined) {
  if (!filePath) return null;
  return `/uploads/${path.relative(uploadRoot, filePath).replaceAll("\\", "/")}`;
}

function folderRow(row: any) {
  const videos = db.prepare("SELECT * FROM videos WHERE folder_id=? ORDER BY sort_order,id").all(row.id) as any[];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    cover: row.cover_path ? publicPath(row.cover_path) : "#151515",
    videos: videos.map((video) => ({
      id: video.id,
      title: video.title,
      url: publicPath(video.file_path),
      poster: publicPath(video.poster_path),
      size: video.size,
      type: video.mime_type,
    })),
  };
}

function removeFile(filePath?: string | null) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(uploadRoot)) return;
  fs.rmSync(resolved, { force: true });
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/folders", (_req, res) => {
  const rows = db.prepare("SELECT * FROM folders ORDER BY sort_order,id").all() as any[];
  res.json(rows.map(folderRow));
});

app.post("/api/folders", (req, res) => {
  const data = folderSchema.parse(req.body);
  const max = db.prepare("SELECT COALESCE(MAX(sort_order),0) sort_order FROM folders").get() as { sort_order: number };
  const info = db.prepare("INSERT INTO folders (name,category,sort_order) VALUES (?,?,?)").run(clean(data.name), clean(data.category), max.sort_order + 1);
  const row = db.prepare("SELECT * FROM folders WHERE id=?").get(info.lastInsertRowid);
  res.status(201).json(folderRow(row));
});

app.put("/api/folders/:id", (req, res) => {
  const data = folderSchema.parse(req.body);
  db.prepare("UPDATE folders SET name=?,category=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(clean(data.name), clean(data.category), req.params.id);
  const row = db.prepare("SELECT * FROM folders WHERE id=?").get(req.params.id);
  res.json(folderRow(row));
});

app.delete("/api/folders/:id", (req, res) => {
  const videos = db.prepare("SELECT * FROM videos WHERE folder_id=?").all(req.params.id) as any[];
  for (const video of videos) {
    removeFile(video.file_path);
    removeFile(video.poster_path);
  }
  const folder = db.prepare("SELECT * FROM folders WHERE id=?").get(req.params.id) as any;
  removeFile(folder?.cover_path);
  db.prepare("DELETE FROM folders WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/folders/:id/cover", upload.single("cover"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Kapak dosyasi gerekli" });
  const old = db.prepare("SELECT cover_path FROM folders WHERE id=?").get(req.params.id) as { cover_path?: string } | undefined;
  removeFile(old?.cover_path);
  db.prepare("UPDATE folders SET cover_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(file.path, req.params.id);
  res.status(201).json({ cover: publicPath(file.path) });
});

app.post("/api/folders/:id/videos", upload.fields([{ name: "video", maxCount: 1 }, { name: "poster", maxCount: 1 }]), (req, res) => {
  const files = req.files as { video?: Express.Multer.File[]; poster?: Express.Multer.File[] } | undefined;
  const video = files?.video?.[0];
  const poster = files?.poster?.[0];
  if (!video) return res.status(400).json({ error: "Video dosyasi gerekli" });
  const max = db.prepare("SELECT COALESCE(MAX(sort_order),0) sort_order FROM videos WHERE folder_id=?").get(req.params.id) as { sort_order: number };
  const title = clean(String(req.body.title ?? path.basename(video.originalname, path.extname(video.originalname))));
  const info = db.prepare("INSERT INTO videos (folder_id,title,file_path,poster_path,mime_type,size,sort_order) VALUES (?,?,?,?,?,?,?)")
    .run(req.params.id, title, video.path, poster?.path ?? null, video.mimetype || "video/mp4", video.size, max.sort_order + 1);
  const row = db.prepare("SELECT * FROM videos WHERE id=?").get(info.lastInsertRowid) as any;
  res.status(201).json({
    id: row.id,
    title: row.title,
    url: publicPath(row.file_path),
    poster: publicPath(row.poster_path),
    size: row.size,
    type: row.mime_type,
  });
});

app.delete("/api/videos/:id", (req, res) => {
  const video = db.prepare("SELECT * FROM videos WHERE id=?").get(req.params.id) as any;
  if (video) {
    removeFile(video.file_path);
    removeFile(video.poster_path);
    db.prepare("DELETE FROM videos WHERE id=?").run(req.params.id);
  }
  res.json({ ok: true });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Gecersiz giris" });
  console.error(err);
  res.status(500).json({ error: "Sunucu hatasi" });
});

app.listen(config.port, () => console.log(`API http://localhost:${config.port}`));
