import type { CursorTelemetryPoint } from "@/components/video-editor/types";

type CaptureStatus = "recording" | "paused" | "saving";

type CaptureStateDetail = {
	status: CaptureStatus;
	elapsed: number;
};

let recorder: MediaRecorder | null = null;
let displayStream: MediaStream | null = null;
let microphoneStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let chunks: Blob[] = [];
let segmentStartedAt = 0;
let elapsedBeforePause = 0;
let ticker: number | null = null;
let cursorTelemetry: CursorTelemetryPoint[] = [];
let lastPointerSampleMs = -Infinity;
let removePointerListeners: (() => void) | null = null;

function elapsedNow() {
	return elapsedBeforePause + (recorder?.state === "recording" ? Date.now() - segmentStartedAt : 0);
}

function emitState(status: CaptureStatus) {
	window.dispatchEvent(
		new CustomEvent<CaptureStateDetail>("recordly:web-capture-state", {
			detail: { status, elapsed: elapsedNow() },
		}),
	);
}

function clearCapture() {
	if (ticker !== null) window.clearInterval(ticker);
	ticker = null;
	removePointerListeners?.();
	removePointerListeners = null;
	displayStream?.getTracks().forEach((track) => track.stop());
	microphoneStream?.getTracks().forEach((track) => track.stop());
	displayStream = null;
	microphoneStream = null;
	void audioContext?.close().catch(() => undefined);
	audioContext = null;
	recorder = null;
	chunks = [];
	segmentStartedAt = 0;
	elapsedBeforePause = 0;
	cursorTelemetry = [];
	lastPointerSampleMs = -Infinity;
}

function startCursorTelemetryCapture() {
	const samplePointer = (
		event: PointerEvent,
		interactionType: CursorTelemetryPoint["interactionType"] = "move",
	) => {
		const timeMs = Math.round(elapsedNow());
		if (interactionType === "move" && timeMs - lastPointerSampleMs < 33) return;
		lastPointerSampleMs = timeMs;
		cursorTelemetry.push({
			timeMs,
			cx: Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth))),
			cy: Math.min(1, Math.max(0, event.clientY / Math.max(1, window.innerHeight))),
			interactionType,
			cursorType: "arrow",
		});
	};
	const handlePointerMove = (event: PointerEvent) => samplePointer(event);
	const handlePointerDown = (event: PointerEvent) => {
		samplePointer(
			event,
			event.button === 1 ? "middle-click" : event.button === 2 ? "right-click" : "click",
		);
	};
	const handlePointerUp = (event: PointerEvent) => samplePointer(event, "mouseup");

	window.addEventListener("pointermove", handlePointerMove, true);
	window.addEventListener("pointerdown", handlePointerDown, true);
	window.addEventListener("pointerup", handlePointerUp, true);
	removePointerListeners = () => {
		window.removeEventListener("pointermove", handlePointerMove, true);
		window.removeEventListener("pointerdown", handlePointerDown, true);
		window.removeEventListener("pointerup", handlePointerUp, true);
	};
}

export function openBrowserCapture() {
	window.dispatchEvent(new CustomEvent("recordly:web-capture-open"));
}

export async function startBrowserCapture(options: {
	withSystemAudio: boolean;
	withMicrophone: boolean;
}) {
	if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
		throw new Error("Screen recording is not supported in this browser.");
	}

	try {
		displayStream = await navigator.mediaDevices.getDisplayMedia({
			video: { frameRate: { ideal: 30, max: 60 }, cursor: "always" },
			audio: options.withSystemAudio,
		});
		if (options.withMicrophone) {
			microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		}

		const videoTracks = displayStream.getVideoTracks();
		const audioTracks = [
			...displayStream.getAudioTracks(),
			...(microphoneStream?.getAudioTracks() ?? []),
		];
		const tracks = [...videoTracks];
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

		const mimeType = [
			"video/webm;codecs=vp9,opus",
			"video/webm;codecs=vp8,opus",
			"video/webm",
		].find((candidate) => MediaRecorder.isTypeSupported(candidate));
		recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
		chunks = [];
		cursorTelemetry = [];
		lastPointerSampleMs = -Infinity;
		elapsedBeforePause = 0;
		segmentStartedAt = Date.now();
		startCursorTelemetryCapture();
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.onstop = () => {
			const blob = new Blob(chunks, { type: recorder?.mimeType || "video/webm" });
			const duration = elapsedBeforePause / 1000;
			const capturedCursorTelemetry = cursorTelemetry;
			clearCapture();
			window.dispatchEvent(
				new CustomEvent("recordly:web-capture-ready", {
					detail: { blob, duration, cursorTelemetry: capturedCursorTelemetry },
				}),
			);
		};
		displayStream.getVideoTracks()[0]?.addEventListener(
			"ended",
			stopBrowserCapture,
			{ once: true },
		);
		recorder.start(1000);
		emitState("recording");
		ticker = window.setInterval(() => emitState(recorder?.state === "paused" ? "paused" : "recording"), 250);
	} catch (error) {
		clearCapture();
		throw error;
	}
}

export function pauseBrowserCapture() {
	if (!recorder || recorder.state !== "recording") return;
	const elapsed = elapsedNow();
	recorder.pause();
	elapsedBeforePause = elapsed;
	segmentStartedAt = 0;
	emitState("paused");
}

export function resumeBrowserCapture() {
	if (!recorder || recorder.state !== "paused") return;
	segmentStartedAt = Date.now();
	recorder.resume();
	emitState("recording");
}

export function stopBrowserCapture() {
	if (!recorder || recorder.state === "inactive") return;
	elapsedBeforePause = elapsedNow();
	segmentStartedAt = 0;
	emitState("saving");
	recorder.stop();
}