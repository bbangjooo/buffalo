import { Source, SourceType } from "../types";

const sources: Source[] = [
  {
    name: "classicRoomModel",
    path: "/Room/four-rooms.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "classicCourtyardModel",
    path: "/Room/courtyard.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "medievalVillageModel",
    path: "/Room/medieval-village.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "inkHorsesModel",
    path: "/Room/horses-ink.glb",
    type: SourceType.GLTF_MODEL,
  },
  {
    name: "classicHorsesModel",
    path: "/Room/horses-low-poly.glb",
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
