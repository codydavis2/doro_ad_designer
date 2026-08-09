/*
 * Draws a layout (array of elements produced by layouts.js) onto a canvas.
 *
 * The measure* helpers compute a screen-space bounding box for an element
 * exactly as it will be drawn — both the draw* functions and the
 * drag/resize overlay (canvasEditor.js) use them, so the invisible drag
 * handles always line up with what's actually painted.
 */

function wrapText(ctx, text, maxWidth) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fontString(el) {
  const family = el.fontFamily || '"Segoe UI", Arial, sans-serif';
  const style = el.italic ? "italic " : "";
  return `${style}${el.weight || 600} ${el.size}px ${family}`;
}

function elementPivot(el) {
  if (el.rotationCx !== undefined && el.rotationCy !== undefined) {
    return { x: el.rotationCx, y: el.rotationCy };
  }
  if (el.w !== undefined && el.h !== undefined) {
    return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  }
  return { x: el.x, y: el.y };
}

function measureTextBox(ctx, el) {
  ctx.font = fontString(el);
  const maxLines = el.maxLines || 3;
  const lines = wrapText(ctx, el.text, el.w).slice(0, maxLines);
  const lineHeight = el.size * 1.18;
  const height = Math.max(lines.length, 1) * lineHeight;
  let left = el.x;
  if (el.align === "right") left = el.x - el.w;
  else if (el.align === "center") left = el.x - el.w / 2;
  return { left, top: el.y, width: el.w, height };
}

function measureBadgeBox(ctx, el) {
  ctx.font = `700 ${el.size || 24}px "Segoe UI", Arial, sans-serif`;
  const paddingX = 16;
  const textWidth = ctx.measureText(el.text).width;
  const boxW = textWidth + paddingX * 2;
  const boxH = (el.size || 24) * 1.9;
  let left = el.x;
  if (el.align === "center") left = el.x - boxW / 2;
  else if (el.align === "right") left = el.x - boxW;
  return { left, top: el.y, width: boxW, height: boxH };
}

function measureCtaBox(ctx, el) {
  ctx.font = `800 ${el.size}px "Segoe UI", Arial, sans-serif`;
  const paddingX = el.size * 1.1;
  const textWidth = ctx.measureText(el.text.toUpperCase()).width;
  const boxW = textWidth + paddingX * 2;
  const boxH = el.size * 2.6;
  let left = el.x;
  if (el.align === "center") left = el.x - boxW / 2;
  else if (el.align === "right") left = el.x - boxW;
  return { left, top: el.y, width: boxW, height: boxH };
}

function measureImageBox(el) {
  return { left: el.x, top: el.y, width: el.w, height: el.h };
}

function measureElementBox(ctx, el) {
  switch (el.type) {
    case "text": return measureTextBox(ctx, el);
    case "badge": return measureBadgeBox(ctx, el);
    case "ctaPill": return measureCtaBox(ctx, el);
    case "image": return measureImageBox(el);
    default: return null;
  }
}

function drawColorPanel(ctx, el) {
  const grad = ctx.createLinearGradient(el.x, el.y, el.x, el.y + el.h);
  grad.addColorStop(0, el.from);
  grad.addColorStop(1, el.to);
  ctx.save();
  ctx.beginPath();
  if (el.radius) roundedRectPath(ctx, el.x, el.y, el.w, el.h, el.radius);
  else ctx.rect(el.x, el.y, el.w, el.h);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(el.x, el.y, el.w, el.h);
  ctx.restore();
}

/**
 * Picks the source-pixel rectangle to crop out of `image` for a box of
 * size boxW x boxH, given a focal point { x, y, zoom } in normalized
 * (0..1) image coordinates. zoom=1 is the tightest crop that still fully
 * covers the box (the old fixed behavior); zoom>1 crops in tighter around
 * the focal point. x/y default to 0.5 (centered) when no focal is given.
 */
function computeImageSourceRect(image, boxW, boxH, focal) {
  const targetRatio = boxW / boxH;
  const imgRatio = image.width / image.height;
  let baseW, baseH;
  if (imgRatio > targetRatio) {
    baseH = image.height;
    baseW = baseH * targetRatio;
  } else {
    baseW = image.width;
    baseH = baseW / targetRatio;
  }

  const zoom = Math.max(1, (focal && focal.zoom) || 1);
  const sw = Math.min(image.width, baseW / zoom);
  const sh = Math.min(image.height, baseH / zoom);
  const fx = focal && focal.x != null ? focal.x : 0.5;
  const fy = focal && focal.y != null ? focal.y : 0.5;

  let sx = fx * image.width - sw / 2;
  let sy = fy * image.height - sh / 2;
  sx = Math.max(0, Math.min(image.width - sw, sx));
  sy = Math.max(0, Math.min(image.height - sh, sy));

  return { sx, sy, sw, sh };
}

function drawImageElement(ctx, el, image) {
  ctx.save();
  if (el.circleCrop) {
    ctx.beginPath();
    ctx.arc(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, 0, Math.PI * 2);
    ctx.clip();
  } else if (el.radius) {
    roundedRectPath(ctx, el.x, el.y, el.w, el.h, el.radius);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(el.x, el.y, el.w, el.h);
    ctx.clip();
  }

  if (image) {
    const { sx, sy, sw, sh } = computeImageSourceRect(image, el.w, el.h, el.focal);
    ctx.drawImage(image, sx, sy, sw, sh, el.x, el.y, el.w, el.h);
  } else {
    ctx.fillStyle = "#d8dae0";
    ctx.fillRect(el.x, el.y, el.w, el.h);
  }
  ctx.restore();
}

function drawText(ctx, el) {
  ctx.save();
  ctx.font = fontString(el);
  ctx.fillStyle = el.color;
  ctx.textBaseline = "top";
  ctx.textAlign = el.align === "right" ? "right" : el.align === "center" ? "center" : "left";

  const maxLines = el.maxLines || 3;
  const lines = wrapText(ctx, el.text, el.w).slice(0, maxLines);
  const lineHeight = el.size * 1.18;

  lines.forEach((line, i) => {
    ctx.fillText(line, el.x, el.y + i * lineHeight);
  });
  ctx.restore();
}

function drawBadge(ctx, el) {
  ctx.save();
  const box = measureBadgeBox(ctx, el);

  roundedRectPath(ctx, box.left, box.top, box.width, box.height, box.height / 2);
  ctx.fillStyle = el.bg;
  ctx.fill();

  ctx.fillStyle = el.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.text.toUpperCase(), box.left + box.width / 2, box.top + box.height / 2 + 1);
  ctx.restore();
}

function drawCtaPill(ctx, el) {
  if (!el.text) return;
  ctx.save();
  const box = measureCtaBox(ctx, el);

  roundedRectPath(ctx, box.left, box.top, box.width, box.height, box.height / 2);
  ctx.fillStyle = el.bg;
  ctx.fill();

  ctx.fillStyle = el.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.text.toUpperCase(), box.left + box.width / 2, box.top + box.height / 2 + 1);
  ctx.restore();
}

function drawPolygon(ctx, el) {
  ctx.save();
  ctx.globalAlpha = el.alpha ?? 1;
  ctx.beginPath();
  el.points.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = el.color;
  ctx.fill();
  ctx.restore();
}

function drawCircle(ctx, el) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2);
  if (el.strokeOnly) {
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.strokeWidth || 4;
    ctx.stroke();
  } else {
    ctx.fillStyle = el.color;
    ctx.fill();
  }
  ctx.restore();
}

function drawVignette(ctx, el) {
  ctx.save();
  const grad = ctx.createRadialGradient(el.cx, el.cy, el.r0, el.cx, el.cy, el.r1);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, el.colorTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function drawDashedLine(ctx, el) {
  ctx.save();
  ctx.strokeStyle = el.color || "rgba(255,255,255,0.6)";
  ctx.lineWidth = el.width || 3;
  ctx.setLineDash(el.dash || [14, 10]);
  ctx.beginPath();
  ctx.moveTo(el.x1, el.y1);
  ctx.lineTo(el.x2, el.y2);
  ctx.stroke();
  ctx.restore();
}

function renderLayout(canvas, layout, image) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  layout.elements.forEach((el) => {
    if (el.rotation) {
      const pivot = elementPivot(el);
      ctx.save();
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(el.rotation);
      ctx.translate(-pivot.x, -pivot.y);
    }

    switch (el.type) {
      case "rect": {
        ctx.save();
        ctx.globalAlpha = el.alpha ?? 1;
        ctx.beginPath();
        if (el.radius) roundedRectPath(ctx, el.x, el.y, el.w, el.h, el.radius);
        else ctx.rect(el.x, el.y, el.w, el.h);
        if (el.strokeOnly) {
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.strokeWidth || 4;
          ctx.stroke();
        } else {
          ctx.fillStyle = el.color;
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case "colorPanel":
        drawColorPanel(ctx, el);
        break;
      case "image":
        drawImageElement(ctx, el, image);
        break;
      case "text":
        drawText(ctx, el);
        break;
      case "badge":
        drawBadge(ctx, el);
        break;
      case "ctaPill":
        drawCtaPill(ctx, el);
        break;
      case "polygon":
        drawPolygon(ctx, el);
        break;
      case "circle":
        drawCircle(ctx, el);
        break;
      case "vignette":
        drawVignette(ctx, el);
        break;
      case "dashedLine":
        drawDashedLine(ctx, el);
        break;
      default:
        break;
    }

    if (el.rotation) ctx.restore();
  });
}
