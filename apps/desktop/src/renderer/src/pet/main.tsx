// Entry of the desktop pet window (pet.html, ADR 0070). The dev bridge loads first, as in the main
// window, so the pet can be previewed in a plain browser at /pet.html.

import "../dev-bridge";
import "./pet.css";
// Generated UI in replies (ADR 0074), after the pet's own look.
import "./herd-ui.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Pet } from "./Pet";

const root = document.getElementById("pet");
if (root === null) throw new Error("missing #pet");

createRoot(root).render(
  <StrictMode>
    <Pet />
  </StrictMode>,
);
