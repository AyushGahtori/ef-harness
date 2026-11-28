const PRIVILEGED = [
  "harnessd",
  "require(",
  "process",
  "child_process",
  "ipcRenderer",
  "node:fs",
  "node:child_process",
  "node:module",
  "fs.",
  "eval(",
  "Function(",
  "Buffer",
  "__dirname",
  "__filename",
];

export function assertIsolatedScript(script: string): void {
  for (const token of PRIVILEGED) {
    if (script.includes(token)) {
      throw new Error("picker script would expose a privileged API");
    }
  }
}

export function pickerSetActiveScript(active: boolean): string {
  const script = `if (window.__efPointToFix) window.__efPointToFix.setActive(${active ? "true" : "false"});`;
  assertIsolatedScript(script);
  return script;
}

export function pickerInjectionScript(origin: string): string {
  const originLiteral = JSON.stringify(origin);
  const script = `(function () {
  if (window.__efPointToFixInstalled) {
    if (window.__efPointToFix) window.__efPointToFix.setActive(true);
    return;
  }
  window.__efPointToFixInstalled = true;
  var active = true;
  var drag = null;
  var origin = ${originLiteral};
  var document = window.document;
  function post(payload) {
    window.parent.postMessage(payload, origin);
  }
  window.__efPointToFix = {
    setActive: function (on) { active = on ? true : false; }
  };
  function attr(el, name) {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute(name);
  }
  function sourceOf(el) { return attr(el, "data-ef-source"); }
  function componentOf(el) {
    var named = attr(el, "data-ef-component");
    if (named) return named;
    var fiber = fiberObject(el);
    if (fiber && fiber.type && fiber.type.displayName) return String(fiber.type.displayName);
    if (fiber && fiber.elementType && fiber.elementType.displayName) return String(fiber.elementType.displayName);
    var tag = String(el.tagName || "").toLowerCase();
    return tag || "element";
  }
  function fiberObject(el) {
    if (!el) return null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key.indexOf("__reactFiber") === 0 || key.indexOf("__reactInternalInstance") === 0) return el[key];
    }
    return null;
  }
  function fiberOf(el) {
    var fiber = fiberObject(el);
    var debug = fiber && (fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource));
    if (!debug || !debug.fileName) return null;
    return {
      fileName: String(debug.fileName),
      lineNumber: Number(debug.lineNumber),
      columnNumber: Number(debug.columnNumber)
    };
  }
  function roleOf(el) {
    var explicit = attr(el, "role");
    if (explicit) return explicit;
    var tag = String(el.tagName || "").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    return null;
  }
  function textOf(el) {
    var raw = el.innerText || el.textContent || "";
    return String(raw).replace(/\\s+/g, " ").trim();
  }
  function nameOf(el) {
    var labelled = attr(el, "aria-label") || attr(el, "alt");
    if (labelled) return labelled;
    var text = textOf(el);
    return text || null;
  }
  function stylesOf(el) {
    var cs = window.getComputedStyle(el);
    return {
      font: cs.font || cs.fontFamily || "",
      color: cs.color || "",
      padding: cs.padding || "",
      gap: cs.gap || "",
      position: cs.position || ""
    };
  }
  function boxOf(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }
  function themeOf() {
    var root = document.documentElement;
    var data = root && root.getAttribute ? root.getAttribute("data-theme") : null;
    if (data === "dark" || data === "light") return data;
    var cls = root && root.className ? String(root.className) : "";
    if (cls.indexOf("dark") !== -1) return "dark";
    return "light";
  }
  function ancestors(el) {
    var out = [];
    var current = el;
    while (current) {
      var root = current.getRootNode ? current.getRootNode() : null;
      var next = current.parentElement || null;
      if (!next && root && root.host && root.host !== current) next = root.host;
      current = next;
      if (!current || current === document) break;
      var src = sourceOf(current);
      if (src) out.push(src);
    }
    return out;
  }
  function domPath(el) {
    var parts = [];
    var current = el;
    var guard = 0;
    while (current && current !== document && guard < 12) {
      parts.unshift(String(current.tagName || "node").toLowerCase());
      var root = current.getRootNode ? current.getRootNode() : null;
      var next = current.parentElement || null;
      if (!next && root && root.host && root.host !== current) next = root.host;
      current = next;
      guard += 1;
    }
    return parts.join(" > ");
  }
  function payload(el, gesture, extra) {
    var box = boxOf(el);
    var text = textOf(el);
    if (text.length > 200) text = text.slice(0, 200);
    var snippet = el.outerHTML ? String(el.outerHTML) : "";
    if (snippet.length > 2048) snippet = snippet.slice(0, 2048);
    var body = {
      type: "ef-pick-result",
      gesture: gesture,
      source: sourceOf(el),
      ancestorSources: ancestors(el),
      role: roleOf(el),
      name: nameOf(el),
      text: text,
      domPath: domPath(el),
      snippet: snippet,
      box: box,
      styles: stylesOf(el),
      viewportWidth: window.innerWidth,
      route: window.location.pathname,
      theme: themeOf(),
      componentName: componentOf(el),
      fiberSource: fiberOf(el),
      cropRect: box
    };
    if (extra) {
      body.intersecting = extra.intersecting;
      body.gapPx = extra.gapPx;
      body.gapAxis = extra.gapAxis;
    }
    return body;
  }
  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function gapBetween(a, b) {
    var vertical = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
    var horizontal = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
    if (vertical >= 0 && (horizontal < 0 || vertical <= horizontal)) return { axis: "vertical", px: vertical };
    if (horizontal >= 0) return { axis: "horizontal", px: horizontal };
    return { axis: "vertical", px: 0 };
  }
  function tagged() {
    var nodes = document.querySelectorAll("[data-ef-source]");
    var list = [];
    for (var i = 0; i < nodes.length; i += 1) list.push(nodes[i]);
    return list;
  }
  function regionHits(rect) {
    var nodes = tagged();
    var hits = [];
    var above = null;
    var below = null;
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var box = boxOf(el);
      if (overlaps(box, rect)) hits.push(el);
      var bottom = box.y + box.height;
      if (bottom <= rect.y && (!above || bottom > boxOf(above).y + boxOf(above).height)) above = el;
      if (box.y >= rect.y + rect.height && (!below || box.y < boxOf(below).y)) below = el;
    }
    if (above && hits.indexOf(above) === -1) hits.push(above);
    if (below && hits.indexOf(below) === -1) hits.push(below);
    return hits;
  }
  function describeHits(hits) {
    var items = [];
    var best = null;
    for (var i = 0; i < hits.length; i += 1) {
      var el = hits[i];
      var box = boxOf(el);
      items.push({
        source: sourceOf(el),
        tag: String(el.tagName || "").toLowerCase(),
        name: componentOf(el) || nameOf(el) || "",
        box: box
      });
    }
    for (var a = 0; a < items.length; a += 1) {
      for (var b = a + 1; b < items.length; b += 1) {
        var gap = gapBetween(items[a].box, items[b].box);
        if (!best || gap.px < best.px) best = gap;
      }
    }
    return { intersecting: items, gapPx: best ? best.px : 0, gapAxis: best ? best.axis : "vertical" };
  }
  document.addEventListener("pointermove", function (event) {
    if (!active || drag) return;
    var el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === document || el === document.documentElement) return;
    post(payload(el, "hover"));
  }, true);
  document.addEventListener("pointerdown", function (event) {
    if (!active) return;
    drag = { x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener("pointerup", function (event) {
    if (!active || !drag) return;
    var x = Math.min(drag.x, event.clientX);
    var y = Math.min(drag.y, event.clientY);
    var width = Math.abs(event.clientX - drag.x);
    var height = Math.abs(event.clientY - drag.y);
    drag = null;
    if (width < 4 && height < 4) return;
    var rect = { x: x, y: y, width: width, height: height };
    var hits = regionHits(rect);
    var extra = describeHits(hits);
    var anchor = hits[0] || event.target;
    if (!anchor || !anchor.getBoundingClientRect) return;
    var message = payload(anchor, "gap", extra);
    message.box = rect;
    post(message);
  }, true);
  document.addEventListener("click", function (event) {
    if (!active) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    var path = event.composedPath ? event.composedPath() : [];
    var el = path[0] || event.target;
    if (!el || el === document || el === document.documentElement || !el.getBoundingClientRect) return;
    post(payload(el, "click"));
  }, true);
  document.addEventListener("keydown", function (event) {
    if (!active) return;
    if (event.key === "Escape") {
      active = false;
      post({ type: "ef-pick-result", gesture: "escape" });
    }
  }, true);
})();`;
  assertIsolatedScript(script);
  return script;
}

/** Dev-only script template for Task 160 webview injection (`origin` substituted at mount). */
export const POINT_TO_FIX_PICKER_INJECTION_SCRIPT = pickerInjectionScript(
  "https://ef-preview.local",
);
