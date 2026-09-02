"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  MapAdapter,
  MapAdapterInitialization,
  MapController,
  MapCoordinate,
  MapInitialView,
  MapScene,
} from "./map-types";

const POINT_SOURCE = "freshmarkets-points";
const POLYGON_SOURCE = "freshmarkets-polygons";
const LINE_SOURCE = "freshmarkets-lines";
const POINT_LAYER_IDS = [
  "freshmarkets-point-clusters",
  "freshmarkets-point-cluster-count",
  "freshmarkets-points",
] as const;

type MapboxModule = typeof import("mapbox-gl");
type MapboxInstance = InstanceType<MapboxModule["Map"]>;
type MapboxMarker = InstanceType<MapboxModule["Marker"]>;

function coordinate(position: MapCoordinate): [number, number] {
  return [position.longitude, position.latitude];
}

function pointData(scene: MapScene) {
  const selectedIds = new Set(scene.selectedPointIds ?? []);
  return {
    type: "FeatureCollection" as const,
    features: (scene.points ?? []).map((point) => ({
      type: "Feature" as const,
      id: point.id,
      geometry: { type: "Point" as const, coordinates: coordinate(point.position) },
      properties: {
        id: point.id,
        label: point.label ?? "",
        selected: selectedIds.has(point.id),
        tone: point.tone ?? "available",
      },
    })),
  };
}

function polygonData(scene: MapScene) {
  return {
    type: "FeatureCollection" as const,
    features: (scene.polygons ?? []).map((polygon) => ({
      type: "Feature" as const,
      id: polygon.id,
      geometry: {
        type: "Polygon" as const,
        coordinates: polygon.rings.map((ring) => ring.map(coordinate)),
      },
      properties: { id: polygon.id },
    })),
  };
}

function lineData(scene: MapScene) {
  return {
    type: "FeatureCollection" as const,
    features: (scene.lineStrings ?? []).map((line) => ({
      type: "Feature" as const,
      id: line.id,
      geometry: {
        type: "LineString" as const,
        coordinates: line.points.map(coordinate),
      },
      properties: { id: line.id },
    })),
  };
}

function setGeoJson(
  map: MapboxInstance,
  sourceId: string,
  data: ReturnType<typeof pointData>,
): void;
function setGeoJson(
  map: MapboxInstance,
  sourceId: string,
  data: ReturnType<typeof polygonData>,
): void;
function setGeoJson(map: MapboxInstance, sourceId: string, data: ReturnType<typeof lineData>): void;
function setGeoJson(
  map: MapboxInstance,
  sourceId: string,
  data: ReturnType<typeof pointData | typeof polygonData | typeof lineData>,
): void {
  const source = map.getSource(sourceId);
  if (source && "setData" in source) source.setData(data);
}

function addPointLayers(map: MapboxInstance, scene: MapScene): void {
  map.addSource(POINT_SOURCE, {
    type: "geojson",
    data: pointData(scene),
    cluster: scene.clusterPoints ?? false,
    clusterMaxZoom: 14,
    clusterRadius: 48,
  });
  map.addLayer({
    id: "freshmarkets-point-clusters",
    type: "circle",
    source: POINT_SOURCE,
    filter: ["has", "point_count"],
    paint: { "circle-color": "#166534", "circle-radius": 20 },
  });
  map.addLayer({
    id: "freshmarkets-point-cluster-count",
    type: "symbol",
    source: POINT_SOURCE,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "freshmarkets-points",
    type: "circle",
    source: POINT_SOURCE,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#f97316",
        [
          "match",
          ["get", "tone"],
          "retry",
          "#a15c00",
          "assigned",
          "#23658a",
          "blocked",
          "#6b6b67",
          "#166534",
        ],
      ],
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 7],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

function replacePointLayers(map: MapboxInstance, scene: MapScene): void {
  for (const layerId of POINT_LAYER_IDS) map.removeLayer(layerId);
  map.removeSource(POINT_SOURCE);
  addPointLayers(map, scene);
}

function addSceneLayers(map: MapboxInstance, scene: MapScene): void {
  addPointLayers(map, scene);

  map.addSource(POLYGON_SOURCE, { type: "geojson", data: polygonData(scene) });
  map.addLayer({
    id: "freshmarkets-polygons",
    type: "fill",
    source: POLYGON_SOURCE,
    paint: { "fill-color": "#16a34a", "fill-opacity": 0.16 },
  });
  map.addLayer({
    id: "freshmarkets-polygon-outlines",
    type: "line",
    source: POLYGON_SOURCE,
    paint: { "line-color": "#166534", "line-width": 2 },
  });

  map.addSource(LINE_SOURCE, { type: "geojson", data: lineData(scene) });
  map.addLayer({
    id: "freshmarkets-lines",
    type: "line",
    source: LINE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#f97316", "line-width": 4 },
  });
}

function createMapboxAdapter(): MapAdapter {
  return {
    async initialize(options: MapAdapterInitialization): Promise<MapController> {
      const mapbox = await import("mapbox-gl");
      mapbox.default.accessToken = options.publicAccessToken;
      const map = new mapbox.default.Map({
        container: options.container,
        style: "mapbox://styles/mapbox/streets-v12",
        center: coordinate(options.initialView.center),
        zoom: options.initialView.zoom,
        bearing: 0,
        pitch: 0,
        fadeDuration: options.reducedMotion ? 0 : 300,
        respectPrefersReducedMotion: true,
      });

      let scene = options.scene;
      let marker: MapboxMarker | undefined;
      let lastPinPosition: MapCoordinate | undefined;
      let loaded = false;
      let areaCleanup: (() => void) | undefined;

      const stopAreaSelection = (): void => {
        areaCleanup?.();
        areaCleanup = undefined;
      };

      const syncAreaSelection = (): void => {
        stopAreaSelection();
        if (!scene.areaSelectionActive) return;
        const canvas = map.getCanvasContainer();
        const overlay = document.createElement("div");
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.cssText =
          "position:absolute;display:none;border:2px solid #c2410c;background:rgb(249 115 22 / 0.14);pointer-events:none;z-index:2";
        options.container.appendChild(overlay);
        map.dragPan.disable();
        let start: { x: number; y: number } | undefined;

        const relativePoint = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        };
        const down = (event: PointerEvent) => {
          if (event.button !== 0) return;
          start = relativePoint(event);
          overlay.style.display = "block";
          canvas.setPointerCapture?.(event.pointerId);
        };
        const move = (event: PointerEvent) => {
          if (!start) return;
          const end = relativePoint(event);
          overlay.style.left = `${Math.min(start.x, end.x)}px`;
          overlay.style.top = `${Math.min(start.y, end.y)}px`;
          overlay.style.width = `${Math.abs(end.x - start.x)}px`;
          overlay.style.height = `${Math.abs(end.y - start.y)}px`;
        };
        const up = (event: PointerEvent) => {
          if (!start) return;
          const end = relativePoint(event);
          const first = map.unproject([start.x, start.y]);
          const second = map.unproject([end.x, end.y]);
          start = undefined;
          stopAreaSelection();
          options.onAreaSelect(
            { longitude: first.lng, latitude: first.lat },
            { longitude: second.lng, latitude: second.lat },
          );
        };
        const keydown = (event: KeyboardEvent) => {
          if (event.key !== "Escape") return;
          stopAreaSelection();
          options.onAreaSelectionCancel();
        };
        const pointerCancel = () => {
          stopAreaSelection();
          options.onAreaSelectionCancel();
        };
        canvas.addEventListener("pointerdown", down);
        canvas.addEventListener("pointermove", move);
        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", pointerCancel);
        window.addEventListener("keydown", keydown);
        areaCleanup = () => {
          canvas.removeEventListener("pointerdown", down);
          canvas.removeEventListener("pointermove", move);
          canvas.removeEventListener("pointerup", up);
          canvas.removeEventListener("pointercancel", pointerCancel);
          window.removeEventListener("keydown", keydown);
          overlay.remove();
          map.dragPan.enable();
        };
      };

      const syncPin = (): void => {
        if (!scene.draggablePin) {
          marker?.remove();
          marker = undefined;
          lastPinPosition = undefined;
          return;
        }
        const pinPosition = scene.draggablePin.position;
        const pinChanged =
          !lastPinPosition ||
          lastPinPosition.longitude !== pinPosition.longitude ||
          lastPinPosition.latitude !== pinPosition.latitude;
        if (!marker) {
          marker = new mapbox.default.Marker({ draggable: true })
            .setLngLat(coordinate(pinPosition))
            .addTo(map);
          marker.on("dragend", () => {
            const position = marker?.getLngLat();
            if (position) options.onPinMove({ longitude: position.lng, latitude: position.lat });
          });
        } else {
          marker.setLngLat(coordinate(pinPosition));
        }
        marker.getElement().setAttribute("aria-label", scene.draggablePin.label ?? "Map pin");
        if (pinChanged)
          map.easeTo({
            center: coordinate(pinPosition),
            duration: options.reducedMotion ? 0 : 500,
          });
        lastPinPosition = pinPosition;
      };

      map.on("load", () => {
        loaded = true;
        addSceneLayers(map, scene);
        syncPin();
        syncAreaSelection();
      });
      map.on("error", options.onLoadError);
      map.on("click", "freshmarkets-points", (event) => {
        if (scene.areaSelectionActive) return;
        const feature = event.features?.[0];
        const pointId = (feature as { properties?: Record<string, unknown> } | undefined)
          ?.properties?.id;
        if (typeof pointId === "string") options.onPointActivate(pointId);
      });
      map.on("click", (event) => {
        if (scene.areaSelectionActive || !scene.draggablePin) return;
        options.onMapClick({ longitude: event.lngLat.lng, latitude: event.lngLat.lat });
      });

      return {
        updateScene(nextScene): void {
          const clusterConfigurationChanged =
            (scene.clusterPoints ?? false) !== (nextScene.clusterPoints ?? false);
          scene = nextScene;
          if (!loaded) return;
          if (clusterConfigurationChanged) replacePointLayers(map, scene);
          else setGeoJson(map, POINT_SOURCE, pointData(scene));
          setGeoJson(map, POLYGON_SOURCE, polygonData(scene));
          setGeoJson(map, LINE_SOURCE, lineData(scene));
          syncPin();
          syncAreaSelection();
        },
        destroy(): void {
          stopAreaSelection();
          marker?.remove();
          map.remove();
        },
      };
    },
  };
}

const defaultAdapter = createMapboxAdapter();

export type MapboxMapProps = Readonly<{
  publicAccessToken?: string;
  initialView: MapInitialView;
  scene: MapScene;
  adapter?: MapAdapter;
  ariaLabel?: string;
  className?: string;
  fallback?: ReactNode;
  onPinMove?: (position: MapCoordinate) => void;
  onMapClick?: (position: MapCoordinate) => void;
  onPointActivate?: (pointId: string) => void;
  onAreaSelect?: (firstCorner: MapCoordinate, secondCorner: MapCoordinate) => void;
  onAreaSelectionCancel?: () => void;
}>;

export function MapboxMap({
  publicAccessToken,
  initialView,
  scene,
  adapter = defaultAdapter,
  ariaLabel = "Map",
  className,
  fallback,
  onPinMove,
  onMapClick,
  onPointActivate,
  onAreaSelect,
  onAreaSelectionCancel,
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MapController | undefined>(undefined);
  const generationRef = useRef(0);
  const sceneRef = useRef(scene);
  const pinMoveRef = useRef(onPinMove);
  const mapClickRef = useRef(onMapClick);
  const pointActivateRef = useRef(onPointActivate);
  const areaSelectRef = useRef(onAreaSelect);
  const areaCancelRef = useRef(onAreaSelectionCancel);
  const [error, setError] = useState<"configuration" | "load" | null>(null);
  sceneRef.current = scene;
  pinMoveRef.current = onPinMove;
  mapClickRef.current = onMapClick;
  pointActivateRef.current = onPointActivate;
  areaSelectRef.current = onAreaSelect;
  areaCancelRef.current = onAreaSelectionCancel;

  useEffect(() => {
    const generation = ++generationRef.current;
    const container = containerRef.current;
    const token = publicAccessToken?.trim();
    if (!container || !token) {
      setError("configuration");
      return;
    }

    let disposed = false;
    let failed = false;
    let ownedController: MapController | undefined;
    const initialScene = sceneRef.current;
    setError(null);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void adapter
      .initialize({
        container,
        publicAccessToken: token,
        initialView,
        scene: initialScene,
        reducedMotion,
        onPinMove: (position) => pinMoveRef.current?.(position),
        onMapClick: (position) => mapClickRef.current?.(position),
        onPointActivate: (pointId) => pointActivateRef.current?.(pointId),
        onAreaSelect: (firstCorner, secondCorner) =>
          areaSelectRef.current?.(firstCorner, secondCorner),
        onAreaSelectionCancel: () => areaCancelRef.current?.(),
        onLoadError: () => {
          if (disposed || generationRef.current !== generation) return;
          failed = true;
          if (ownedController && controllerRef.current === ownedController) {
            ownedController.destroy();
            controllerRef.current = undefined;
          }
          setError("load");
        },
      })
      .then((controller) => {
        ownedController = controller;
        if (disposed || failed || generationRef.current !== generation) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        if (sceneRef.current !== initialScene) controller.updateScene(sceneRef.current);
      })
      .catch(() => {
        if (!disposed && generationRef.current === generation) setError("load");
      });

    return () => {
      disposed = true;
      if (ownedController && controllerRef.current === ownedController)
        controllerRef.current = undefined;
      ownedController?.destroy();
    };
  }, [
    publicAccessToken,
    adapter,
    initialView.center.latitude,
    initialView.center.longitude,
    initialView.zoom,
  ]);

  useEffect(() => {
    controllerRef.current?.updateScene(scene);
  }, [scene]);

  if (error)
    return (
      <div role="alert">
        <p>
          {error === "configuration"
            ? "Map configuration is unavailable."
            : "The map could not be loaded."}
        </p>
        {fallback}
      </div>
    );

  return <div ref={containerRef} role="region" aria-label={ariaLabel} className={className} />;
}
