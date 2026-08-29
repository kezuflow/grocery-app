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

function addSceneLayers(map: MapboxInstance, scene: MapScene): void {
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
      "circle-color": ["case", ["boolean", ["get", "selected"], false], "#f97316", "#166534"],
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 7],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

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
      let loaded = false;

      const syncPin = (): void => {
        if (!scene.draggablePin) {
          marker?.remove();
          marker = undefined;
          return;
        }
        if (!marker) {
          marker = new mapbox.default.Marker({ draggable: true })
            .setLngLat(coordinate(scene.draggablePin.position))
            .addTo(map);
          marker.on("dragend", () => {
            const position = marker?.getLngLat();
            if (position) options.onPinMove({ longitude: position.lng, latitude: position.lat });
          });
        } else {
          marker.setLngLat(coordinate(scene.draggablePin.position));
        }
        marker.getElement().setAttribute("aria-label", scene.draggablePin.label ?? "Map pin");
      };

      map.on("load", () => {
        loaded = true;
        addSceneLayers(map, scene);
        syncPin();
      });
      map.on("error", options.onLoadError);

      return {
        updateScene(nextScene): void {
          scene = nextScene;
          if (!loaded) return;
          setGeoJson(map, POINT_SOURCE, pointData(scene));
          setGeoJson(map, POLYGON_SOURCE, polygonData(scene));
          setGeoJson(map, LINE_SOURCE, lineData(scene));
          syncPin();
        },
        destroy(): void {
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
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MapController | undefined>(undefined);
  const sceneRef = useRef(scene);
  const pinMoveRef = useRef(onPinMove);
  const [error, setError] = useState<"configuration" | "load" | null>(null);
  sceneRef.current = scene;
  pinMoveRef.current = onPinMove;

  useEffect(() => {
    const container = containerRef.current;
    const token = publicAccessToken?.trim();
    if (!container || !token) {
      setError("configuration");
      return;
    }

    let disposed = false;
    let failed = false;
    setError(null);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void adapter
      .initialize({
        container,
        publicAccessToken: token,
        initialView,
        scene: sceneRef.current,
        reducedMotion,
        onPinMove: (position) => pinMoveRef.current?.(position),
        onLoadError: () => {
          failed = true;
          controllerRef.current?.destroy();
          controllerRef.current = undefined;
          if (!disposed) setError("load");
        },
      })
      .then((controller) => {
        if (disposed || failed) controller.destroy();
        else controllerRef.current = controller;
      })
      .catch(() => {
        if (!disposed) setError("load");
      });

    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = undefined;
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
