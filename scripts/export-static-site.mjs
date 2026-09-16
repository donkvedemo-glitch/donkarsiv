import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbPath = path.join(root, "server", "data", "app.db");
const uploadRoot = path.join(root, "server", "uploads");
const publicRoot = path.join(root, "client", "public");
const publicApi = path.join(publicRoot, "api");
const publicUploads = path.join(publicRoot, "uploads");
const externalUploadsBaseUrl = process.env.EXTERNAL_UPLOADS_BASE_URL?.replace(/\/$/, "");

fs.rmSync(publicUploads, { recursive: true, force: true });
fs.mkdirSync(publicApi, { recursive: true });

if (!externalUploadsBaseUrl) {
  fs.mkdirSync(publicUploads, { recursive: true });
}

if (!externalUploadsBaseUrl && fs.existsSync(uploadRoot)) {
  fs.cpSync(uploadRoot, publicUploads, { recursive: true });
}

const db = new Database(dbPath);

function publicPath(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  const match = normalized.match(/\/uploads\/(.+)$/);
  const relative = match?.[1] ?? path.relative(uploadRoot, filePath).replaceAll("\\", "/");
  if (externalUploadsBaseUrl) return `${externalUploadsBaseUrl}/${relative}`;
  return `/uploads/${relative}`;
}

const folders = db.prepare("SELECT * FROM folders ORDER BY sort_order,id").all().map((folder) => {
  const videos = db.prepare("SELECT * FROM videos WHERE folder_id=? ORDER BY sort_order,id").all(folder.id);
  return {
    id: folder.id,
    name: folder.name,
    category: folder.category,
    cover: folder.cover_path ? publicPath(folder.cover_path) : "#151515",
    videos: videos.map((video) => ({
      id: video.id,
      title: video.title,
      url: publicPath(video.file_path),
      poster: publicPath(video.poster_path),
      size: video.size,
      type: video.mime_type,
    })),
  };
});

fs.writeFileSync(path.join(publicApi, "folders"), JSON.stringify(folders));
fs.writeFileSync(path.join(publicApi, "health"), JSON.stringify({ ok: true, static: true }));

const count = folders.reduce((sum, folder) => sum + folder.videos.length, 0);
const mediaMode = externalUploadsBaseUrl ? `external media at ${externalUploadsBaseUrl}` : "local media";
console.log(`Exported ${folders.length} folders and ${count} videos to client/public using ${mediaMode}.`);
