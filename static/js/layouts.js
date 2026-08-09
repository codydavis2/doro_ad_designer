/*
 * Algorithmic layout engine.
 * No AI / image generation involved — every design is produced by
 * deterministic geometry + a seeded random number generator.
 *
 * 10 structural "archetypes" are each combined with 2 mirror states and
 * 5 decoration styles (2 x 5 = 10 variants each) to produce exactly 100
 * distinct, enumerable layout templates. Every template can be picked
 * explicitly by index (used by the layout gallery) or at random (used by
 * "Shuffle").
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastColor(hex) {
  return relativeLuminance(hex) > 0.5 ? "#141019" : "#ffffff";
}

function shadeColor(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const amt = Math.round(2.55 * percent);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const nr = clamp(r + amt).toString(16).padStart(2, "0");
  const ng = clamp(g + amt).toString(16).padStart(2, "0");
  const nb = clamp(b + amt).toString(16).padStart(2, "0");
  return `#${nr}${ng}${nb}`;
}

function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function withAlphaColor(hexOrRgba, alpha) {
  if (hexOrRgba.startsWith("rgba") || hexOrRgba.startsWith("rgb")) return hexOrRgba;
  return withAlpha(hexOrRgba, alpha);
}

/* ---- Decoration ------------------------------------------------------
 * Small extra shapes layered between the backdrop and the text, purely
 * for visual variety. Archetypes call ctx.injectDecor(els) once, right
 * after they've built their backdrop.
 * -----------------------------------------------------------------*/

function applyDecoration(elements, style, w, h, accentColor, rand) {
  if (!style || style === "none") return;

  if (style === "circle") {
    elements.push({ type: "circle", x: w * (rand() * 0.25), y: h * (rand() * 0.22), r: w * (0.16 + rand() * 0.1), color: withAlpha(accentColor, 0.22) });
    elements.push({ type: "circle", x: w * (0.82 + rand() * 0.14), y: h * (0.8 + rand() * 0.16), r: w * (0.12 + rand() * 0.08), color: withAlpha(accentColor, 0.28) });
  } else if (style === "stripe") {
    const stripeW = w * (0.05 + rand() * 0.03);
    const tilt = h * 0.15;
    const baseX = w * (0.72 + rand() * 0.1);
    elements.push({
      type: "polygon",
      color: withAlpha(accentColor, 0.5),
      points: [
        [baseX, 0], [baseX + stripeW, 0],
        [baseX + stripeW - tilt * 0.3, h], [baseX - tilt * 0.3, h],
      ],
    });
  } else if (style === "dots") {
    const cornerX = rand() > 0.5 ? w * 0.85 : w * 0.12;
    const cornerY = rand() > 0.5 ? h * 0.1 : h * 0.88;
    for (let i = 0; i < 6; i++) {
      elements.push({
        type: "circle",
        x: cornerX + (rand() - 0.5) * w * 0.12,
        y: cornerY + (rand() - 0.5) * h * 0.08,
        r: w * (0.006 + rand() * 0.01),
        color: withAlpha(accentColor, 0.6),
      });
    }
  } else if (style === "ribbon") {
    const flipH = rand() > 0.5;
    const baseY = h * (0.18 + rand() * 0.08);
    const bandH = h * 0.12;
    const x0 = flipH ? w : 0;
    const dir = flipH ? -1 : 1;
    elements.push({
      type: "polygon",
      color: withAlpha(accentColor, 0.85),
      points: [
        [x0, baseY], [x0 + dir * w * 0.16, baseY],
        [x0 + dir * w * 0.05, baseY + bandH], [x0, baseY + bandH],
      ],
    });
  }
}

function gridHairlines(w, h, spacing, color) {
  const lines = [];
  for (let x = spacing; x < w; x += spacing) {
    lines.push({ type: "rect", x, y: 0, w: 1.5, h, color });
  }
  for (let y = spacing; y < h; y += spacing) {
    lines.push({ type: "rect", x: 0, y, w, h: 1.5, color });
  }
  return lines;
}

function hazardStripes(x, y, bandW, bandH, colorA, colorB, stripeW, tilt) {
  const stripes = [];
  let cursor = -Math.abs(tilt);
  let toggle = true;
  while (cursor < bandW + Math.abs(tilt)) {
    stripes.push({
      type: "polygon",
      color: toggle ? colorA : colorB,
      points: [
        [x + cursor, y], [x + cursor + stripeW, y],
        [x + cursor + stripeW + tilt, y + bandH], [x + cursor + tilt, y + bandH],
      ],
    });
    cursor += stripeW;
    toggle = !toggle;
  }
  return stripes;
}

/* ---- Layout archetypes ------------------------------------------------
 * Each archetype is a function(ctx) => elements[]
 * ctx = { w, h, rand, content, primary, accent, injectDecor }
 * content = { headline, tagline, badge, cta, contact, hasImage }
 *
 * Elements that a person should be able to drag/resize in the live
 * preview carry a stable `key` (image | headline | tagline | badge | cta
 * | contact). Purely decorative shapes have no key and aren't editable.
 * -----------------------------------------------------------------*/

function fullBleedBottomBar(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const barHeight = h * (0.32 + rand() * 0.1);
  const barTop = h - barHeight;
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -10), to: shadeColor(primary, 15) });

  ctx.injectDecor(els);

  els.push({ type: "rect", x: 0, y: barTop, w, h: barHeight, color: primary, alpha: 0.92 });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.06, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.08;
  let cursorY = barTop + barHeight * 0.22;

  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.075, weight: 800, color: textColor, align: "left", maxLines: 2 });
  cursorY += w * 0.075 * 2.3;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.032, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 2 });

  const bottomY = h - h * 0.06;
  els.push({ type: "ctaPill", key: "cta", x: padX, y: bottomY - w * 0.09, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.034 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - padX, y: bottomY - w * 0.032, w: w * 0.5, text: content.contact, size: w * 0.026, weight: 600, color: withAlphaColor(textColor, 0.8), align: "right", maxLines: 1 });
  }

  return els;
}

function splitPanel(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const imageOnLeft = rand() > 0.5;
  const splitX = w * (0.5 + (rand() - 0.5) * 0.16);
  const panelW = imageOnLeft ? w - splitX : splitX;
  const panelX = imageOnLeft ? splitX : 0;
  const imgW = imageOnLeft ? splitX : w - splitX;
  const imgX = imageOnLeft ? 0 : splitX;
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: imgX, y: 0, w: imgW, h }
    : { type: "colorPanel", x: imgX, y: 0, w: imgW, h, from: shadeColor(accent, -15), to: shadeColor(primary, 0) });

  ctx.injectDecor(els);

  els.push({ type: "rect", x: panelX, y: 0, w: panelW, h, color: primary, alpha: 1 });

  const textColor = contrastColor(primary);
  const padX = panelX + panelW * 0.14;
  const textW = panelW * 0.72;
  let cursorY = h * 0.16;

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: padX, y: cursorY, text: content.badge, bg: accent, color: contrastColor(accent) });
    cursorY += h * 0.07;
  }

  cursorY += h * 0.05;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: textW, text: content.headline, size: panelW * 0.13, weight: 800, color: textColor, align: "left", maxLines: 3 });
  cursorY += panelW * 0.13 * 3.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: textW, text: content.tagline, size: panelW * 0.052, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 3 });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: h * 0.82, text: content.cta, bg: accent, color: contrastColor(accent), size: panelW * 0.058 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: padX, y: h * 0.93, w: textW, text: content.contact, size: panelW * 0.04, weight: 600, color: withAlphaColor(textColor, 0.75), align: "left", maxLines: 1 });
  }

  return els;
}

function topBannerBottomInfo(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const bannerH = h * (0.58 + rand() * 0.08);
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h: bannerH }
    : { type: "colorPanel", x: 0, y: 0, w, h: bannerH, from: shadeColor(primary, 20), to: shadeColor(accent, -10) });

  ctx.injectDecor(els);

  els.push({ type: "rect", x: 0, y: bannerH, w, h: h - bannerH, color: primary });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.05, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.08;
  let cursorY = bannerH + (h - bannerH) * 0.22;

  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.068, weight: 800, color: textColor, align: "center", maxLines: 2 });
  cursorY += w * 0.068 * 2.1;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.03, weight: 500, color: withAlphaColor(textColor, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h - (h - bannerH) * 0.24, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h - (h - bannerH) * 0.08, w: w - padX * 2, text: content.contact, size: w * 0.024, weight: 600, color: withAlphaColor(textColor, 0.75), align: "center", maxLines: 1 });
  }

  return els;
}

function framedCenter(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const els = [];

  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -8), to: shadeColor(primary, 12) });
  ctx.injectDecor(els);

  const frameW = w * 0.78;
  const frameH = h * (0.4 + rand() * 0.06);
  const frameX = (w - frameW) / 2;
  const frameY = h * 0.08;

  els.push({ type: "rect", x: frameX - w * 0.015, y: frameY - w * 0.015, w: frameW + w * 0.03, h: frameH + w * 0.03, color: accent, radius: 24 });
  els.push(content.hasImage
    ? { type: "image", key: "image", x: frameX, y: frameY, w: frameW, h: frameH, radius: 18 }
    : { type: "colorPanel", x: frameX, y: frameY, w: frameW, h: frameH, radius: 18, from: shadeColor(accent, -20), to: shadeColor(accent, 10) });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: frameX + frameW - w * 0.03, y: frameY - h * 0.025, text: content.badge, bg: accent, color: contrastColor(accent), align: "right" });
  }

  const textColor = contrastColor(primary);
  let cursorY = frameY + frameH + h * 0.09;

  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w * 0.86, text: content.headline, size: w * 0.078, weight: 800, color: textColor, align: "center", maxLines: 2 });
  cursorY += w * 0.078 * 2.2;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w * 0.8, text: content.tagline, size: w * 0.032, weight: 500, color: withAlphaColor(textColor, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.9, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.034, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.965, w: w * 0.8, text: content.contact, size: w * 0.024, weight: 600, color: withAlphaColor(textColor, 0.7), align: "center", maxLines: 1 });
  }

  return els;
}

function diagonalSlash(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -12), to: shadeColor(accent, -5) });

  ctx.injectDecor(els);

  const slashHeight = h * (0.4 + rand() * 0.08);
  const tilt = w * (0.12 + rand() * 0.08);
  els.push({
    type: "polygon",
    color: primary,
    alpha: 0.93,
    points: [
      [0, h], [0, h - slashHeight], [w, h - slashHeight - tilt], [w, h],
    ],
  });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.06, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.08;
  let cursorY = h - slashHeight * 0.62;

  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.07, weight: 800, color: textColor, align: "left", maxLines: 2 });
  cursorY += w * 0.07 * 2.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.03, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: h - h * 0.09, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - padX, y: h - h * 0.06, w: w * 0.5, text: content.contact, size: w * 0.024, weight: 600, color: withAlphaColor(textColor, 0.8), align: "right", maxLines: 1 });
  }

  return els;
}

function colorBlockGrid(ctx) {
  const { w, h, rand, content, primary, accent } = ctx;
  const els = [];

  els.push({ type: "rect", x: 0, y: 0, w, h, color: primary });
  ctx.injectDecor(els);

  const circleR = w * (0.28 + rand() * 0.1);
  els.push({ type: "circle", x: w * (rand() * 0.3), y: h * (rand() * 0.25), r: circleR, color: withAlpha(accent, 0.35) });
  els.push({ type: "circle", x: w * (0.75 + rand() * 0.2), y: h * (0.75 + rand() * 0.2), r: circleR * 0.8, color: withAlpha(accent, 0.5) });

  if (content.hasImage) {
    const imgSize = w * 0.42;
    els.push({ type: "image", key: "image", x: (w - imgSize) / 2, y: h * 0.1, w: imgSize, h: imgSize, radius: imgSize / 2, circleCrop: true });
  }

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.06, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.1;
  let cursorY = content.hasImage ? h * 0.58 : h * 0.36;

  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.08, weight: 800, color: textColor, align: "center", maxLines: 2 });
  cursorY += w * 0.08 * 2.2;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.032, weight: 500, color: withAlphaColor(textColor, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.88, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.036, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.95, w: w - padX * 2, text: content.contact, size: w * 0.024, weight: 600, color: withAlphaColor(textColor, 0.75), align: "center", maxLines: 1 });
  }

  return els;
}

function ribbonCorner(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -10), to: shadeColor(accent, -15) });

  ctx.injectDecor(els);

  const panelW = w * 0.62;
  const panelH = h * 0.3;
  const panelX = w * 0.055;
  const panelY = h - panelH - h * 0.07;
  els.push({ type: "rect", x: panelX, y: panelY, w: panelW, h: panelH, color: primary, alpha: 0.9, radius: 22 });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w - w * 0.06, y: h * 0.05, text: content.badge, bg: accent, color: contrastColor(accent), align: "right" });
  }

  const textColor = contrastColor(primary);
  const padX = panelX + panelW * 0.09;
  let cursorY = panelY + panelH * 0.16;

  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: panelW * 0.82, text: content.headline, size: panelW * 0.115, weight: 800, color: textColor, align: "left", maxLines: 2 });
  cursorY += panelW * 0.115 * 2.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: panelW * 0.82, text: content.tagline, size: panelW * 0.048, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: panelY + panelH + h * 0.025, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.03 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - w * 0.06, y: h * 0.94, w: w * 0.4, text: content.contact, size: w * 0.022, weight: 600, color: contrastColor(shadeColor(primary, -30)), align: "right", maxLines: 1 });
  }

  return els;
}

function magazineCover(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  const imgH = h * 0.62;

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h: imgH }
    : { type: "colorPanel", x: 0, y: 0, w, h: imgH, from: shadeColor(accent, -10), to: shadeColor(primary, 10) });

  els.push({ type: "rect", x: 0, y: imgH, w, h: h - imgH, color: primary });
  ctx.injectDecor(els);

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.05, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.07;
  const headlineY = imgH - w * 0.06;

  els.push({ type: "text", key: "headline", x: padX, y: headlineY, w: w - padX * 2, text: content.headline, size: w * 0.115, weight: 800, color: contrastColor(primary), align: "left", maxLines: 2 });

  let cursorY = imgH + w * 0.09;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.032, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w - padX, y: h - h * 0.11, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032, align: "right" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: padX, y: h - h * 0.08, w: w * 0.5, text: content.contact, size: w * 0.024, weight: 600, color: withAlphaColor(textColor, 0.75), align: "left", maxLines: 1 });
  }

  return els;
}

function ticketStub(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  const imgW = w * 0.55;

  els.push({ type: "rect", x: 0, y: 0, w, h, color: primary, radius: 28 });
  els.push(content.hasImage
    ? { type: "image", key: "image", x: w * 0.03, y: h * 0.03, w: imgW - w * 0.04, h: h * 0.94, radius: 18 }
    : { type: "colorPanel", x: w * 0.03, y: h * 0.03, w: imgW - w * 0.04, h: h * 0.94, radius: 18, from: shadeColor(accent, -15), to: shadeColor(primary, 10) });

  ctx.injectDecor(els);

  els.push({ type: "dashedLine", x1: imgW, y1: h * 0.06, x2: imgW, y2: h * 0.94, color: withAlphaColor(contrastColor(primary), 0.4), width: 3 });

  const padX = imgW + w * 0.06;
  const colW = w - padX - w * 0.05;
  const textColor = contrastColor(primary);
  let cursorY = h * 0.1;

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: padX, y: cursorY, text: content.badge, bg: accent, color: contrastColor(accent) });
    cursorY += h * 0.09;
  }

  cursorY += h * 0.03;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: colW, text: content.headline, size: colW * 0.15, weight: 800, color: textColor, align: "left", maxLines: 3 });
  cursorY += colW * 0.15 * 3.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: colW, text: content.tagline, size: colW * 0.06, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 3 });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: h * 0.82, text: content.cta, bg: accent, color: contrastColor(accent), size: colW * 0.062 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: padX, y: h * 0.93, w: colW, text: content.contact, size: colW * 0.042, weight: 600, color: withAlphaColor(textColor, 0.7), align: "left", maxLines: 1 });
  }

  return els;
}

function spotlightVignette(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, 15), to: shadeColor(primary, -15) });

  ctx.injectDecor(els);
  els.push({ type: "vignette", cx: w / 2, cy: h / 2, r0: w * 0.1, r1: w * 0.85, colorTo: withAlpha("#000000", 0.6) });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w / 2, y: h * 0.06, text: content.badge, bg: accent, color: contrastColor(accent), align: "center" });
  }

  let cursorY = h * 0.42;
  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w * 0.82, text: content.headline, size: w * 0.09, weight: 800, color: "#ffffff", align: "center", maxLines: 2 });
  cursorY += w * 0.09 * 2.2;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w * 0.72, text: content.tagline, size: w * 0.034, weight: 500, color: "rgba(255,255,255,0.88)", align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.82, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.036, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.9, w: w * 0.7, text: content.contact, size: w * 0.024, weight: 600, color: "rgba(255,255,255,0.75)", align: "center", maxLines: 1 });
  }

  return els;
}

function wantedPoster(ctx) {
  const { w, h, content, primary, accent, rand } = ctx;
  const els = [];
  const paper = shadeColor(primary, 78);
  const ink = shadeColor(primary, -60);

  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: paper, to: shadeColor(paper, -6) });
  ctx.injectDecor(els);

  const borderPad = w * 0.045;
  els.push({ type: "rect", x: borderPad, y: borderPad, w: w - borderPad * 2, h: h - borderPad * 2, color: ink, strokeOnly: true, strokeWidth: w * 0.012 });
  els.push({ type: "rect", x: borderPad + w * 0.02, y: borderPad + w * 0.02, w: w - (borderPad + w * 0.02) * 2, h: h - (borderPad + w * 0.02) * 2, color: ink, strokeOnly: true, strokeWidth: w * 0.004 });

  const imgSize = w * 0.5;
  const imgX = (w - imgSize) / 2;
  const imgY = h * 0.14;
  const imgH = imgSize * 1.1;
  els.push(content.hasImage
    ? { type: "image", key: "image", x: imgX, y: imgY, w: imgSize, h: imgH }
    : { type: "colorPanel", x: imgX, y: imgY, w: imgSize, h: imgH, from: shadeColor(ink, 20), to: shadeColor(ink, 40) });

  const tapeColor = "rgba(245, 230, 184, 0.85)";
  [[imgX, imgY], [imgX + imgSize, imgY], [imgX, imgY + imgH], [imgX + imgSize, imgY + imgH]].forEach(([tx, ty], i) => {
    const rot = (i % 2 === 0 ? -1 : 1) * (0.12 + rand() * 0.08);
    els.push({ type: "rect", x: tx - w * 0.035, y: ty - h * 0.018, w: w * 0.07, h: h * 0.036, color: tapeColor, rotation: rot, rotationCx: tx, rotationCy: ty });
  });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.5, y: imgY + imgH + h * 0.02, text: content.badge, bg: accent, color: contrastColor(accent), align: "center", rotation: -0.05 });
  }

  let cursorY = imgY + imgH + h * 0.08;
  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w * 0.8, text: content.headline, size: w * 0.09, weight: 800, color: ink, align: "center", maxLines: 2 });
  cursorY += w * 0.09 * 2.1;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w * 0.72, text: content.tagline, size: w * 0.032, weight: 600, color: withAlphaColor(ink, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.9, text: content.cta, bg: ink, color: paper, size: w * 0.032, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.965, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: withAlphaColor(ink, 0.7), align: "center", maxLines: 1 });
  }

  return els;
}

function vaultDoor(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -20), to: shadeColor(primary, 10) });
  ctx.injectDecor(els);

  const cx = w / 2;
  const cy = h * 0.38;
  const outerR = w * 0.36;

  els.push({ type: "circle", x: cx, y: cy, r: outerR + w * 0.03, color: withAlpha(accent, 0.5), strokeOnly: true, strokeWidth: w * 0.01 });
  els.push({ type: "circle", x: cx, y: cy, r: outerR, color: shadeColor(primary, 30) });
  els.push(content.hasImage
    ? { type: "image", key: "image", x: cx - outerR * 0.82, y: cy - outerR * 0.82, w: outerR * 1.64, h: outerR * 1.64, circleCrop: true }
    : { type: "circle", x: cx, y: cy, r: outerR * 0.82, color: shadeColor(accent, -10) });

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const bx = cx + Math.cos(angle) * outerR;
    const by = cy + Math.sin(angle) * outerR;
    const size = w * 0.018;
    els.push({ type: "rect", x: bx - size / 2, y: by - size / 2, w: size, h: size, color: shadeColor(primary, 45), rotation: angle, rotationCx: bx, rotationCy: by });
  }

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: cx, y: cy - outerR - h * 0.09, text: content.badge, bg: accent, color: contrastColor(accent), align: "center" });
  }

  const textColor = contrastColor(primary);
  let cursorY = cy + outerR + h * 0.06;
  els.push({ type: "text", key: "headline", x: cx, y: cursorY, w: w * 0.84, text: content.headline, size: w * 0.075, weight: 800, color: textColor, align: "center", maxLines: 2 });
  cursorY += w * 0.075 * 2.1;
  els.push({ type: "text", key: "tagline", x: cx, y: cursorY, w: w * 0.74, text: content.tagline, size: w * 0.03, weight: 500, color: withAlphaColor(textColor, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: cx, y: h * 0.88, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.034, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: cx, y: h * 0.95, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: withAlphaColor(textColor, 0.7), align: "center", maxLines: 1 });
  }

  return els;
}

function detectiveBoard(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -35), to: shadeColor(primary, -15) });
  ctx.injectDecor(els);

  const imgW = w * 0.5;
  const imgH = h * 0.34;
  const imgX = w * 0.08;
  const imgY = h * 0.1;
  const tilt = -0.03;
  els.push(content.hasImage
    ? { type: "image", key: "image", x: imgX, y: imgY, w: imgW, h: imgH, rotation: tilt, rotationCx: imgX + imgW / 2, rotationCy: imgY + imgH / 2 }
    : { type: "colorPanel", x: imgX, y: imgY, w: imgW, h: imgH, from: shadeColor(accent, -10), to: shadeColor(accent, 10), rotation: tilt, rotationCx: imgX + imgW / 2, rotationCy: imgY + imgH / 2 });

  const pinX = imgX + imgW / 2;
  const pinY = imgY - h * 0.012;
  els.push({ type: "circle", x: pinX, y: pinY, r: w * 0.012, color: accent });

  const noteX = w * 0.62;
  const noteY = h * 0.14;
  const noteW = w * 0.3;
  const noteH = h * 0.22;
  els.push({ type: "rect", x: noteX, y: noteY, w: noteW, h: noteH, color: shadeColor(accent, 25), rotation: 0.04, rotationCx: noteX + noteW / 2, rotationCy: noteY + noteH / 2 });
  els.push({ type: "dashedLine", x1: pinX, y1: pinY, x2: noteX + noteW / 2, y2: noteY + noteH / 2, color: "rgba(226, 59, 59, 0.85)", width: 2.5, dash: [6, 6] });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: h * 0.03, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const textColor = contrastColor(primary);
  const padX = w * 0.08;
  let cursorY = Math.max(imgY + imgH, noteY + noteH) + h * 0.08;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.075, weight: 800, color: textColor, align: "left", maxLines: 2, italic: true });
  cursorY += w * 0.075 * 2.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.032, weight: 500, color: withAlphaColor(textColor, 0.85), align: "left", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: h * 0.88, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - padX, y: h * 0.9, w: w * 0.5, text: content.contact, size: w * 0.022, weight: 600, color: withAlphaColor(textColor, 0.7), align: "right", maxLines: 1 });
  }

  return els;
}

function countdownTimer(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  const dark = shadeColor(primary, -30);
  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: dark, to: shadeColor(primary, -10) });
  ctx.injectDecor(els);

  if (content.hasImage) {
    els.push({ type: "image", key: "image", x: w * 0.62, y: h * 0.06, w: w * 0.32, h: w * 0.32, radius: 16 });
  }

  const ruleColor = withAlpha(accent, 0.7);
  els.push({ type: "rect", x: w * 0.08, y: h * 0.1, w: w * 0.5, h: w * 0.006, color: ruleColor });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.08, y: h * 0.03, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  const padX = w * 0.08;
  let cursorY = h * 0.32;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: w * 0.84, text: content.headline, size: w * 0.1, weight: 800, color: "#ffffff", align: "left", maxLines: 2, fontFamily: '"Courier New", monospace' });
  cursorY += w * 0.1 * 2.2;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w * 0.8, text: content.tagline, size: w * 0.032, weight: 500, color: withAlpha(accent, 0.9), align: "left", maxLines: 2, fontFamily: '"Courier New", monospace' });

  els.push({ type: "rect", x: w * 0.08, y: h * 0.86 - w * 0.02, w: w * 0.5, h: w * 0.006, color: ruleColor });
  els.push({ type: "ctaPill", key: "cta", x: padX, y: h * 0.86, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.034 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - padX, y: h * 0.94, w: w * 0.5, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.6)", align: "right", maxLines: 1 });
  }

  return els;
}

function filmstrip(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push({ type: "rect", x: 0, y: 0, w, h, color: "#0c0c0c" });

  const stripY = h * 0.1;
  const stripH = h * 0.46;
  const bandH = h * 0.045;

  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: stripY, w, h: stripH }
    : { type: "colorPanel", x: 0, y: stripY, w, h: stripH, from: shadeColor(primary, 10), to: shadeColor(accent, -10) });

  els.push({ type: "rect", x: 0, y: stripY - bandH, w, h: bandH, color: "#1c1c1c" });
  els.push({ type: "rect", x: 0, y: stripY + stripH, w, h: bandH, color: "#1c1c1c" });
  const holeR = w * 0.013;
  for (let i = 0; i < 9; i++) {
    const hx = w * (0.06 + i * 0.11);
    els.push({ type: "circle", x: hx, y: stripY - bandH / 2, r: holeR, color: "#0c0c0c" });
    els.push({ type: "circle", x: hx, y: stripY + stripH + bandH / 2, r: holeR, color: "#0c0c0c" });
  }

  ctx.injectDecor(els);

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: stripY + stripH + bandH + h * 0.02, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  let cursorY = stripY + stripH + bandH + h * 0.09;
  els.push({ type: "text", key: "headline", x: w / 2, y: cursorY, w: w * 0.84, text: content.headline, size: w * 0.075, weight: 800, color: "#ffffff", align: "center", maxLines: 2 });
  cursorY += w * 0.075 * 2.1;
  els.push({ type: "text", key: "tagline", x: w / 2, y: cursorY, w: w * 0.76, text: content.tagline, size: w * 0.03, weight: 500, color: "rgba(255,255,255,0.8)", align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.9, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.965, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.65)", align: "center", maxLines: 1 });
  }

  return els;
}

function comicPanels(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push({ type: "rect", x: 0, y: 0, w, h, color: shadeColor(accent, -20) });
  ctx.injectDecor(els);

  const gap = w * 0.025;
  const border = w * 0.014;

  const p1 = { x: gap, y: gap, w: w - gap * 2, h: h * 0.44 };
  els.push({ type: "rect", x: p1.x - border, y: p1.y - border, w: p1.w + border * 2, h: p1.h + border * 2, color: "#141019" });
  els.push(content.hasImage
    ? { type: "image", key: "image", x: p1.x, y: p1.y, w: p1.w, h: p1.h }
    : { type: "colorPanel", x: p1.x, y: p1.y, w: p1.w, h: p1.h, from: shadeColor(primary, 10), to: shadeColor(primary, -10) });

  const p2 = { x: gap, y: p1.y + p1.h + border * 2 + gap, w: w * 0.56 - gap, h: h * 0.24 };
  els.push({ type: "rect", x: p2.x - border, y: p2.y - border, w: p2.w + border * 2, h: p2.h + border * 2, color: "#141019" });
  els.push({ type: "rect", x: p2.x, y: p2.y, w: p2.w, h: p2.h, color: "#ffffff" });
  els.push({ type: "text", key: "headline", x: p2.x + p2.w / 2, y: p2.y + p2.h / 2 - w * 0.045, w: p2.w * 0.86, text: content.headline, size: w * 0.06, weight: 800, color: "#141019", align: "center", maxLines: 2, rotation: -0.025, rotationCx: p2.x + p2.w / 2, rotationCy: p2.y + p2.h / 2 });

  const p3 = { x: p2.x + p2.w + border * 2 + gap, y: p2.y, w: w - (p2.x + p2.w + border * 2 + gap) - gap, h: p2.h };
  els.push({ type: "rect", x: p3.x - border, y: p3.y - border, w: p3.w + border * 2, h: p3.h + border * 2, color: "#141019" });
  els.push({ type: "rect", x: p3.x, y: p3.y, w: p3.w, h: p3.h, color: accent });
  els.push({ type: "text", key: "tagline", x: p3.x + p3.w / 2, y: p3.y + p3.h * 0.28, w: p3.w * 0.86, text: content.tagline, size: w * 0.026, weight: 700, color: contrastColor(accent), align: "center", maxLines: 3 });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: p1.x + w * 0.02, y: p1.y + w * 0.02, text: content.badge, bg: accent, color: contrastColor(accent), rotation: -0.08 });
  }

  const bottomY = p2.y + p2.h + border * 2 + gap * 1.5;
  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: bottomY, text: content.cta, bg: "#141019", color: "#ffffff", size: w * 0.036, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: bottomY + w * 0.09, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.85)", align: "center", maxLines: 1 });
  }

  return els;
}

function warningTape(ctx) {
  const { w, h, content, primary, accent, rand } = ctx;
  const els = [];
  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -15), to: shadeColor(primary, 5) });

  els.push({ type: "rect", x: 0, y: 0, w, h, color: "rgba(0,0,0,0.35)" });
  ctx.injectDecor(els);

  const bandY = h * (0.34 + rand() * 0.04);
  const bandH = h * 0.26;
  els.push({ type: "rect", x: 0, y: bandY, w, h: bandH, color: "#141019" });
  hazardStripes(-h * 0.15, bandY, w + h * 0.3, bandH, accent, "#141019", w * 0.07, h * 0.14).forEach((s) => els.push(s));

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w * 0.06, y: bandY - h * 0.09, text: content.badge, bg: accent, color: contrastColor(accent) });
  }

  els.push({ type: "text", key: "headline", x: w / 2, y: bandY + bandH / 2 - w * 0.065, w: w * 0.8, text: content.headline, size: w * 0.065, weight: 800, color: "#ffffff", align: "center", maxLines: 2 });

  const padX = w * 0.08;
  els.push({ type: "text", key: "tagline", x: w / 2, y: bandY + bandH + h * 0.04, w: w - padX * 2, text: content.tagline, size: w * 0.032, weight: 600, color: "#ffffff", align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.88, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.036, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.95, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.75)", align: "center", maxLines: 1 });
  }

  return els;
}

function circularMedallion(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push({ type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -10), to: shadeColor(primary, 12) });
  ctx.injectDecor(els);

  const cx = w / 2;
  const cy = h * 0.32;
  const r = w * 0.28;

  els.push({ type: "circle", x: cx, y: cy, r: r + w * 0.025, color: accent, strokeOnly: true, strokeWidth: w * 0.012 });
  els.push({ type: "circle", x: cx, y: cy, r: r + w * 0.05, color: withAlpha(accent, 0.5), strokeOnly: true, strokeWidth: w * 0.004 });
  els.push(content.hasImage
    ? { type: "image", key: "image", x: cx - r, y: cy - r, w: r * 2, h: r * 2, circleCrop: true }
    : { type: "circle", x: cx, y: cy, r, color: shadeColor(accent, -15) });

  const ribbonY = cy + r * 0.7;
  const ribbonH = h * 0.09;
  const ribbonW = w * 0.62;
  els.push({ type: "rect", x: cx - ribbonW / 2, y: ribbonY, w: ribbonW, h: ribbonH, color: primary });
  els.push({ type: "polygon", color: shadeColor(primary, -20), points: [[cx - ribbonW / 2 - w * 0.04, ribbonY], [cx - ribbonW / 2, ribbonY], [cx - ribbonW / 2, ribbonY + ribbonH], [cx - ribbonW / 2 - w * 0.04, ribbonY + ribbonH * 0.6]] });
  els.push({ type: "polygon", color: shadeColor(primary, -20), points: [[cx + ribbonW / 2 + w * 0.04, ribbonY], [cx + ribbonW / 2, ribbonY], [cx + ribbonW / 2, ribbonY + ribbonH], [cx + ribbonW / 2 + w * 0.04, ribbonY + ribbonH * 0.6]] });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: cx, y: cy - r - h * 0.08, text: content.badge, bg: accent, color: contrastColor(accent), align: "center" });
  }

  const textColor = contrastColor(primary);
  els.push({ type: "text", key: "headline", x: cx, y: ribbonY + ribbonH / 2 - w * 0.028, w: ribbonW * 0.86, text: content.headline, size: w * 0.045, weight: 800, color: textColor, align: "center", maxLines: 1 });

  let cursorY = ribbonY + ribbonH + h * 0.05;
  els.push({ type: "text", key: "tagline", x: cx, y: cursorY, w: w * 0.72, text: content.tagline, size: w * 0.03, weight: 500, color: withAlphaColor(textColor, 0.85), align: "center", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: cx, y: h * 0.87, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.034, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: cx, y: h * 0.94, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: withAlphaColor(textColor, 0.7), align: "center", maxLines: 1 });
  }

  return els;
}

function blueprintGrid(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  const blue = shadeColor(primary, -25);
  els.push({ type: "rect", x: 0, y: 0, w, h, color: blue });
  gridHairlines(w, h, w * 0.06, "rgba(255,255,255,0.12)").forEach((l) => els.push(l));
  ctx.injectDecor(els);

  const imgW = w * 0.5;
  const imgH = h * 0.32;
  const imgX = w * 0.08;
  const imgY = h * 0.1;
  els.push(content.hasImage
    ? { type: "image", key: "image", x: imgX, y: imgY, w: imgW, h: imgH, radius: 6 }
    : { type: "colorPanel", x: imgX, y: imgY, w: imgW, h: imgH, radius: 6, from: shadeColor(accent, -10), to: shadeColor(accent, 10) });
  els.push({ type: "rect", x: imgX, y: imgY, w: imgW, h: imgH, color: "#ffffff", strokeOnly: true, strokeWidth: 2 });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: w - w * 0.06, y: h * 0.05, text: content.badge, bg: accent, color: contrastColor(accent), align: "right" });
  }

  const padX = w * 0.08;
  let cursorY = imgY + imgH + h * 0.08;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: w - padX * 2, text: content.headline, size: w * 0.07, weight: 800, color: "#ffffff", align: "left", maxLines: 2, fontFamily: '"Courier New", monospace' });
  cursorY += w * 0.07 * 2.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: w - padX * 2, text: content.tagline, size: w * 0.03, weight: 500, color: "rgba(255,255,255,0.8)", align: "left", maxLines: 2, fontFamily: '"Courier New", monospace' });

  els.push({ type: "ctaPill", key: "cta", x: padX, y: h * 0.88, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.032 });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w - padX, y: h * 0.95, w: w * 0.5, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.6)", align: "right", maxLines: 1, fontFamily: '"Courier New", monospace' });
  }

  return els;
}

function speechBubble(ctx) {
  const { w, h, content, primary, accent } = ctx;
  const els = [];
  els.push(content.hasImage
    ? { type: "image", key: "image", x: 0, y: 0, w, h }
    : { type: "colorPanel", x: 0, y: 0, w, h, from: shadeColor(primary, -10), to: shadeColor(accent, -15) });
  ctx.injectDecor(els);
  els.push({ type: "rect", x: 0, y: 0, w, h, color: "rgba(0,0,0,0.25)" });

  const bubbleW = w * 0.82;
  const bubbleH = h * 0.34;
  const bubbleX = (w - bubbleW) / 2;
  const bubbleY = h * 0.12;

  els.push({ type: "rect", x: bubbleX, y: bubbleY, w: bubbleW, h: bubbleH, color: "#ffffff", radius: 28 });
  els.push({
    type: "polygon",
    color: "#ffffff",
    points: [
      [bubbleX + bubbleW * 0.2, bubbleY + bubbleH],
      [bubbleX + bubbleW * 0.32, bubbleY + bubbleH],
      [bubbleX + bubbleW * 0.16, bubbleY + bubbleH + h * 0.06],
    ],
  });

  if (content.badge) {
    els.push({ type: "badge", key: "badge", x: bubbleX + bubbleW - w * 0.02, y: bubbleY - h * 0.03, text: content.badge, bg: accent, color: contrastColor(accent), align: "right" });
  }

  const ink = "#141019";
  const padX = bubbleX + bubbleW * 0.08;
  let cursorY = bubbleY + bubbleH * 0.14;
  els.push({ type: "text", key: "headline", x: padX, y: cursorY, w: bubbleW * 0.84, text: content.headline, size: bubbleW * 0.1, weight: 800, color: ink, align: "left", maxLines: 2 });
  cursorY += bubbleW * 0.1 * 2.1;
  els.push({ type: "text", key: "tagline", x: padX, y: cursorY, w: bubbleW * 0.84, text: content.tagline, size: bubbleW * 0.045, weight: 500, color: withAlphaColor(ink, 0.75), align: "left", maxLines: 2 });

  els.push({ type: "ctaPill", key: "cta", x: w / 2, y: h * 0.86, text: content.cta, bg: accent, color: contrastColor(accent), size: w * 0.036, align: "center" });
  if (content.contact) {
    els.push({ type: "text", key: "contact", x: w / 2, y: h * 0.94, w: w * 0.7, text: content.contact, size: w * 0.022, weight: 600, color: "rgba(255,255,255,0.85)", align: "center", maxLines: 1 });
  }

  return els;
}

/* ---- Template registry ------------------------------------------------
 * 20 archetypes x 2 mirror states x 5 decoration styles = 200 templates.
 * -----------------------------------------------------------------*/

const LAYOUT_ARCHETYPES = [
  { id: "full-bleed-bottom-bar", label: "Full Bleed + Bottom Bar", fn: fullBleedBottomBar },
  { id: "split-panel", label: "Split Panel", fn: splitPanel },
  { id: "top-banner-info", label: "Top Banner + Info", fn: topBannerBottomInfo },
  { id: "framed-center", label: "Framed Center", fn: framedCenter },
  { id: "diagonal-slash", label: "Diagonal Slash", fn: diagonalSlash },
  { id: "color-block-grid", label: "Color Block Grid", fn: colorBlockGrid },
  { id: "ribbon-corner", label: "Ribbon Corner", fn: ribbonCorner },
  { id: "magazine-cover", label: "Magazine Cover", fn: magazineCover },
  { id: "ticket-stub", label: "Ticket Stub", fn: ticketStub },
  { id: "spotlight-vignette", label: "Spotlight Vignette", fn: spotlightVignette },
  { id: "wanted-poster", label: "Wanted Poster", fn: wantedPoster },
  { id: "vault-door", label: "Vault Door", fn: vaultDoor },
  { id: "detective-board", label: "Detective Board", fn: detectiveBoard },
  { id: "countdown-timer", label: "Countdown Timer", fn: countdownTimer },
  { id: "filmstrip", label: "Filmstrip", fn: filmstrip },
  { id: "comic-panels", label: "Comic Panels", fn: comicPanels },
  { id: "warning-tape", label: "Warning Tape", fn: warningTape },
  { id: "circular-medallion", label: "Circular Medallion", fn: circularMedallion },
  { id: "blueprint-grid", label: "Blueprint Grid", fn: blueprintGrid },
  { id: "speech-bubble", label: "Speech Bubble", fn: speechBubble },
];

const DECOR_STYLES = ["none", "circle", "stripe", "dots", "ribbon"];

const LAYOUT_TEMPLATES = [];
LAYOUT_ARCHETYPES.forEach((archetype) => {
  [false, true].forEach((flip) => {
    DECOR_STYLES.forEach((decor) => {
      LAYOUT_TEMPLATES.push({
        id: `${archetype.id}__flip-${flip ? 1 : 0}__decor-${decor}`,
        label: archetype.label,
        archetypeId: archetype.id,
        flip,
        decor,
        fn: archetype.fn,
      });
    });
  });
});

/* ---- Mirroring & overrides --------------------------------------------
 * Flip mirrors an already-built element list horizontally so every
 * archetype gets a left- and right-handed version for free. Overrides
 * apply a person's manual drag/resize edits on top of the algorithmic
 * position for a given element key.
 * -----------------------------------------------------------------*/

function flipElements(elements, w) {
  return elements.map((el) => {
    const copy = { ...el };
    switch (el.type) {
      case "rect":
      case "colorPanel":
      case "image":
        copy.x = w - el.x - el.w;
        break;
      case "circle":
        copy.x = w - el.x;
        break;
      case "text":
        copy.x = w - el.x;
        if (el.align === "right") copy.align = "left";
        else if (!el.align || el.align === "left") copy.align = "right";
        break;
      case "badge":
        copy.x = w - el.x;
        if (el.align === "center") copy.align = "center";
        else copy.align = el.align === "right" ? undefined : "right";
        break;
      case "ctaPill":
        copy.x = w - el.x;
        if (el.align === "center") copy.align = "center";
        else copy.align = el.align === "right" ? undefined : "right";
        break;
      case "polygon":
        copy.points = el.points.map(([px, py]) => [w - px, py]);
        break;
      case "vignette":
        copy.cx = w - el.cx;
        break;
      case "dashedLine":
        copy.x1 = w - el.x1;
        copy.x2 = w - el.x2;
        break;
      default:
        break;
    }
    if (copy.rotation) copy.rotation = -copy.rotation;
    if (copy.rotationCx !== undefined) copy.rotationCx = w - copy.rotationCx;
    return copy;
  });
}

function applyOverrides(elements, overrides) {
  if (!overrides) return elements;
  return elements.map((el) => {
    if (!el.key || !overrides[el.key]) return el;
    return { ...el, ...overrides[el.key] };
  });
}

function applyFocal(elements, focal) {
  if (!focal) return elements;
  return elements.map((el) => (el.key === "image" ? { ...el, focal } : el));
}

/**
 * templateIndex: 0..99, which template to render (see LAYOUT_TEMPLATES).
 * jitterSeed: drives the archetype's internal randomization (proportions,
 *   decoration placement) — same seed always reproduces the same result.
 * overrides: optional { [key]: {x?,y?,w?,h?} } from manual drag/resize.
 * focal: optional { x, y, zoom } (0..1 normalized image coords + zoom>=1)
 *   controlling which part of the uploaded photo shows inside its box.
 */
function generateLayout(templateIndex, jitterSeed, w, h, content, primary, accent, overrides, focal) {
  const count = LAYOUT_TEMPLATES.length;
  const index = ((Math.round(templateIndex) % count) + count) % count;
  const template = LAYOUT_TEMPLATES[index];
  const rand = mulberry32(jitterSeed >>> 0);

  const buildCtx = {
    w, h, rand, content, primary, accent,
    injectDecor: (els) => applyDecoration(els, template.decor, w, h, accent, rand),
  };

  let elements = template.fn(buildCtx);
  if (template.flip) elements = flipElements(elements, w);
  elements = applyOverrides(elements, overrides);
  elements = applyFocal(elements, focal);

  return { templateId: template.id, templateLabel: template.label, templateIndex: index, elements };
}
