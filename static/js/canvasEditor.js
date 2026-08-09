/*
 * Turns the canvas preview into something a person can click-and-drag.
 *
 * The canvas itself is never touched by pointer events — instead an
 * absolutely-positioned overlay div sits on top of it with one invisible
 * "editable-box" per draggable element (matched up via el.key). Dragging
 * a box, or its resize handle, writes an override into the app's state
 * and triggers a normal re-render; the overlay is then resynced against
 * the freshly-drawn layout so it never drifts out of alignment.
 *
 * The photo box additionally supports "reposition mode": double-click it
 * to pan/zoom the photo *inside* its fixed box (adjusting the focal point
 * used for cropping) instead of moving the box itself. This is what lets
 * an off-center subject be recentered, or a circular crop avoid cutting
 * off the part of the photo that actually matters.
 */

const FOCAL_ZOOM_MIN = 1;
const FOCAL_ZOOM_MAX = 4;
const FOCAL_ZOOM_STEP = 0.25;

function setupCanvasEditor(canvas, overlay, options) {
  const { getElements, onOverride, getFocal, onFocalChange, getImageNaturalSize } = options;

  let focalModeActive = false;
  let focalToolbarEl = null;

  function scale() {
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width || 1;
  }

  function liveElement(key) {
    return getElements().find((el) => el.key === key);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function exitFocalMode(node) {
    focalModeActive = false;
    node.classList.remove("editing-focal");
    if (focalToolbarEl) {
      focalToolbarEl.remove();
      focalToolbarEl = null;
    }
  }

  function enterFocalMode(node) {
    focalModeActive = true;
    node.classList.add("editing-focal");

    const toolbar = document.createElement("div");
    toolbar.className = "focal-toolbar";

    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.type = "button";
    zoomOutBtn.className = "focal-btn";
    zoomOutBtn.textContent = "−";
    zoomOutBtn.title = "Zoom out";
    zoomOutBtn.addEventListener("click", () => {
      const focal = getFocal();
      onFocalChange({ zoom: clamp((focal.zoom || 1) - FOCAL_ZOOM_STEP, FOCAL_ZOOM_MIN, FOCAL_ZOOM_MAX) });
    });

    const zoomInBtn = document.createElement("button");
    zoomInBtn.type = "button";
    zoomInBtn.className = "focal-btn";
    zoomInBtn.textContent = "+";
    zoomInBtn.title = "Zoom in";
    zoomInBtn.addEventListener("click", () => {
      const focal = getFocal();
      onFocalChange({ zoom: clamp((focal.zoom || 1) + FOCAL_ZOOM_STEP, FOCAL_ZOOM_MIN, FOCAL_ZOOM_MAX) });
    });

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "focal-btn focal-done-btn";
    doneBtn.textContent = "✓ Done";
    doneBtn.addEventListener("click", () => exitFocalMode(node));

    toolbar.appendChild(zoomOutBtn);
    toolbar.appendChild(zoomInBtn);
    toolbar.appendChild(doneBtn);
    node.appendChild(toolbar);
    focalToolbarEl = toolbar;
  }

  function startPan(node, key, e) {
    const natural = getImageNaturalSize && getImageNaturalSize();
    const liveEl = liveElement(key);
    if (!natural || !liveEl) return;

    node.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startFocal = getFocal();
    const origFx = startFocal.x;
    const origFy = startFocal.y;
    const zoom = Math.max(1, startFocal.zoom || 1);

    const targetRatio = liveEl.w / liveEl.h;
    const imgRatio = natural.width / natural.height;
    let baseW, baseH;
    if (imgRatio > targetRatio) {
      baseH = natural.height;
      baseW = baseH * targetRatio;
    } else {
      baseW = natural.width;
      baseH = baseW / targetRatio;
    }
    const sw = baseW / zoom;
    const sh = baseH / zoom;

    const move = (ev) => {
      const s = scale();
      const dxCanvas = (ev.clientX - startX) / s;
      const dyCanvas = (ev.clientY - startY) / s;
      const newFx = origFx - (dxCanvas * sw) / (liveEl.w * natural.width);
      const newFy = origFy - (dyCanvas * sh) / (liveEl.h * natural.height);
      onFocalChange({ x: clamp(newFx, 0, 1), y: clamp(newFy, 0, 1) });
    };
    const up = () => {
      node.releasePointerCapture(e.pointerId);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
  }

  function bindDrag(node, key) {
    if (key === "image") {
      node.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (focalModeActive) exitFocalMode(node);
        else enterFocalMode(node);
      });
    }

    node.addEventListener("pointerdown", (e) => {
      if (e.target !== node) return;
      e.preventDefault();

      if (key === "image" && focalModeActive) {
        startPan(node, key, e);
        return;
      }

      const startEl = liveElement(key);
      if (!startEl) return;

      node.setPointerCapture(e.pointerId);
      node.classList.add("dragging");
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = startEl.x;
      const origY = startEl.y;

      const move = (ev) => {
        const s = scale();
        onOverride(key, {
          x: origX + (ev.clientX - startX) / s,
          y: origY + (ev.clientY - startY) / s,
        });
      };
      const up = () => {
        node.releasePointerCapture(e.pointerId);
        node.classList.remove("dragging");
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
    });
  }

  function bindResize(handle, key) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startEl = liveElement(key);
      if (!startEl) return;

      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = startEl.w;
      const origH = startEl.h;

      const move = (ev) => {
        const s = scale();
        onOverride(key, {
          w: Math.max(60, origW + (ev.clientX - startX) / s),
          h: Math.max(60, origH + (ev.clientY - startY) / s),
        });
      };
      const up = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function bindFocalWheel(node, key) {
    node.addEventListener("wheel", (e) => {
      if (key !== "image" || !focalModeActive) return;
      e.preventDefault();
      const focal = getFocal();
      onFocalChange({ zoom: clamp((focal.zoom || 1) - e.deltaY * 0.0015, FOCAL_ZOOM_MIN, FOCAL_ZOOM_MAX) });
    }, { passive: false });
  }

  function sync() {
    const ctx2d = canvas.getContext("2d");
    const s = scale();
    const editable = getElements().filter((el) => el.key);
    const seenKeys = new Set();

    editable.forEach((el) => {
      const box = measureElementBox(ctx2d, el);
      if (!box) return;
      seenKeys.add(el.key);

      let node = overlay.querySelector(`[data-key="${el.key}"]`);
      if (!node) {
        node = document.createElement("div");
        node.className = "editable-box";
        node.dataset.key = el.key;
        node.title = el.type === "image" ? "Drag to move • double-click to reposition photo" : "Drag to move";
        bindDrag(node, el.key);

        if (el.type === "image") {
          const hint = document.createElement("div");
          hint.className = "focal-hint";
          hint.textContent = "🔍 Double-click to zoom & reposition";
          node.appendChild(hint);
          bindFocalWheel(node, el.key);

          const handle = document.createElement("div");
          handle.className = "resize-handle";
          handle.title = "Drag to resize";
          node.appendChild(handle);
          bindResize(handle, el.key);
        }

        overlay.appendChild(node);
      }

      node.style.left = `${box.left * s}px`;
      node.style.top = `${box.top * s}px`;
      node.style.width = `${box.width * s}px`;
      node.style.height = `${box.height * s}px`;
    });

    Array.from(overlay.children).forEach((child) => {
      if (!seenKeys.has(child.dataset.key)) {
        if (child.dataset.key === "image") focalModeActive = false;
        child.remove();
      }
    });
  }

  return { sync };
}
