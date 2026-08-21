import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import { ThemeProvider } from "@/lib/theme";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html.");

// The router is outside App because AuthProvider navigates on an expired session, and a
// hook that navigates has to sit inside a router. The theme is outside both: the sign-in
// page is themed too, and it renders before there is a session.
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
