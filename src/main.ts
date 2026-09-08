import '../tokens.css';
import Application from "./Application/Application";
import { EventBus } from "./Application/UI/EventBus";

try {
  new Application();
} catch (error) {
  console.error("The 3D room could not start", error);
  const report = () => EventBus.dispatch("world-state", {
    ready: false,
    error: "이 브라우저에서 3D 방을 열지 못했어요. 블로그로 바로 이동할 수 있어요.",
  });
  EventBus.on("world-request-state", report);
  setTimeout(report, 0);
}
