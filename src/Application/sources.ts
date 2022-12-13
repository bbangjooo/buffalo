import { Source, SourceType } from "../types";

const sources: Source[] = [
  {
    name: "roomModel",
    path: "/Room/room.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "textTexture",
    path: "/matcaps/8.png",
    type: SourceType.TEXTURE,
  },
];

export default sources;
