export type MapCoordinate = Readonly<{
  longitude: number;
  latitude: number;
}>;

export type MapInitialView = Readonly<{
  center: MapCoordinate;
  zoom: number;
}>;

export type MapPoint = Readonly<{
  id: string;
  position: MapCoordinate;
  label?: string;
  tone?: "available" | "retry" | "assigned" | "blocked";
}>;

export type MapDraggablePin = Readonly<{
  position: MapCoordinate;
  label?: string;
}>;

export type MapPolygon = Readonly<{
  id: string;
  rings: ReadonlyArray<ReadonlyArray<MapCoordinate>>;
}>;

export type MapLineString = Readonly<{
  id: string;
  points: ReadonlyArray<MapCoordinate>;
}>;

export type MapScene = Readonly<{
  points?: ReadonlyArray<MapPoint>;
  clusterPoints?: boolean;
  selectedPointIds?: ReadonlyArray<string>;
  draggablePin?: MapDraggablePin;
  polygons?: ReadonlyArray<MapPolygon>;
  lineStrings?: ReadonlyArray<MapLineString>;
  areaSelectionActive?: boolean;
}>;

export type MapAdapterInitialization = Readonly<{
  container: HTMLElement;
  publicAccessToken: string;
  initialView: MapInitialView;
  scene: MapScene;
  reducedMotion: boolean;
  onPinMove: (position: MapCoordinate) => void;
  onPointActivate: (pointId: string) => void;
  onAreaSelect: (firstCorner: MapCoordinate, secondCorner: MapCoordinate) => void;
  onAreaSelectionCancel: () => void;
  onLoadError: () => void;
}>;

export interface MapController {
  updateScene(scene: MapScene): void;
  destroy(): void;
}

export interface MapAdapter {
  initialize(options: MapAdapterInitialization): Promise<MapController>;
}
