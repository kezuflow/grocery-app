"use client";

/// <reference types="google.maps" />

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  MapAdapter,
  MapAdapterInitialization,
  MapController,
  MapCoordinate,
  MapInitialView,
  MapPoint,
  MapScene,
} from "./map-types";

const GOOGLE_MAPS_VERSION = "weekly";
const GOOGLE_MAPS_CONFIGURATION_STATE = "__freshmarketsGoogleMapsBrowserOptions";

type GoogleMapsRuntime = typeof globalThis & {
  [GOOGLE_MAPS_CONFIGURATION_STATE]?: Readonly<{ browserApiKey: string; mapId: string }>;
};

function configureGoogleMaps(browserApiKey: string, mapId: string): void {
  // Persist through Vite HMR. Re-running setOptions warns with the full browser
  // configuration, including the referrer-restricted key, in development logs.
  const runtime = globalThis as GoogleMapsRuntime;
  const configuredBrowserOptions = runtime[GOOGLE_MAPS_CONFIGURATION_STATE];
  if (
    configuredBrowserOptions &&
    (configuredBrowserOptions.browserApiKey !== browserApiKey ||
      configuredBrowserOptions.mapId !== mapId)
  )
    throw new Error("Google Maps was already configured with different browser options");
  if (configuredBrowserOptions) return;
  setOptions({
    key: browserApiKey,
    v: GOOGLE_MAPS_VERSION,
    mapIds: [mapId],
    authReferrerPolicy: "origin",
  });
  runtime[GOOGLE_MAPS_CONFIGURATION_STATE] = { browserApiKey, mapId };
}

function latLng(position: MapCoordinate): google.maps.LatLngLiteral {
  return { lat: position.latitude, lng: position.longitude };
}

function coordinate(position: google.maps.LatLng | google.maps.LatLngLiteral): MapCoordinate {
  return position instanceof google.maps.LatLng
    ? { latitude: position.lat(), longitude: position.lng() }
    : { latitude: position.lat, longitude: position.lng };
}

function pointColor(point: MapPoint, selected: boolean): string {
  if (selected) return "#f97316";
  if (point.tone === "retry") return "#a15c00";
  if (point.tone === "assigned") return "#23658a";
  if (point.tone === "blocked") return "#6b6b67";
  return "#166534";
}

function markerContent(label: string, color: string, selected = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.style.cssText = [
    "width:22px",
    "height:22px",
    "padding:0",
    "border-radius:9999px",
    "border:3px solid #fff",
    `background:${color}`,
    "box-shadow:0 2px 8px rgb(15 23 42 / 0.28)",
    `transform:scale(${selected ? "1.18" : "1"})`,
    "cursor:pointer",
  ].join(";");
  return element;
}

function createGoogleMapsAdapter(): MapAdapter {
  return {
    async initialize(options: MapAdapterInitialization): Promise<MapController> {
      configureGoogleMaps(options.browserApiKey, options.mapId);
      const [{ Map: GoogleMap }, { AdvancedMarkerElement }] = await Promise.all([
        importLibrary("maps") as Promise<google.maps.MapsLibrary>,
        importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
      ]);
      const map = new GoogleMap(options.container, {
        center: latLng(options.initialView.center),
        zoom: options.initialView.zoom,
        mapId: options.mapId,
        clickableIcons: false,
        fullscreenControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        keyboardShortcuts: true,
        // A configured vector map ID otherwise selects WebGL and WebAssembly.
        // The address and operations maps need only the raster-supported marker,
        // polygon, and line features, so keep CSP free of eval allowances.
        renderingType: google.maps.RenderingType.RASTER,
        gestureHandling: "greedy",
      });

      let scene = options.scene;
      let pointMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
      let draggableMarker: google.maps.marker.AdvancedMarkerElement | undefined;
      let polygons: google.maps.Polygon[] = [];
      let polylines: google.maps.Polyline[] = [];
      let clusterer: MarkerClusterer | undefined;
      let lastPinPosition: MapCoordinate | undefined;
      let areaCleanup: (() => void) | undefined;

      const clearSceneOverlays = (): void => {
        clusterer?.clearMarkers();
        clusterer = undefined;
        for (const marker of pointMarkers) marker.map = null;
        pointMarkers = [];
        for (const polygon of polygons) polygon.setMap(null);
        polygons = [];
        for (const polyline of polylines) polyline.setMap(null);
        polylines = [];
      };

      const syncPoints = (): void => {
        clusterer?.clearMarkers();
        clusterer = undefined;
        for (const marker of pointMarkers) marker.map = null;
        const selectedIds = new Set(scene.selectedPointIds ?? []);
        pointMarkers = (scene.points ?? []).map((point) => {
          const selected = selectedIds.has(point.id);
          const marker = new AdvancedMarkerElement({
            position: latLng(point.position),
            title: point.label ?? "Map point",
            gmpClickable: true,
            content: markerContent(
              point.label ?? "Map point",
              pointColor(point, selected),
              selected,
            ),
          });
          marker.addEventListener("gmp-click", () => options.onPointActivate(point.id));
          return marker;
        });
        if (scene.clusterPoints && pointMarkers.length > 1)
          clusterer = new MarkerClusterer({ map, markers: pointMarkers });
        else for (const marker of pointMarkers) marker.map = map;
      };

      const syncShapes = (): void => {
        for (const polygon of polygons) polygon.setMap(null);
        polygons = (scene.polygons ?? []).map(
          (shape) =>
            new google.maps.Polygon({
              map,
              paths: shape.rings.map((ring) => ring.map(latLng)),
              fillColor: "#16a34a",
              fillOpacity: 0.16,
              strokeColor: "#166534",
              strokeOpacity: 1,
              strokeWeight: 2,
              clickable: false,
            }),
        );
        for (const polyline of polylines) polyline.setMap(null);
        polylines = (scene.lineStrings ?? []).map(
          (line) =>
            new google.maps.Polyline({
              map,
              path: line.points.map(latLng),
              strokeColor: "#f97316",
              strokeOpacity: 1,
              strokeWeight: 4,
              clickable: false,
            }),
        );
      };

      const syncPin = (): void => {
        if (!scene.draggablePin) {
          if (draggableMarker) draggableMarker.map = null;
          draggableMarker = undefined;
          lastPinPosition = undefined;
          return;
        }
        const pin = scene.draggablePin;
        const pinChanged =
          !lastPinPosition ||
          lastPinPosition.longitude !== pin.position.longitude ||
          lastPinPosition.latitude !== pin.position.latitude;
        if (!draggableMarker) {
          draggableMarker = new AdvancedMarkerElement({
            map,
            position: latLng(pin.position),
            title: pin.label ?? "Map pin",
            gmpDraggable: true,
          });
          draggableMarker.addEventListener("gmp-dragend", () => {
            const position = draggableMarker?.position;
            if (!position) return;
            if (position instanceof google.maps.LatLng) {
              options.onPinMove(coordinate(position));
              return;
            }
            options.onPinMove({ latitude: position.lat, longitude: position.lng });
          });
        } else {
          draggableMarker.position = latLng(pin.position);
          draggableMarker.title = pin.label ?? "Map pin";
        }
        if (pinChanged) map.panTo(latLng(pin.position));
        lastPinPosition = pin.position;
      };

      const stopAreaSelection = (): void => {
        areaCleanup?.();
        areaCleanup = undefined;
      };

      const syncAreaSelection = (): void => {
        stopAreaSelection();
        if (!scene.areaSelectionActive) return;
        const overlay = document.createElement("div");
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.cssText =
          "position:absolute;display:none;border:2px solid #c2410c;background:rgb(249 115 22 / 0.14);pointer-events:none;z-index:2";
        options.container.appendChild(overlay);
        map.setOptions({ gestureHandling: "none", draggableCursor: "crosshair" });
        const projectionOverlay = new google.maps.OverlayView();
        projectionOverlay.onAdd = () => undefined;
        projectionOverlay.draw = () => undefined;
        projectionOverlay.onRemove = () => undefined;
        projectionOverlay.setMap(map);
        let start: { x: number; y: number } | undefined;

        const relativePoint = (event: PointerEvent) => {
          const bounds = options.container.getBoundingClientRect();
          return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        };
        const down = (event: PointerEvent) => {
          if (event.button !== 0) return;
          start = relativePoint(event);
          overlay.style.display = "block";
          options.container.setPointerCapture?.(event.pointerId);
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
          const projection = projectionOverlay.getProjection();
          const first = projection.fromContainerPixelToLatLng(
            new google.maps.Point(start.x, start.y),
          );
          const second = projection.fromContainerPixelToLatLng(new google.maps.Point(end.x, end.y));
          start = undefined;
          stopAreaSelection();
          if (!first || !second) {
            options.onAreaSelectionCancel();
            return;
          }
          options.onAreaSelect(coordinate(first), coordinate(second));
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
        options.container.addEventListener("pointerdown", down, true);
        options.container.addEventListener("pointermove", move, true);
        options.container.addEventListener("pointerup", up, true);
        options.container.addEventListener("pointercancel", pointerCancel, true);
        window.addEventListener("keydown", keydown);
        areaCleanup = () => {
          options.container.removeEventListener("pointerdown", down, true);
          options.container.removeEventListener("pointermove", move, true);
          options.container.removeEventListener("pointerup", up, true);
          options.container.removeEventListener("pointercancel", pointerCancel, true);
          window.removeEventListener("keydown", keydown);
          projectionOverlay.setMap(null);
          overlay.remove();
          map.setOptions({ gestureHandling: "greedy", draggableCursor: undefined });
        };
      };

      const mapClickListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
        if (scene.areaSelectionActive || !scene.draggablePin || !event.latLng) return;
        options.onMapClick(coordinate(event.latLng));
      });

      syncPoints();
      syncShapes();
      syncPin();
      syncAreaSelection();

      return {
        updateScene(nextScene): void {
          scene = nextScene;
          syncPoints();
          syncShapes();
          syncPin();
          syncAreaSelection();
        },
        destroy(): void {
          stopAreaSelection();
          google.maps.event.removeListener(mapClickListener);
          clearSceneOverlays();
          if (draggableMarker) draggableMarker.map = null;
          draggableMarker = undefined;
          options.container.replaceChildren();
        },
      };
    },
  };
}

const defaultAdapter = createGoogleMapsAdapter();

export type GoogleMapProps = Readonly<{
  browserApiKey?: string;
  mapId?: string;
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

export function GoogleMap({
  browserApiKey,
  mapId,
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
}: GoogleMapProps) {
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
    const key = browserApiKey?.trim();
    const configuredMapId = mapId?.trim();
    if (!container || !key || !configuredMapId) {
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
        browserApiKey: key,
        mapId: configuredMapId,
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
    browserApiKey,
    mapId,
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
      <div role="alert" className={className}>
        <p>
          {error === "configuration"
            ? "Google Maps configuration is unavailable."
            : "Google Maps could not be loaded."}
        </p>
        {fallback}
      </div>
    );

  return <div ref={containerRef} role="region" aria-label={ariaLabel} className={className} />;
}
