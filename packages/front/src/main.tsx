import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

declare global {
	interface Window {
		__viewportScalingDisabled?: boolean;
	}
}

const disableViewportScaling = () => {
	if (window.__viewportScalingDisabled) {
		return;
	}

	const handleWheel = (event: WheelEvent) => {
		if (event.ctrlKey) {
			event.preventDefault();
		}
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (!(event.ctrlKey || event.metaKey)) {
			return;
		}

		const key = event.key;
		if (key === "+" || key === "=" || key === "-" || key === "_" || key === "0") {
			event.preventDefault();
		}
	};

	const handleTouchMove = (event: TouchEvent) => {
		if (event.touches.length > 1) {
			event.preventDefault();
		}
	};

	window.addEventListener("wheel", handleWheel, { passive: false });
	window.addEventListener("keydown", handleKeyDown);
	document.addEventListener("touchmove", handleTouchMove, { passive: false });

	window.__viewportScalingDisabled = true;
};

disableViewportScaling();

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</React.StrictMode>
);
