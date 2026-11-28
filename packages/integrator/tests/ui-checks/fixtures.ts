import { solidFrame } from "../../src/ui-checks/approved-screenshot-regression-runner.js";
import type {
  AxeViolation,
  RasterFrame,
  RenderedElement,
  RenderedRouteAudit,
  RepoFileSlice,
  ScreenRhythmMetrics,
  ThemeMode,
} from "../../src/ui-checks/types.js";

export const PRIMITIVE_DIALOG: RepoFileSlice = {
  path: "src/components/ui/dialog.tsx",
  contents: `export function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true">
      <div className="overlay" />
      <div className="panel">{children}</div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
`,
};

export const COMPLIANT_FILES: RepoFileSlice[] = [
  PRIMITIVE_DIALOG,
  {
    path: "src/components/ui/button.tsx",
    contents: `export function Button({ children }: { children: React.ReactNode }) {
  return <button className="bg-primary text-primary-foreground">{children}</button>;
}
`,
  },
  {
    path: "src/features/orders/components/OrdersPage.tsx",
    contents: `import { Button } from "@/components/ui/button";
export function OrdersPage() {
  return <main className="p-4 gap-4"><Button>Save</Button></main>;
}
`,
  },
  {
    path: "src/features/menu/components/MenuPage.tsx",
    contents: `import { Button } from "@/components/ui/button";
export function MenuPage() {
  return <main className="p-4 gap-4"><Button>Print</Button></main>;
}
`,
  },
];

export const RAW_HEX_FILE: RepoFileSlice = {
  path: "src/features/settings/components/SettingsPage.tsx",
  contents: `export function SettingsPage() { return <div style={{ color: "#ff0000" }}>Settings</div>; }`,
};

export const DUPLICATE_MODAL_FILE: RepoFileSlice = {
  path: "src/features/menu/components/CustomModal.tsx",
  contents: `export function CustomModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true">
      <div className="overlay" />
      <div className="panel">{children}</div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
`,
};

export const HOTLINK_FILE: RepoFileSlice = {
  path: "src/features/gallery/components/Gallery.tsx",
  contents: `<img src="https://images.unsplash.com/photo-1" alt="hero" />`,
};

function element(
  selector: string,
  box: { x: number; y: number; width: number; height: number },
  opts: Partial<RenderedElement> = {},
): RenderedElement {
  return {
    selector,
    role: opts.role ?? "button",
    tag: opts.tag ?? "button",
    box,
    interactive: opts.interactive ?? true,
    accessibleName: opts.accessibleName,
    source: opts.source ?? { file: "src/features/orders/components/OrdersPage.tsx", line: 4, dataEfSource: "src/features/orders/components/OrdersPage.tsx:4" },
  };
}

function audit(
  route: string,
  viewportId: string,
  width: number,
  height: number,
  theme: ThemeMode,
  elements: RenderedElement[],
  extra: Partial<RenderedRouteAudit> = {},
): RenderedRouteAudit {
  return {
    route,
    viewportId,
    width,
    height,
    theme,
    scrollWidth: width,
    clientWidth: width,
    elements,
    images: [{ selector: "img.logo", complete: true, naturalWidth: 120 }],
    primaryContentHeight: 400,
    ...extra,
  };
}

export const COMPLIANT_ROUTE_AUDITS: RenderedRouteAudit[] = [
  ...(["light", "dark"] as const).flatMap((theme) => [
    audit("/orders", "mobile", 375, 812, theme, [element('[data-testid="save"]', { x: 16, y: 700, width: 44, height: 44 })]),
    audit("/orders", "tablet", 768, 1024, theme, [element('[data-testid="save"]', { x: 32, y: 900, width: 44, height: 44 })]),
    audit("/orders", "desktop", 1440, 900, theme, [element('[data-testid="save"]', { x: 200, y: 760, width: 44, height: 44 })]),
    audit("/menu", "mobile", 375, 812, theme, [element('[data-testid="print"]', { x: 16, y: 700, width: 44, height: 44 })]),
    audit("/menu", "tablet", 768, 1024, theme, [element('[data-testid="print"]', { x: 32, y: 900, width: 44, height: 44 })]),
    audit("/menu", "desktop", 1440, 900, theme, [element('[data-testid="print"]', { x: 200, y: 760, width: 44, height: 44 })]),
  ]),
];

export const SMALL_TAP_TARGET_AUDIT: RenderedRouteAudit = audit(
  "/orders",
  "mobile",
  375,
  812,
  "light",
  [
    element('[data-testid="close"]', { x: 340, y: 12, width: 16, height: 16 }, {
      source: { file: "src/features/orders/components/CloseButton.tsx", line: 8, dataEfSource: "src/features/orders/components/CloseButton.tsx:8" },
    }),
  ],
);

export const OVERFLOW_AUDIT: RenderedRouteAudit = audit(
  "/orders",
  "mobile",
  375,
  812,
  "light",
  [
    element('[data-testid="save"]', { x: 16, y: 700, width: 44, height: 44 }),
    element('[data-testid="cancel"]', { x: 50, y: 700, width: 44, height: 44 }),
  ],
  { scrollWidth: 420, clientWidth: 375 },
);

export const OVERLAP_AUDIT: RenderedRouteAudit = audit(
  "/orders",
  "mobile",
  375,
  812,
  "light",
  [
    element('[data-testid="save"]', { x: 200, y: 700, width: 80, height: 44 }),
    element('[data-testid="cancel"]', { x: 250, y: 700, width: 80, height: 44 }),
  ],
);

export const DARK_AXE_VIOLATION: AxeViolation = {
  id: "color-contrast",
  impact: "serious",
  description: "Elements must meet color contrast ratio thresholds",
  nodes: [
    {
      target: "[data-testid='card-title']",
      source: { file: "src/features/menu/components/MenuCard.tsx", line: 11, dataEfSource: "src/features/menu/components/MenuCard.tsx:11" },
    },
  ],
};

export const COMPLIANT_RHYTHM: ScreenRhythmMetrics[] = [
  {
    route: "/orders",
    headerHeight: 56,
    sidebarWidth: 240,
    pageTitleFontSize: 24,
    pageTitleFontFamily: "Inter",
    pageTitleLineHeight: 32,
    cardPadding: 16,
    cardBorderRadius: 8,
    primaryButtonHeight: 40,
    bodyFontFamily: "Inter",
  },
  {
    route: "/menu",
    headerHeight: 56,
    sidebarWidth: 240,
    pageTitleFontSize: 24,
    pageTitleFontFamily: "Inter",
    pageTitleLineHeight: 32,
    cardPadding: 16,
    cardBorderRadius: 8,
    primaryButtonHeight: 40,
    bodyFontFamily: "Inter",
  },
];

export const OUTLIER_RHYTHM: ScreenRhythmMetrics[] = [
  ...COMPLIANT_RHYTHM,
  {
    route: "/settings",
    headerHeight: 68,
    sidebarWidth: 240,
    pageTitleFontSize: 24,
    pageTitleFontFamily: "Inter",
    pageTitleLineHeight: 32,
    cardPadding: 16,
    cardBorderRadius: 24,
    primaryButtonHeight: 40,
    bodyFontFamily: "Inter",
  },
];

export function compliantScreenshot(): RasterFrame {
  return solidFrame(120, 80, [240, 240, 240, 255]);
}

export function shiftedScreenshot(): RasterFrame {
  const base = solidFrame(120, 80, [240, 240, 240, 255]);
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      const offset = (y * 120 + x) * 4;
      base.pixels[offset] = 20;
      base.pixels[offset + 1] = 20;
      base.pixels[offset + 2] = 200;
    }
  }
  return base;
}

export function dynamicMaskedScreenshot(): RasterFrame {
  return {
    width: 60,
    height: 20,
    maskedSelectors: ["0:0:60:20"],
    pixels: (() => {
      const pixels = new Uint8ClampedArray(60 * 20 * 4);
      for (let i = 0; i < 60 * 20; i += 1) {
        const offset = i * 4;
        pixels[offset] = 100;
        pixels[offset + 1] = 120;
        pixels[offset + 2] = 140;
        pixels[offset + 3] = 255;
      }
      return pixels;
    })(),
  };
}