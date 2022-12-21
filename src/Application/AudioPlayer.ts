import { EventBus } from "./UI/EventBus";

export class AudioPlayer {
  audioElement: HTMLAudioElement;

  constructor() {
    this.audioElement = document.getElementById("bgm") as HTMLAudioElement;
    setTimeout(() => {
      EventBus.on("muteToggle", (muted: boolean) => {
        this.audioElement.play();
        this.audioElement.volume = +!muted;
      });
    }, 500);
  }
}
