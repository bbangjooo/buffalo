import '../tokens.css';
import Application from "./Application/Application";
import { EventBus } from "./Application/UI/EventBus";

try {
  new Application();
} catch (error) {
  console.error("The 3D room could not start", error);
  const report = () => EventBus.dispatch("world-state", {
    ready: false,
    error: "Could not open the 3D rooms in this browser. You can still visit the blog.",
  });
  EventBus.on("world-request-state", report);
  setTimeout(report, 0);
}
