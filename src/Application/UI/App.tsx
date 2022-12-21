import React from "react";
import ReactDOM from "react-dom/client";
import InterfaceUI from "./components/InterfaceUI";

const createVolumeUI = () => {
  let container: any = null;

  document.addEventListener("DOMContentLoaded", function () {
    if (!container) {
      container = document.getElementById("ui-interactive") as HTMLElement;
      const root = ReactDOM.createRoot(container);
      root.render(
        <React.StrictMode>
          <InterfaceUI />
        </React.StrictMode>
      );
    }
  });
};

export { createVolumeUI };
