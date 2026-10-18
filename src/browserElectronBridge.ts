import { openBrowserCapture } from "./browserCapture";

const unavailable = { success: false, error: "This feature requires the Recordly desktop app." };

function createDemoVideoUrl(): Promise<string> {
	if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
		return Promise.resolve("");
	}

	return new Promise((resolve) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1280;
		canvas.height = 720;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			resolve("");
			return;
		}

		const stream = canvas.captureStream(30);
		const recorded: BlobPart[] = [];
		const mimeType = [
			"video/webm;codecs=vp9,opus",
			"video/webm;codecs=vp8,opus",
			"video/webm",
		].find((candidate) => MediaRecorder.isTypeSupported(candidate));
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

		let startedAt = 0;
		const renderFrame = () => {
			const t = (performance.now() - startedAt) / 1000;
			const x = 640 + Math.sin(t * 1.3) * 280;
			const y = 360 + Math.cos(t * 1.7) * 180;
			const scale = 1 + Math.sin(t * 2.1) * 0.12;

			ctx.fillStyle = "#091018";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "#15252f";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
			gradient.addColorStop(0, "#1d4ed8");
			gradient.addColorStop(0.5, "#0f766e");
			gradient.addColorStop(1, "#111827");
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.save();
			ctx.translate(canvas.width / 2, canvas.height / 2);
			ctx.scale(scale, scale);
			ctx.translate(-canvas.width / 2, -canvas.height / 2);
			ctx.fillStyle = "rgba(255,255,255,0.08)";
			for (let row = 0; row < 9; row += 1) {
				for (let col = 0; col < 14; col += 1) {
					ctx.fillRect(col * 100 + 20, row * 90 + 18, 52, 52);
				}
			}
			ctx.restore();

			ctx.beginPath();
			ctx.fillStyle = "rgba(255,255,255,0.9)";
			ctx.arc(x, y, 42, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.fillStyle = "rgba(16,185,129,0.8)";
			ctx.arc(x, y, 18, 0, Math.PI * 2);
			ctx.fill();

			ctx.strokeStyle = "rgba(255,255,255,0.8)";
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(180, 540);
			ctx.lineTo(320, 420);
			ctx.lineTo(520, 470);
			ctx.lineTo(780, 250);
			ctx.lineTo(990, 360);
			ctx.stroke();

			ctx.fillStyle = "rgba(255,255,255,0.7)";
			ctx.fillRect(150, 560, 980, 80);
			ctx.fillStyle = "#0b1220";
			ctx.fillRect(170, 580, 160, 30);
			ctx.fillRect(560, 580, 190, 30);
			ctx.fillRect(780, 580, 220, 30);
		};

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) recorded.push(event.data);
		};

		recorder.onstop = () => {
			const blob = new Blob(recorded, { type: "video/webm" });
			const url = URL.createObjectURL(blob);
			Object.defineProperty(window, "__RECORDLY_DEMO_VIDEO_URL__", {
				configurable: true,
				value: url,
			});
			resolve(url);
		};

		recorder.start();
		startedAt = performance.now();
		const loop = () => {
			const elapsed = performance.now() - startedAt;
			renderFrame();
			if (elapsed < 5200) {
				requestAnimationFrame(loop);
			} else {
				recorder.stop();
			}
		};
		requestAnimationFrame(loop);
	});
}

const demoVideoUrlPromise = createDemoVideoUrl();

const browserMethods: Record<string, (...args: unknown[]) => unknown> = {
	getAppSetting: (key) => {
		try {
			const value = localStorage.getItem(String(key));
			return value === null ? null : JSON.parse(value);
		} catch {
			return null;
		}
	},
	setAppSetting: (key, value) => {
		try {
			localStorage.setItem(String(key), JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	},
	getPlatform: () => Promise.resolve("win32"),
	getCurrentVideoPath: async () => {
		const url =
			(window as Window & { __RECORDLY_DEMO_VIDEO_URL__?: string }).__RECORDLY_DEMO_VIDEO_URL__ ||
			(await demoVideoUrlPromise);
		return url ? { success: true, path: url } : { success: false };
	},
	getCurrentRecordingSession: () => Promise.resolve({ success: false }),
	loadCurrentProjectFile: () => Promise.resolve({ success: false }),
	listProjectFiles: () => Promise.resolve({ success: true, entries: [] }),
	getNativeExportCapabilities: () => Promise.resolve({ success: false }),
	showRecordingHud: () => {
		openBrowserCapture();
		return Promise.resolve();
	},
	openVideoFilePicker: () =>
		new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = "video/*";
			input.onchange = () => {
				const file = input.files?.[0];
				resolve(
					file
						? { success: true, kind: "media", path: URL.createObjectURL(file) }
						: { success: false, canceled: true },
				);
			};
			input.click();
		}),
	setCurrentVideoPath: () => Promise.resolve({ success: true }),
};

const browserApi = new Proxy({} as Window["electronAPI"], {
	get(_target, property) {
		if (typeof property !== "string") return undefined;
		if (property in browserMethods) return browserMethods[property];
		if (property.startsWith("on")) return () => () => undefined;
		return () => Promise.resolve(unavailable);
	},
});

if (!window.electronAPI) {
	Object.defineProperty(window, "electronAPI", { configurable: true, value: browserApi });
}

Object.defineProperty(window, "__RECORDLY_WEB__", { configurable: true, value: true });