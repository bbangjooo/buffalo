import React from "react";
import ReactDOM, { Root } from "react-dom/client";
import InterfaceUI from "./components/InterfaceUI";

let root: Root | undefined;
let waitingForDocument = false;

const createVolumeUI = () => {
  if (root || waitingForDocument) return;
  const mount = () => {
    waitingForDocument = false;
    if (root) return;
    const container = document.getElementById("ui-interactive");
    if (!container) return;
    root = ReactDOM.createRoot(container);
    root.render(<React.StrictMode><InterfaceUI /></React.StrictMode>);
  };
  if (document.readyState === "loading") {
    waitingForDocument = true;
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
};

export { createVolumeUI };
