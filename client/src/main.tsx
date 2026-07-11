import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installCopyDeterrent } from "./lib/copyDeterrent";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Lightweight anti-copy deterrent (production only; no-op in dev).
installCopyDeterrent();

createRoot(document.getElementById("root")!).render(<App />);
