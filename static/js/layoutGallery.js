/*
 * Renders a static thumbnail for all 100 layout templates so a person can
 * see every option and pick one, instead of only stumbling onto layouts
 * one shuffle at a time.
 */

const GALLERY_DEMO_CONTENT = {
  headline: "The Lost Vault",
  tagline: "Can you escape in 60 minutes?",
  badge: "NEW ROOM",
  cta: "BOOK NOW",
  contact: "www.lostvaultescapes.com",
  hasImage: false,
};

const GALLERY_PRIMARY = "#1b1035";
const GALLERY_ACCENT = "#ff5722";
const GALLERY_THUMB_W = 260;
const GALLERY_THUMB_H = 325;
const SELECTED_TEMPLATE_KEY = "doro:selectedTemplateIndex";

function buildGallery() {
  const grid = document.getElementById("gallery-grid");
  const fragment = document.createDocumentFragment();

  LAYOUT_TEMPLATES.forEach((template, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";

    const canvas = document.createElement("canvas");
    canvas.width = GALLERY_THUMB_W;
    canvas.height = GALLERY_THUMB_H;

    const layout = generateLayout(index, 42, GALLERY_THUMB_W, GALLERY_THUMB_H, GALLERY_DEMO_CONTENT, GALLERY_PRIMARY, GALLERY_ACCENT);
    renderLayout(canvas, layout, null);

    const label = document.createElement("div");
    label.className = "gallery-card-label";
    label.textContent = `#${index + 1} · ${template.label}`;

    card.appendChild(canvas);
    card.appendChild(label);
    card.addEventListener("click", () => {
      localStorage.setItem(SELECTED_TEMPLATE_KEY, String(index));
      window.location.href = "/";
    });

    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
}

buildGallery();
