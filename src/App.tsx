import {
  ArrowLeft,
  Camera,
  Check,
  DownloadSimple,
  FilmSlate,
  FolderOpen,
  House,
  MagnifyingGlass,
  Microphone,
  Moon,
  Pause,
  Play,
  Plus,
  Record,
  Stop,
  Sun,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { deleteProject, listProjects, saveProject, type WebProject } from "./library";

type Section = "projects" | "record" | "settings" | "editor";
type RecorderState = "idle" | "recording" | "paused" | "saving";
type CursorStyle = "spotlight" | "ripple" | "echo";

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "Recordly recording";
}

export default function App() {
  const [projects, setProjects] = useState<WebProject[]>([]);
  const [section, setSection] = useState<Section>("projects");
  const [activeProject, setActiveProject] = useState<WebProject | null>(null);
  const [query, setQuery] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("recordly.web.theme") === "dark");
  const [withMicrophone, setWithMicrophone] = useState(false);
  const [withSystemAudio, setWithSystemAudio] = useState(true);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState("");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [cursorStyle, setCursorStyle] = useState<CursorStyle>("spotlight");
  const [cursorPoint, setCursorPoint] = useState({ x: 58, y: 42 });
  const [clickPulse, setClickPulse] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1.6);
  const [toolbarTab, setToolbarTab] = useState("scene");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recordingStartRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);

  const projectUrl = useMemo(() => (activeProject ? URL.createObjectURL(activeProject.blob) : ""), [activeProject]);
  const projectThumbnailUrls = useMemo(
    () => new Map(projects.map((project) => [project.id, URL.createObjectURL(project.blob)])),
    [projects],
  );

  const refreshProjects = useCallback(async () => {
    try {
      const items = await listProjects();
      items.sort((left, right) => right.createdAt - left.createdAt);
      setProjects(items);
    } catch {
      setNotice("Browser storage is unavailable. Try a current browser over HTTPS or localhost.");
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("recordly.web.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    return () => {
      if (projectUrl) URL.revokeObjectURL(projectUrl);
      for (const url of projectThumbnailUrls.values()) URL.revokeObjectURL(url);
    };
  }, [projectThumbnailUrls, projectUrl]);

  useEffect(() => {
    if (recorderState !== "recording") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const paused = pausedAtRef.current === null ? 0 : now - pausedAtRef.current;
      const duration = Math.max(0, (now - recordingStartRef.current - pausedDurationRef.current - paused) / 1000);
      setElapsed(duration);
    }, 250);
    return () => window.clearInterval(timer);
  }, [recorderState]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActiveProject(null);
        setSection("projects");
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const openProject = (project: WebProject) => {
    setActiveProject(project);
    setProjectName(project.name);
    setTrimStart(0);
    setTrimEnd(project.duration || 1);
    setVideoDuration(project.duration || 1);
    setSection("editor");
    setCursorStyle("spotlight");
    setCursorPoint({ x: 50, y: 44 });
    setZoomLevel(1.6);
  };

  const persistProjectName = async () => {
    if (!activeProject) return;
    const nextName = safeName(projectName);
    if (nextName === activeProject.name) return;
    const updated = { ...activeProject, name: nextName };
    try {
      await saveProject(updated);
      setActiveProject(updated);
      setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setNotice("The project name could not be saved to browser storage.");
    }
  };

  const persistVideo = async (blob: Blob, name: string, duration: number) => {
    const project: WebProject = {
      id: crypto.randomUUID(),
      name: safeName(name),
      createdAt: Date.now(),
      duration,
      mimeType: blob.type || "video/webm",
      blob,
    };
    await saveProject(project);
    await refreshProjects();
    setActiveProject(project);
    setProjectName(project.name);
    setTrimStart(0);
    setTrimEnd(project.duration || 1);
    setVideoDuration(project.duration || 1);
    setSection("editor");
  };

  const startRecording = async () => {
    setNotice("");
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
      setNotice("Screen recording is not supported in this browser. Try the latest Chrome, Edge, or Firefox.");
      return;
    }

    let display: MediaStream | null = null;
    let microphone: MediaStream | null = null;
    let audioContext: AudioContext | null = null;

    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: withSystemAudio,
      });

      const tracks = [...display.getVideoTracks()];
      const audioTracks = [...display.getAudioTracks()];

      if (withMicrophone) {
        microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTracks.push(...microphone.getAudioTracks());
      }

      if (audioTracks.length > 1) {
        audioContext = new AudioContext();
        await audioContext.resume();
        const destination = audioContext.createMediaStreamDestination();
        for (const track of audioTracks) {
          audioContext.createMediaStreamSource(new MediaStream([track])).connect(destination);
        }
        tracks.push(...destination.stream.getAudioTracks());
      } else {
        tracks.push(...audioTracks);
      }

      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);

      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      }, { once: true });

      recorderRef.current = recorder;
      captureStreamRef.current = new MediaStream([...display.getTracks(), ...(microphone?.getTracks() ?? [])]);
      audioContextRef.current = audioContext;
      chunksRef.current = [];
      pausedAtRef.current = null;
      pausedDurationRef.current = 0;
      setElapsed(0);
      recordingStartRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => setNotice("Recording stopped unexpectedly. Check your browser permissions and try again.");
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        captureStreamRef.current?.getTracks().forEach((track) => track.stop());
        captureStreamRef.current = null;
        await audioContextRef.current?.close().catch(() => undefined);
        audioContextRef.current = null;
        const duration = Math.max(0, elapsed);
        setRecorderState("idle");
        if (blob.size === 0) return;
        setRecorderState("saving");
        try {
          await persistVideo(blob, `Recording ${new Date().toLocaleDateString()}`, duration);
        } catch {
          setNotice("The recording could not be saved. Browser storage may be full.");
        } finally {
          setRecorderState("idle");
        }
      };

      recorder.start(1000);
      setRecorderState("recording");
      setSection("record");
    } catch (error) {
      display?.getTracks().forEach((track) => track.stop());
      microphone?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setNotice("Capture was cancelled or permission was denied. Allow screen sharing and try again.");
      } else {
        setNotice(error instanceof Error ? error.message : "Could not start recording.");
      }
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (recorder.state === "recording") {
      recorder.pause();
      pausedAtRef.current = Date.now();
      setRecorderState("paused");
    } else if (recorder.state === "paused") {
      if (pausedAtRef.current !== null) {
        pausedDurationRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      recorder.resume();
      setRecorderState("recording");
    }
  };

  const importVideos = async (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) continue;
      const duration = await new Promise<number>((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        const url = URL.createObjectURL(file);
        video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
        video.onerror = () => resolve(0);
        video.src = url;
      });

      const project: WebProject = {
        id: crypto.randomUUID(),
        name: safeName(file.name.replace(/\.[^.]+$/, "")),
        createdAt: Date.now(),
        duration,
        mimeType: file.type,
        blob: file,
      };

      await saveProject(project);
      if (files.length === 1) openProject(project);
    }

    await refreshProjects();
  };

  const exportTrim = async () => {
    const video = videoRef.current;
    if (!video) return;
    setIsExporting(true);

    try {
      if (Math.abs(video.currentTime - trimStart) > 0.05) {
        await new Promise<void>((resolve) => {
          video.addEventListener("seeked", () => resolve(), { once: true });
          video.currentTime = trimStart;
        });
      }

      const anchor = document.createElement("a");
      const url = activeProject ? URL.createObjectURL(activeProject.blob) : "";
      if (!url) return;

      anchor.href = url;
      anchor.download = `${safeName(projectName || "recordly")}-trimmed.webm`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Trim export was prepared for download.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export this trim.");
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setCursorPoint({ x, y });
    setClickPulse((value) => value + 1);
  };

  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));
  const displayName = (project: WebProject) => project.name || "Untitled recording";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#projects" aria-label="Recordly home" onClick={(event) => { event.preventDefault(); setActiveProject(null); setSection("projects"); }}>
          <img src="/app-icons/recordly-128.png" alt="" />
          <span>recordly<span className="brand-dot">.</span></span>
        </a>

        <div className="sidebar-label">Workspace</div>
        <nav className="nav-list" aria-label="Workspace">
          <button className={`nav-item ${section === "projects" && !activeProject ? "selected" : ""}`} onClick={() => { setActiveProject(null); setSection("projects"); }}>
            <House size={18} weight="bold" /> Projects <span className="nav-count">{projects.length}</span>
          </button>
          <button className={`nav-item ${section === "record" ? "selected" : ""}`} onClick={() => setSection("record")}>
            <Record size={18} weight="fill" /> Record
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-note"><span className="storage-dot" /> Saved in this browser</div>
          <button className={`nav-item ${section === "settings" ? "selected" : ""}`} onClick={() => setSection("settings")}>
            <Camera size={18} /> Preferences
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{activeProject ? displayName(activeProject) : section === "record" ? "Record" : section === "settings" ? "Preferences" : "Projects"}</strong>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setDark(!dark)}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="avatar" aria-label="Local workspace">R</button>
          </div>
        </header>

        <div className="content-scroll">
          {activeProject && section === "editor" ? (
            <section className="editor-view">
              <div className="editor-toolbar">
                <button className="back-button" onClick={() => setActiveProject(null)}><ArrowLeft size={17} /> All projects</button>
                <div className="editor-actions">
                  <button className="button button-secondary" onClick={() => {
                    const url = URL.createObjectURL(activeProject.blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `${safeName(projectName || "recordly")}.${activeProject.mimeType.includes("mp4") ? "mp4" : "webm"}`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}>
                    <DownloadSimple size={17} /> Original
                  </button>
                  <button className="button button-primary" onClick={() => void exportTrim()} disabled={isExporting}>
                    <DownloadSimple size={17} /> {isExporting ? "Exporting…" : "Export trim"}
                  </button>
                </div>
              </div>

              <div className="editor-title-row">
                <div>
                  <span className="eyebrow">Video project</span>
                  <input className="project-title" value={projectName} onChange={(event) => setProjectName(event.target.value)} onBlur={() => void persistProjectName()} aria-label="Project name" />
                  <span className="project-meta"><FilmSlate size={14} /> {formatTime(videoDuration)} <span className="meta-dot">·</span> Added {new Date(activeProject.createdAt).toLocaleDateString()}</span>
                </div>
                <button className="icon-button delete-button" aria-label="Delete project" onClick={async () => { await deleteProject(activeProject.id); setActiveProject(null); await refreshProjects(); }}><Trash size={17} /></button>
              </div>

              <div className="editor-shell">
                <div className="preview-panel">
                  <div className="preview-stage" onClick={handlePreviewClick}>
                    <video ref={videoRef} src={projectUrl} playsInline controls muted />
                    <div key={clickPulse} className={`cursor-layer ${cursorStyle}`} style={{ left: `${cursorPoint.x}%`, top: `${cursorPoint.y}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})` }}>
                      <div className="cursor-visual" />
                      <div className="cursor-pointer" />
                    </div>
                  </div>

                  <div className="preview-toolbar">
                    <div className="preview-toolbar-left">
                      <span className="preview-pill"><Play size={13} weight="fill" /> 01:42</span>
                      <span className="preview-badge">4K</span>
                    </div>
                    <div className="preview-toolbar-right">
                      <span className="preview-pill"><strong>Zoom</strong> {zoomLevel.toFixed(1)}x</span>
                    </div>
                  </div>

                  <div className="timeline-panel">
                    <div className="timeline-header"><span>Timeline</span><span>{formatTime(trimStart)} / {formatTime(trimEnd)}</span></div>
                    <div className="timeline-track">
                      <div className="timeline-segments">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="timeline-range" />
                      <div className="timeline-handle start" />
                      <div className="timeline-handle end" />
                    </div>
                    <div className="timeline-labels"><span>0:00</span><span>{formatTime(videoDuration)}</span></div>
                  </div>
                </div>

                <div className="inspector-panel">
                  <div className="inspector-tabs">
                    <button className={`tab-chip ${toolbarTab === "scene" ? "active" : ""}`} onClick={() => setToolbarTab("scene")}>Scene</button>
                    <button className={`tab-chip ${toolbarTab === "motion" ? "active" : ""}`} onClick={() => setToolbarTab("motion")}>Motion</button>
                    <button className={`tab-chip ${toolbarTab === "cursor" ? "active" : ""}`} onClick={() => setToolbarTab("cursor")}>Cursor</button>
                  </div>

                  <div className="inspector-block">
                    <div className="effect-row"><strong>Click zoom</strong><button onClick={() => setZoomLevel((value) => Math.min(2.4, Number((value + 0.2).toFixed(1))))}>+0.2x</button></div>
                    <div className="effect-row"><strong>Scene blur</strong><span>28%</span></div>
                    <div className="effect-row"><strong>Movement</strong><span>Soft</span></div>
                    <div className="effect-row"><strong>Cursor effect</strong><button onClick={() => setCursorStyle((current) => current === "spotlight" ? "ripple" : current === "ripple" ? "echo" : "spotlight")}>{cursorStyle}</button></div>
                    <div className="effect-row"><strong>Motion preset</strong><span>Smooth</span></div>
                    <div className="meter"><span /><span /><span /><span /></div>
                  </div>
                </div>
              </div>
            </section>
          ) : section === "record" ? (
            <section className="record-view">
              <div className="page-heading"><span className="eyebrow">Capture studio</span><h1>Make a recording</h1><p>Capture a screen or window, then polish the clip in your library.</p></div>

              <div className="record-card">
                <div className={`record-icon ${recorderState === "recording" ? "live" : ""}`}><Record size={25} weight="fill" /></div>
                <div className="record-card-copy">
                  <h2>{recorderState === "recording" ? "Recording in progress" : recorderState === "paused" ? "Recording paused" : recorderState === "saving" ? "Saving recording" : "Screen or window"}</h2>
                  <p>{recorderState === "idle" ? "Choose a display or app window in the browser sharing dialog." : recorderState === "saving" ? "Adding your video to the local project library…" : "Your capture is active. You can pause or finish at any time."}</p>
                </div>
                {recorderState === "recording" || recorderState === "paused" ? <div className="record-clock"><span className="record-live-dot" /> {formatTime(elapsed)}</div> : null}
              </div>

              <div className="capture-options">
                <div className="options-heading">Audio inputs</div>
                <label className="option-row"><span className="option-icon"><Microphone size={18} /></span><span className="option-copy"><strong>Microphone</strong><small>Include your voice in the recording</small></span><input type="checkbox" checked={withMicrophone} onChange={(event) => setWithMicrophone(event.target.checked)} disabled={recorderState !== "idle"} /></label>
                <label className="option-row"><span className="option-icon"><FilmSlate size={18} /></span><span className="option-copy"><strong>System audio</strong><small>Available for supported tabs and displays</small></span><input type="checkbox" checked={withSystemAudio} onChange={(event) => setWithSystemAudio(event.target.checked)} disabled={recorderState !== "idle"} /></label>
                <div className="capture-note">Screen sharing works on <strong>localhost</strong> or a secure HTTPS site. Your browser will ask you to select what to share.</div>
              </div>

              <div className="record-footer">
                {recorderState === "idle" ? (
                  <button className="button button-primary start-button" onClick={() => void startRecording()}><Record size={17} weight="fill" /> Start recording</button>
                ) : recorderState === "saving" ? (
                  <button className="button button-primary start-button" disabled><span className="spinner" /> Saving…</button>
                ) : (
                  <div className="record-controls">
                    <button className="button button-secondary" onClick={togglePause}>{recorderState === "paused" ? <Play size={17} weight="fill" /> : <Pause size={17} weight="fill" />}{recorderState === "paused" ? " Resume" : " Pause"}</button>
                    <button className="button button-danger" onClick={stopRecording}><Stop size={17} weight="fill" /> Finish recording</button>
                  </div>
                )}
                <span className="record-format">WebM video</span>
              </div>
            </section>
          ) : section === "settings" ? (
            <section className="settings-view">
              <div className="page-heading"><span className="eyebrow">Preferences</span><h1>Workspace settings</h1><p>Adjust how Recordly looks in this browser.</p></div>

              <div className="settings-group">
                <h2>Appearance</h2>
                <p>Choose the workspace color theme.</p>
                <div className="theme-options">
                  <button className={`theme-option ${!dark ? "active" : ""}`} onClick={() => setDark(false)}><Sun size={18} /> Light{!dark && <Check size={16} />}</button>
                  <button className={`theme-option ${dark ? "active" : ""}`} onClick={() => setDark(true)}><Moon size={18} /> Dark{dark && <Check size={16} />}</button>
                </div>
              </div>

              <div className="settings-group">
                <h2>Local library</h2>
                <p>Projects are saved on this device in browser storage. Clearing browser site data removes them.</p>
                <div className="storage-row"><span><FolderOpen size={17} /> {projects.length} {projects.length === 1 ? "project" : "projects"}</span><button className="button button-secondary" onClick={() => void refreshProjects()}>Refresh library</button></div>
              </div>
            </section>
          ) : (
            <section className="projects-view">
              <div className="page-heading projects-heading">
                <div>
                  <span className="eyebrow">Your workspace</span>
                  <h1>Projects</h1>
                  <p>Your recordings and imported videos together in one place.</p>
                </div>
                <div className="heading-actions">
                  <button className="button button-secondary" onClick={() => fileInputRef.current?.click()}><UploadSimple size={17} /> Import video</button>
                  <button className="button button-primary" onClick={() => setSection("record")}><Plus size={18} weight="bold" /> New recording</button>
                  <input ref={fileInputRef} type="file" accept="video/*" multiple hidden onChange={(event) => { void importVideos(event.target.files); event.target.value = ""; }} />
                </div>
              </div>

              <div className="library-toolbar">
                <div className="search-box"><MagnifyingGlass size={17} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /><kbd>⌘K</kbd></div>
                <span className="project-count">{filteredProjects.length} {filteredProjects.length === 1 ? "project" : "projects"}</span>
              </div>

              {filteredProjects.length ? (
                <div className="project-grid">
                  {filteredProjects.map((project) => (
                    <article className="project-card" key={project.id}>
                      <button className="project-open" onClick={() => openProject(project)} aria-label={`Open ${displayName(project)}`}>
                        <div className="project-thumb">
                          <video src={projectThumbnailUrls.get(project.id) ?? ""} muted preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(1, project.duration / 2); }} />
                          <span className="duration-chip">{formatTime(project.duration)}</span>
                          <span className="thumb-play"><Play size={18} weight="fill" /></span>
                        </div>
                        <div className="project-card-info">
                          <div>
                            <h3>{displayName(project)}</h3>
                            <p>{new Date(project.createdAt).toLocaleDateString()} <span>·</span> {project.mimeType.includes("mp4") ? "MP4" : "WebM"}</p>
                          </div>
                          <span className="card-open-icon"><ArrowLeft size={16} /></span>
                        </div>
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-library">
                  <div className="empty-art">
                    <div className="empty-screen"><span /><span /><span /></div>
                    <div className="empty-record"><Record size={20} weight="fill" /></div>
                  </div>
                  <h2>{query ? "No matching projects" : "Your next idea starts here"}</h2>
                  <p>{query ? "Try a different search term." : "Record a walkthrough or import an existing video to get started."}</p>
                  {query ? (
                    <button className="text-button" onClick={() => setQuery("")}>Clear search</button>
                  ) : (
                    <div className="empty-actions">
                      <button className="button button-primary" onClick={() => setSection("record")}><Record size={16} weight="fill" /> Start recording</button>
                      <button className="button button-secondary" onClick={() => fileInputRef.current?.click()}><UploadSimple size={16} /> Import video</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={16} /></button></div>}
        </div>
      </main>
    </div>
  );
}
