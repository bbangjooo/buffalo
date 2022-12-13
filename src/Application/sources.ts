import { Source, SourceType } from "../types";

const sources: Source[] = [
  {
    name: "deskModel",
    path: "/Room/Desk.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "deskTexture",
    path: "/Room/Desk.jpg",
    type: SourceType.TEXTURE,
  },
  {
    name: "othersModel",
    path: "/Room/Others.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "othersTexture",
    path: "/Room/Others.jpg",
    type: SourceType.TEXTURE,
  },
  {
    name: "textTexture",
    path: "/matcaps/8.png",
    type: SourceType.TEXTURE,
  },
];

export default sources;
