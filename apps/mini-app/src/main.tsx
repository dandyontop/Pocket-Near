import React from "react";
import ReactDOM from "react-dom/client";
import { init } from "@telegram-apps/sdk-react";
import App from "./App.js";
import "./styles.css";
import "./overrides.css";

try { init({}); } catch { /* SDK initialization is a no-op in browser preview mode. */ }
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
