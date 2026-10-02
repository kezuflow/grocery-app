import type { AnimationItem } from "lottie-web";
import animationData from "./location-pin-animation.json";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const LOCATION_PIN_RED = "#e94134";

type StaticPinGlyph = "destination" | "motorcycle";

export type LocationPinMarkerContent = Readonly<{
  element: HTMLDivElement;
  replay: () => void;
  destroy: () => void;
}>;

function staticPin(
  color: string = LOCATION_PIN_RED,
  glyph: StaticPinGlyph = "destination",
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 72 72");
  svg.style.cssText = "display:block;width:72px;height:72px";

  const shadow = document.createElementNS(SVG_NAMESPACE, "ellipse");
  shadow.setAttribute("cx", "36");
  shadow.setAttribute("cy", "62");
  shadow.setAttribute("rx", "14");
  shadow.setAttribute("ry", "3");
  shadow.setAttribute("fill", "#e9ecf0");

  const pin = document.createElementNS(SVG_NAMESPACE, "path");
  pin.setAttribute(
    "d",
    "M36 14c-8.1 0-14.7 6.6-14.7 14.7C21.3 40 36 56 36 56s14.7-16 14.7-27.3C50.7 20.6 44.1 14 36 14Z",
  );
  pin.setAttribute("fill", color);
  pin.setAttribute("stroke", color);
  pin.setAttribute("stroke-width", "1");

  const center = document.createElementNS(SVG_NAMESPACE, "circle");
  center.setAttribute("cx", "36");
  center.setAttribute("cy", "28.5");
  center.setAttribute("r", "6");
  center.setAttribute("fill", glyph === "motorcycle" ? "white" : "#a30d18");
  center.setAttribute("stroke", "white");
  center.setAttribute("stroke-width", "4");

  svg.appendChild(shadow);
  svg.appendChild(pin);
  svg.appendChild(center);
  if (glyph === "motorcycle") {
    const motorcycle = document.createElementNS(SVG_NAMESPACE, "g");
    motorcycle.dataset.mapPinGlyph = "motorcycle";
    motorcycle.setAttribute("transform", "translate(28 19) scale(0.5)");
    motorcycle.setAttribute("fill", "none");
    motorcycle.setAttribute("stroke", color);
    motorcycle.setAttribute("stroke-width", "2.5");
    motorcycle.setAttribute("stroke-linecap", "round");
    motorcycle.setAttribute("stroke-linejoin", "round");
    for (const cx of [6, 26]) {
      const wheel = document.createElementNS(SVG_NAMESPACE, "circle");
      wheel.setAttribute("cx", String(cx));
      wheel.setAttribute("cy", "24");
      wheel.setAttribute("r", "3.5");
      motorcycle.appendChild(wheel);
    }
    const frame = document.createElementNS(SVG_NAMESPACE, "path");
    frame.setAttribute("d", "M6 24h6l3-7h5l6 7M12 24h7l-4-7M10 14h6m3 3 3-4h4");
    motorcycle.appendChild(frame);
    svg.appendChild(motorcycle);
  }
  return svg;
}

/** Fixed map points share the address pin silhouette without its drag animation. */
export function createStaticLocationPinMarkerContent(
  label: string,
  color: string = LOCATION_PIN_RED,
  glyph: StaticPinGlyph = "destination",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.dataset.mapPointPin = glyph;
  element.style.cssText =
    "display:block;width:72px;height:72px;padding:0;border:0;background:transparent;cursor:pointer;transform:translateY(16px)";
  element.appendChild(staticPin(color, glyph));
  return element;
}

export function createLocationPinMarkerContent(
  label: string,
  reducedMotion: boolean,
): LocationPinMarkerContent {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.dataset.locationPin = label;
  element.dataset.locationPinAnimation = reducedMotion ? "static" : "loading";
  element.style.cssText = "position:relative;width:72px;height:72px;cursor:grab";
  const fallback = staticPin();
  element.appendChild(fallback);

  if (reducedMotion)
    return {
      element,
      replay: () => undefined,
      destroy: () => undefined,
    };

  const animation = document.createElement("div");
  animation.dataset.locationPinPlayer = "true";
  animation.style.cssText =
    "position:absolute;inset:0;width:72px;height:72px;visibility:hidden;pointer-events:none";
  element.appendChild(animation);

  let destroyed = false;
  let player: AnimationItem | undefined;
  const showFallback = (): void => {
    animation.style.visibility = "hidden";
    fallback.style.display = "block";
  };
  const failPlayer = (): void => {
    if (destroyed) return;
    showFallback();
    element.dataset.locationPinAnimation = "fallback";
    player?.destroy();
    player = undefined;
  };

  void import("lottie-web/build/player/lottie_light")
    .then(({ default: lottie }) => {
      if (destroyed) return;
      player = lottie.loadAnimation({
        animationData,
        autoplay: true,
        container: animation,
        loop: true,
        renderer: "svg",
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
          progressiveLoad: true,
        },
      });
      player.addEventListener("DOMLoaded", () => {
        if (destroyed) return;
        fallback.style.display = "none";
        animation.style.visibility = "visible";
        element.dataset.locationPinAnimation = "active";
      });
      player.addEventListener("data_failed", failPlayer);
      player.addEventListener("error", failPlayer);
    })
    .catch(failPlayer);

  return {
    element,
    replay: () => {
      if (!player || destroyed || animation.style.visibility !== "visible") return;
      player.goToAndPlay(0, true);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      player?.destroy();
      player = undefined;
    },
  };
}
