import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import VideoEditor from "@/components/video-editor/VideoEditor";
import WebCaptureOverlay from "./WebCaptureOverlay";

export default function WebEditor() {
	return (
		<ThemeProvider>
			<I18nProvider>
				<ShortcutsProvider>
					<VideoEditor />
					<WebCaptureOverlay />
				</ShortcutsProvider>
			</I18nProvider>
		</ThemeProvider>
	);
}