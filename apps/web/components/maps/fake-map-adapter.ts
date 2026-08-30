import type {
  MapAdapter,
  MapAdapterInitialization,
  MapController,
  MapCoordinate,
  MapScene,
} from "./map-types";

export class FakeMapController implements MapController {
  readonly sceneUpdates: MapScene[] = [];
  destroyed = false;

  updateScene(scene: MapScene): void {
    this.sceneUpdates.push(scene);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export class FakeMapAdapter implements MapAdapter {
  readonly initializations: MapAdapterInitialization[] = [];
  readonly controllers: FakeMapController[] = [];
  private activeInitialization?: MapAdapterInitialization;

  constructor(private readonly options?: Readonly<{ initializationError?: Error }>) {}

  async initialize(options: MapAdapterInitialization): Promise<MapController> {
    this.initializations.push(options);
    if (this.options?.initializationError) throw this.options.initializationError;

    this.activeInitialization = options;
    const controller = new FakeMapController();
    this.controllers.push(controller);
    return controller;
  }

  emitPinMove(position: MapCoordinate): void {
    this.activeInitialization?.onPinMove(position);
  }

  emitPointActivate(pointId: string): void {
    this.activeInitialization?.onPointActivate(pointId);
  }

  emitAreaSelect(firstCorner: MapCoordinate, secondCorner: MapCoordinate): void {
    this.activeInitialization?.onAreaSelect(firstCorner, secondCorner);
  }

  emitAreaSelectionCancel(): void {
    this.activeInitialization?.onAreaSelectionCancel();
  }

  emitLoadError(): void {
    this.activeInitialization?.onLoadError();
  }
}
