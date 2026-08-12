import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html.");

// The router is outside App because AuthProvider navigates on an expired session, and a
// hook that navigates has to sit inside a router.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
