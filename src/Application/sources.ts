import { Source, SourceType } from "../types";

const sources: Source[] = [
  {
    name: "medievalVillageModel",
    path: "/Room/medieval-village.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "guideCharacterModel",
    path: "/Room/character-guide-smooth.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "courtyardModel",
    path: "/Room/pen-ink-courtyard.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "dioramaModel",
    path: "/Room/pen-ink-rooms.glb",
    type: SourceType.GLTF_MODEL,
  },
];

export default sources;
