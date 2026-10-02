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
  kind?: "motorcycle";
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
  tone?: "storefront";
}>;

export type MapScene = Readonly<{
  points?: ReadonlyArray<MapPoint>;
  fitBoundsOnce?: ReadonlyArray<MapCoordinate>;
  clusterPoints?: boolean;
  selectedPointIds?: ReadonlyArray<string>;
  draggablePin?: MapDraggablePin;
  polygons?: ReadonlyArray<MapPolygon>;
  lineStrings?: ReadonlyArray<MapLineString>;
  areaSelectionActive?: boolean;
}>;

export type MapAdapterInitialization = Readonly<{
  container: HTMLElement;
  browserApiKey: string;
  mapId: string;
  initialView: MapInitialView;
  fitBoundsOnInitialize?: ReadonlyArray<MapCoordinate>;
  scene: MapScene;
  reducedMotion: boolean;
  onPinMove: (position: MapCoordinate) => void;
  onMapClick: (position: MapCoordinate) => void;
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
