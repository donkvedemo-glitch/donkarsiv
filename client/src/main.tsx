import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, Folder, LogOut, Menu, Play, Plus, Settings, Trash2, Upload, X } from "lucide-react";
import logo from "./assets/donk-arsiv-logo.png";
import "./styles.css";

type VideoItem = { id: number; title: string; url: string; size: number; type: string; poster?: string | null };
type ArchiveFolder = { id: number; name: string; category: string; cover: string; videos: VideoItem[] };
type User = { username: string; password: string; role: "admin" | "user" };

const USERS_KEY = "donk-arsiv-users-v1";
const SESSION_KEY = "donk-arsiv-session-v1";
const API = import.meta.env.VITE_API_URL ?? "";

function App() {
  const [users, setUsers] = useState<User[]>(loadUsers);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeCategory, setActiveCategory] = useState("Hepsi");
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [viewingFolderId, setViewingFolderId] = useState<number | null>(null);
  const [playingVideo, setPlayingVideo] = useState<{ title: string; src: string } | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const coverInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const videoInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const currentUser = users.find((user) => user.username === session) ?? null;
  const isAdmin = currentUser?.role === "admin";
  const categories = useMemo(() => ["Hepsi", ...Array.from(new Set(folders.map((folder) => folder.category)))], [folders]);
  const visibleFolders = activeCategory === "Hepsi" ? folders : folders.filter((folder) => folder.category === activeCategory);
  const editingFolder = folders.find((folder) => folder.id === editingFolderId) ?? null;
  const viewingFolder = folders.find((folder) => folder.id === viewingFolderId) ?? null;

  useEffect(() => {
    void refreshFolders();
  }, []);

  const refreshFolders = async () => setFolders(await api<ArchiveFolder[]>("/api/folders"));
  const runTransition = (action: () => void) => {
    setTransitioning(false);
    window.setTimeout(() => setTransitioning(true), 10);
    window.setTimeout(action, 470);
    window.setTimeout(() => setTransitioning(false), 1180);
  };

  const persistUsers = (nextUsers: User[]) => {
    setUsers(nextUsers);
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
  };

  const login = (username: string, password: string) => {
    const user = users.find((item) => item.username === username && item.password === password);
    if (!user) return false;
    localStorage.setItem(SESSION_KEY, user.username);
    setSession(user.username);
    return true;
  };

  const register = (username: string, password: string) => {
    if (users.some((user) => user.username === username)) return false;
    persistUsers([...users, { username, password, role: "user" }]);
    return login(username, password);
  };

  const logout = () => runTransition(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setEditingFolderId(null);
    setViewingFolderId(null);
    setPlayingVideo(null);
  });

  const addFolder = async () => {
    const nextId = Math.max(0, ...folders.map((folder) => folder.id)) + 1;
    await api("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Klasor ${String(nextId).padStart(2, "0")}`, category: "Yeni Eklenen" }),
    });
    await refreshFolders();
  };

  const updateFolder = async (folderId: number, patch: Partial<ArchiveFolder>) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    await api(`/api/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: patch.name ?? folder.name, category: patch.category ?? folder.category }),
    });
    await refreshFolders();
  };

  const deleteFolder = async (folderId: number) => {
    await api(`/api/folders/${folderId}`, { method: "DELETE" });
    setEditingFolderId(null);
    setViewingFolderId(null);
    await refreshFolders();
  };

  const setCover = async (folderId: number, file?: File) => {
    if (!file) return;
    const body = new FormData();
    body.append("cover", file);
    await api(`/api/folders/${folderId}/cover`, { method: "POST", body });
    await refreshFolders();
  };

  const addVideoFiles = async (folder: ArchiveFolder, files?: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const poster = await createVideoPoster(file);
      const body = new FormData();
      body.append("video", file);
      body.append("title", cleanVideoName(file.name));
      if (poster) body.append("poster", dataUrlToBlob(poster, "image/jpeg"), `${cleanVideoName(file.name)}.jpg`);
      await api(`/api/folders/${folder.id}/videos`, { method: "POST", body });
    }
    await refreshFolders();
  };

  const deleteVideo = async (_folder: ArchiveFolder, videoId: number) => {
    await api(`/api/videos/${videoId}`, { method: "DELETE" });
    await refreshFolders();
  };

  if (!currentUser) return <AuthScreen login={login} register={register} />;

  return (
    <main className={sidebarOpen ? "app sidebarOpen" : "app"}>
      <img className="siteLogo" src={logo} alt="DONK Arsiv" />
      <button className="sidebarToggle" onClick={() => setSidebarOpen((open) => !open)} aria-label="Kategori cubugunu ac veya kapat">
        {sidebarOpen ? <ChevronLeft /> : <Menu />}
      </button>

      <aside className="sidebar">
        <nav className="categoryNav" aria-label="Kategoriler">
          {categories.map((category) => (
            <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)}>
              <Folder />
              <span>{category}</span>
              <small>{category === "Hepsi" ? folders.length : folders.filter((folder) => folder.category === category).length}</small>
            </button>
          ))}
        </nav>
        {isAdmin && <button className="adminAdd" onClick={addFolder}><Plus /><span>Klasor ekle</span></button>}
        <button className="logoutButton" onClick={logout}><LogOut /><span>Cikis</span></button>
      </aside>

      <section className="folderCanvas" aria-label="Arsiv klasorleri">
        {visibleFolders.map((folder) => (
          <article className="folderWrap" key={folder.id}>
            <button className="folderTile" onClick={() => runTransition(() => setViewingFolderId(folder.id))} style={coverStyle(folder.cover)}>
              <span>{folder.name}</span>
              {folder.videos.length > 0 && <b>{folder.videos.length} video</b>}
            </button>
            {isAdmin && <button className="editButton" onClick={() => setEditingFolderId(folder.id)} aria-label={`${folder.name} ayarlari`}><Settings /></button>}
          </article>
        ))}
      </section>

      {editingFolder && (
        <FolderEditor
          folder={editingFolder}
          updateFolder={updateFolder}
          deleteFolder={deleteFolder}
          addVideoFiles={addVideoFiles}
          deleteVideo={deleteVideo}
          setCover={setCover}
          videoInputs={videoInputs}
          coverInputs={coverInputs}
          close={() => setEditingFolderId(null)}
        />
      )}
      {viewingFolder && (
        <FolderViewer
          folder={viewingFolder}
          isAdmin={isAdmin}
          edit={() => runTransition(() => {
            setEditingFolderId(viewingFolder.id);
            setViewingFolderId(null);
          })}
          playVideo={(video) => runTransition(() => setPlayingVideo({ title: video.title, src: absoluteUrl(video.url) }))}
          close={() => runTransition(() => setViewingFolderId(null))}
        />
      )}
      {playingVideo && <VideoPlayer video={playingVideo} close={() => runTransition(() => setPlayingVideo(null))} />}
      {transitioning && <TransitionOverlay />}
    </main>
  );
}

function AuthScreen({ login, register }: { login: (u: string, p: string) => boolean; register: (u: string, p: string) => boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("donk");
  const [password, setPassword] = useState("123");
  const [error, setError] = useState("");
  const [transitioning, setTransitioning] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setTransitioning(true);
    window.setTimeout(() => {
      const ok = mode === "login" ? login(username.trim(), password) : register(username.trim(), password);
      if (!ok) {
        setTransitioning(false);
        setError(mode === "login" ? "Kullanici adi veya sifre hatali." : "Bu kullanici zaten var.");
      }
    }, 930);
  };

  return (
    <main className="authPage">
      <img className="authLogo" src={logo} alt="DONK Arsiv" />
      <form className="authPanel" onSubmit={submit}>
        <div className="authTabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Giris</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Kayit</button>
        </div>
        <label>Kullanici adi<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Sifre<input value={password} type="password" onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="authError">{error}</p>}
        <button className="submitButton" type="submit">{mode === "login" ? "Giris yap" : "Kayit ol"}</button>
      </form>
      {transitioning && <TransitionOverlay />}
    </main>
  );
}

function TransitionOverlay() {
  return <div className="transitionOverlay" aria-hidden="true"><div className="transitionVeil" /><img src={logo} alt="" /></div>;
}

function FolderEditor({
  folder,
  updateFolder,
  deleteFolder,
  addVideoFiles,
  deleteVideo,
  setCover,
  videoInputs,
  coverInputs,
  close,
}: {
  folder: ArchiveFolder;
  updateFolder: (id: number, patch: Partial<ArchiveFolder>) => void;
  deleteFolder: (id: number) => void;
  addVideoFiles: (folder: ArchiveFolder, files?: FileList | null) => void;
  deleteVideo: (folder: ArchiveFolder, videoId: number) => void;
  setCover: (folderId: number, file?: File) => void;
  videoInputs: React.MutableRefObject<Record<number, HTMLInputElement | null>>;
  coverInputs: React.MutableRefObject<Record<number, HTMLInputElement | null>>;
  close: () => void;
}) {
  return (
    <div className="editorOverlay">
      <section className="editorPanel">
        <button className="closeButton" onClick={close} aria-label="Kapat"><X /></button>
        <h2>{folder.name}</h2>
        <label>Klasor adi<input value={folder.name} onChange={(event) => updateFolder(folder.id, { name: event.target.value })} /></label>
        <label>Kategori<input value={folder.category} onChange={(event) => updateFolder(folder.id, { category: event.target.value })} /></label>
        <div className="editorActions">
          <button onClick={() => coverInputs.current[folder.id]?.click()}><Upload /> Kapak yukle</button>
          <button onClick={() => videoInputs.current[folder.id]?.click()}><Plus /> Video yukle</button>
          <button className="danger" onClick={() => deleteFolder(folder.id)}><Trash2 /> Klasoru sil</button>
        </div>
        <input className="hiddenFile" ref={(node) => { coverInputs.current[folder.id] = node; }} type="file" accept="image/*" onChange={(event) => setCover(folder.id, event.target.files?.[0])} />
        <input className="hiddenFile" ref={(node) => { videoInputs.current[folder.id] = node; }} type="file" accept="video/*" multiple onChange={(event) => addVideoFiles(folder, event.target.files)} />
        <div className="videoList">
          {folder.videos.length === 0 && <p>Bu klasorde video yok.</p>}
          {folder.videos.map((video) => (
            <div className="videoRow" key={video.id}>
              <span>{video.title}</span>
              <small>{formatBytes(video.size)}</small>
              <button onClick={() => deleteVideo(folder, video.id)}><Trash2 /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FolderViewer({ folder, isAdmin, edit, playVideo, close }: { folder: ArchiveFolder; isAdmin: boolean; edit: () => void; playVideo: (video: VideoItem) => void; close: () => void }) {
  return (
    <div className="folderViewPage">
      <div className="folderViewHead">
        <div><p>{folder.category}</p><h1>{folder.name}</h1></div>
        <div className="folderViewActions">
          {isAdmin && <button className="softButton" onClick={edit}><Settings /> Duzenle</button>}
          <button className="softButton" onClick={close}><X /> Kapat</button>
        </div>
      </div>
      <section className="videoShelf" aria-label={`${folder.name} videolari`}>
        {folder.videos.length === 0 && <p className="emptyShelf">Bu klasorde henuz video yok.</p>}
        {folder.videos.map((video) => (
          <button className="videoPosterCard" key={video.id} onClick={() => playVideo(video)} style={posterStyle(video.poster)}>
            <span className="playMark"><Play /></span>
          </button>
        ))}
      </section>
    </div>
  );
}

function VideoPlayer({ video, close }: { video: { title: string; src: string }; close: () => void }) {
  return (
    <div className="playerOverlay">
      <section className="playerPanel">
        <button className="closeButton" onClick={close} aria-label="Kapat"><X /></button>
        <h2>{video.title}</h2>
        <video src={video.src} controls autoPlay />
      </section>
    </div>
  );
}

function loadUsers(): User[] {
  const stored = localStorage.getItem(USERS_KEY);
  const users = stored ? (JSON.parse(stored) as User[]) : [];
  if (users.some((user) => user.username === "donk")) return users;
  const nextUsers: User[] = [{ username: "donk", password: "123", role: "admin" }, ...users];
  localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
  return nextUsers;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: "Islem basarisiz" }))).error);
  return res.json();
}

function absoluteUrl(value?: string | null) {
  if (!value) return "";
  return value.startsWith("http") ? value : `${API}${value}`;
}

function coverStyle(value: string) {
  if (value.startsWith("/uploads") || value.startsWith("http")) return { backgroundImage: `url("${absoluteUrl(value)}")` } as React.CSSProperties;
  return { backgroundColor: value } as React.CSSProperties;
}

function posterStyle(poster?: string | null) {
  return poster ? ({ backgroundImage: `url("${absoluteUrl(poster)}")` } as React.CSSProperties) : undefined;
}

function createVideoPoster(file: Blob) {
  return new Promise<string | undefined>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let resolved = false;
    const done = (value?: string) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement("canvas");
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        canvas.width = 640;
        canvas.height = Math.max(1, Math.round((height / width) * canvas.width));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.78));
      } catch {
        done();
      }
    };
    video.onerror = () => done();
    window.setTimeout(() => done(), 3500);
  });
}

function dataUrlToBlob(dataUrl: string, fallbackType = "application/octet-stream") {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || fallbackType;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function cleanVideoName(name: string) {
  return name.replace(/\.[^/.]+$/, "");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<App />);
