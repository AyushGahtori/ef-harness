import type { OfficeRoomId } from "./room-ids.js";
import type { CameraViewport, LoadedFloorPlan, RoomBounds } from "./types.js";

const INTEGER_ZOOM_STEPS = [1, 2, 3, 4] as const;

export type OfficeCameraControllerOptions = {
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly plan: LoadedFloorPlan;
};

export class OfficeCameraController {
  private offsetX = 0;
  private offsetY = 0;
  private zoomStep: 1 | 2 | 3 | 4 = 1;
  private viewportWidthPx: number;
  private viewportHeightPx: number;
  private readonly plan: LoadedFloorPlan;

  constructor(options: OfficeCameraControllerOptions) {
    this.viewportWidthPx = options.viewportWidthPx;
    this.viewportHeightPx = options.viewportHeightPx;
    this.plan = options.plan;
    this.fitToViewport();
  }

  snapshot(): CameraViewport {
    return { offsetX: this.offsetX, offsetY: this.offsetY, zoomStep: this.zoomStep };
  }

  setViewportSize(widthPx: number, heightPx: number): void {
    this.viewportWidthPx = widthPx;
    this.viewportHeightPx = heightPx;
    this.clampPan();
  }

  panBy(deltaX: number, deltaY: number): void {
    this.offsetX = Math.round(this.offsetX + deltaX);
    this.offsetY = Math.round(this.offsetY + deltaY);
    this.clampPan();
  }

  zoomIn(): void {
    const idx = INTEGER_ZOOM_STEPS.indexOf(this.zoomStep);
    if (idx < INTEGER_ZOOM_STEPS.length - 1) {
      this.zoomStep = INTEGER_ZOOM_STEPS[idx + 1]!;
    }
    this.clampPan();
  }

  zoomOut(): void {
    const idx = INTEGER_ZOOM_STEPS.indexOf(this.zoomStep);
    if (idx > 0) {
      this.zoomStep = INTEGER_ZOOM_STEPS[idx - 1]!;
    }
    this.clampPan();
  }

  setZoomStep(step: 1 | 2 | 3 | 4): void {
    this.zoomStep = step;
    this.clampPan();
  }

  fitToViewport(): void {
    const mapW = this.plan.width * this.plan.tileSize;
    const mapH = this.plan.height * this.plan.tileSize;
    const scaleX = this.viewportWidthPx / mapW;
    const scaleY = this.viewportHeightPx / mapH;
  const fitScale = Math.min(scaleX, scaleY);
    if (fitScale >= 3.5) {
      this.zoomStep = 4;
    } else if (fitScale >= 2.5) {
      this.zoomStep = 3;
    } else if (fitScale >= 1.5) {
      this.zoomStep = 2;
    } else {
      this.zoomStep = 1;
    }
    this.offsetX = Math.round((this.viewportWidthPx - mapW * this.zoomStep) / 2);
    this.offsetY = Math.round((this.viewportHeightPx - mapH * this.zoomStep) / 2);
    this.clampPan();
  }

  jumpToRoom(roomId: OfficeRoomId): void {
    const room = this.plan.rooms.find((r) => r.roomId === roomId);
    if (!room) {
      return;
    }
    const cx = room.pixel.x + room.pixel.w / 2;
    const cy = room.pixel.y + room.pixel.h / 2;
    this.offsetX = Math.round(this.viewportWidthPx / 2 - cx * this.zoomStep);
    this.offsetY = Math.round(this.viewportHeightPx / 2 - cy * this.zoomStep);
    this.clampPan();
  }

  doubleClickRoomAt(pixelX: number, pixelY: number): OfficeRoomId | null {
    const room = this.hitRoom(pixelX, pixelY);
    if (!room) {
      return null;
    }
    this.jumpToRoom(room.roomId);
    this.setZoomStep(3);
    return room.roomId;
  }

  hitRoom(pixelX: number, pixelY: number): RoomBounds | null {
    for (const room of this.plan.rooms) {
      const withinX = pixelX >= room.pixel.x && pixelX < room.pixel.x + room.pixel.w;
      const withinY = pixelY >= room.pixel.y && pixelY < room.pixel.y + room.pixel.h;
      if (withinX && withinY) {
        return room;
      }
    }
    return null;
  }

  private clampPan(): void {
    const mapW = this.plan.width * this.plan.tileSize * this.zoomStep;
    const mapH = this.plan.height * this.plan.tileSize * this.zoomStep;
    const minX = Math.min(0, this.viewportWidthPx - mapW);
    const minY = Math.min(0, this.viewportHeightPx - mapH);
    const maxX = Math.max(0, this.viewportWidthPx - mapW);
    const maxY = Math.max(0, this.viewportHeightPx - mapH);
    this.offsetX = Math.max(minX, Math.min(maxX, this.offsetX));
    this.offsetY = Math.max(minY, Math.min(maxY, this.offsetY));
  }
}