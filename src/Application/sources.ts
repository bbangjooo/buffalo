import { Source, SourceType } from "../types";

const sources: Source[] = [
  {
    name: "guideCharacterModel",
    path: "/Room/character-guide-smooth.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "courtyardModel",
    path: "/Room/courtyard.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "dioramaModel",
    path: "/Room/four-rooms.glb",
    type: SourceType.GLTF_MODEL,
  },
];

export default sources;
