import { useEffect, useState } from "react";
import {
	MicrophoneIcon,
	MonitorIcon,
	PauseIcon,
	PlayIcon,
	X,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import {
	openBrowserCapture,
	pauseBrowserCapture,
	resumeBrowserCapture,
	startBrowserCapture,
	stopBrowserCapture,
} from "./browserCapture";

type CaptureState = "idle" | "recording" | "paused" | "saving";

function formatTime(milliseconds: number) {
	const seconds = Math.floor(milliseconds / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function WebCaptureOverlay() {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<CaptureState>("idle");
	const [elapsed, setElapsed] = useState(0);
	const [withMicrophone, setWithMicrophone] = useState(false);
	const [withSystemAudio, setWithSystemAudio] = useState(true);
	const [error, setError] = useState("");

	useEffect(() => {
		const handleOpen = () => {
			setError("");
			setState("idle");
			setElapsed(0);
			setOpen(true);
		};
		const handleState = (event: Event) => {
			const detail = (event as CustomEvent<{ status: CaptureState; elapsed: number }>).detail;
			setState(detail.status);
			setElapsed(detail.elapsed);
		};
		const handleReady = (event: Event) => {
			const detail = (
				event as CustomEvent<{
					blob: Blob;
					duration: number;
					cursorTelemetry: CursorTelemetryPoint[];
				}>
			).detail;
			setOpen(false);
			window.dispatchEvent(new CustomEvent("recordly:web-recording-ready", { detail }));
		};
		const handleError = (event: Event) => {
			setState("idle");
			setError((event as CustomEvent<string>).detail);
		};
		window.addEventListener("recordly:web-capture-open", handleOpen);
		window.addEventListener("recordly:web-capture-state", handleState);
		window.addEventListener("recordly:web-capture-ready", handleReady);
		window.addEventListener("recordly:web-capture-error", handleError);
		return () => {
			window.removeEventListener("recordly:web-capture-open", handleOpen);
			window.removeEventListener("recordly:web-capture-state", handleState);
			window.removeEventListener("recordly:web-capture-ready", handleReady);
			window.removeEventListener("recordly:web-capture-error", handleError);
		};
	}, []);

	const start = async () => {
		setError("");
		try {
			await startBrowserCapture({ withMicrophone, withSystemAudio });
		} catch (captureError) {
			setError(
				captureError instanceof DOMException && captureError.name === "NotAllowedError"
					? "Screen sharing was cancelled or permission was denied."
					: captureError instanceof Error
						? captureError.message
						: "Could not start screen recording.",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => state === "idle" && setOpen(nextOpen)}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{state === "recording" ? "Recording screen" : state === "paused" ? "Recording paused" : state === "saving" ? "Saving recording" : "Record your screen"}</DialogTitle>
					<DialogDescription>
						{state === "idle"
							? "Choose audio inputs, then select a screen, window, or browser tab."
							: state === "saving"
								? "Preparing your recording for the editor."
								: "Your recording is saved locally in this browser session."}
					</DialogDescription>
				</DialogHeader>

				{state === "idle" ? (
					<div className="flex flex-col gap-3">
						<label className="flex min-h-12 items-center gap-3 rounded-xl border border-separator px-4">
							<MonitorIcon className="size-4 text-muted-foreground" />
							<span className="flex-1 text-sm">System audio</span>
							<input type="checkbox" checked={withSystemAudio} onChange={(event) => setWithSystemAudio(event.target.checked)} />
						</label>
						<label className="flex min-h-12 items-center gap-3 rounded-xl border border-separator px-4">
							<MicrophoneIcon className="size-4 text-muted-foreground" />
							<span className="flex-1 text-sm">Microphone</span>
							<input type="checkbox" checked={withMicrophone} onChange={(event) => setWithMicrophone(event.target.checked)} />
						</label>
						{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
						<div className="flex justify-end gap-2 pt-2">
							<Button variant="ghost" onClick={() => setOpen(false)}><X className="size-4" /> Cancel</Button>
							<Button onClick={() => void start()}><MonitorIcon className="size-4" /> Start recording</Button>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-4 rounded-xl border border-separator p-4">
						<div className="flex items-center gap-3">
							<span className={`size-2.5 rounded-full ${state === "recording" ? "bg-danger animate-pulse" : "bg-muted"}`} />
							<span className="font-mono text-lg tabular-nums">{formatTime(elapsed)}</span>
						</div>
						<div className="flex gap-2">
							{state === "saving" ? <Button disabled>Saving…</Button> : <>
								<Button variant="secondary" onClick={state === "paused" ? resumeBrowserCapture : pauseBrowserCapture} aria-label={state === "paused" ? "Resume recording" : "Pause recording"}>
									{state === "paused" ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
								</Button>
								<Button variant="destructive" onClick={stopBrowserCapture}><X className="size-4" /> Finish</Button>
							</>}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}