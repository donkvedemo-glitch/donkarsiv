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

function publicPath(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  const match = normalized.match(/\/uploads\/(.+)$/);
  const relative = match?.[1] ?? path.relative(uploadRoot, filePath).replaceAll("\\", "/");
  if (externalUploadsBaseUrl) return `${externalUploadsBaseUrl}/${relative}`;
  return `/uploads/${relative}`;
}

function rewriteExternalUrls(value) {
  if (!externalUploadsBaseUrl) return value;
  if (Array.isArray(value)) return value.map(rewriteExternalUrls);
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  for (const key of ["cover", "url", "poster"]) {
    if (typeof next[key] === "string") next[key] = publicPath(next[key]);
  }
  if (Array.isArray(next.videos)) next.videos = next.videos.map(rewriteExternalUrls);
  return next;
}

if (!externalUploadsBaseUrl) {
  fs.mkdirSync(publicUploads, { recursive: true });
}

if (!externalUploadsBaseUrl && fs.existsSync(uploadRoot)) {
  fs.cpSync(uploadRoot, publicUploads, { recursive: true });
}

let folders;
if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  folders = db.prepare("SELECT * FROM folders ORDER BY sort_order,id").all().map((folder) => {
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
} else {
  const fallbackPath = path.join(publicApi, "folders");
  if (!fs.existsSync(fallbackPath)) {
    throw new Error(`Missing database at ${dbPath} and fallback data at ${fallbackPath}`);
  }
  folders = rewriteExternalUrls(JSON.parse(fs.readFileSync(fallbackPath, "utf8")));
}

fs.writeFileSync(path.join(publicApi, "folders"), JSON.stringify(folders));
fs.writeFileSync(path.join(publicApi, "health"), JSON.stringify({ ok: true, static: true }));

const count = folders.reduce((sum, folder) => sum + folder.videos.length, 0);
const mediaMode = externalUploadsBaseUrl ? `external media at ${externalUploadsBaseUrl}` : "local media";
console.log(`Exported ${folders.length} folders and ${count} videos to client/public using ${mediaMode}.`);
