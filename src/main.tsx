import React from "react";
import ReactDOM from "react-dom/client";
import WebEditor from "./WebEditor";
import "./browserElectronBridge";
import "./style.css";
import "../../src/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<WebEditor />
	</React.StrictMode>,
);