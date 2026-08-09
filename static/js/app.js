/*
 * App controller: wires the form to layout generation + canvas rendering,
 * and talks to the Flask API for image upload and save/load.
 */

const SELECTED_TEMPLATE_KEY = "doro:selectedTemplateIndex";

const canvas = document.getElementById("ad-canvas");
const canvasOverlay = document.getElementById("canvas-overlay");

const els = {
  headline: document.getElementById("input-headline"),
  tagline: document.getElementById("input-tagline"),
  badge: document.getElementById("input-badge"),
  cta: document.getElementById("input-cta"),
  contact: document.getElementById("input-contact"),
  primary: document.getElementById("input-color-primary"),
  accent: document.getElementById("input-color-accent"),
  size: document.getElementById("input-size"),
  imageInput: document.getElementById("input-image"),
  uploadDrop: document.getElementById("upload-drop"),
  uploadDropText: document.getElementById("upload-drop-text"),
  removeImageBtn: document.getElementById("btn-remove-image"),
  shuffleBtn: document.getElementById("btn-shuffle"),
  resetPositionsBtn: document.getElementById("btn-reset-positions"),
  layoutLabel: document.getElementById("layout-label"),
  saveBtn: document.getElementById("btn-save"),
  downloadBtn: document.getElementById("btn-download"),
  myDesignsBtn: document.getElementById("btn-my-designs"),
  modal: document.getElementById("modal-designs"),
  closeModalBtn: document.getElementById("btn-close-modal"),
  designsList: document.getElementById("designs-list"),
  toast: document.getElementById("toast"),
};

const state = {
  headline: els.headline.value,
  tagline: els.tagline.value,
  badge: els.badge.value,
  cta: els.cta.value,
  contact: els.contact.value,
  primary: els.primary.value,
  accent: els.accent.value,
  size: els.size.value,
  imageUrl: null,
  imageFocal: { x: 0.5, y: 0.5, zoom: 1 },
  templateIndex: Math.floor(Math.random() * LAYOUT_TEMPLATES.length),
  seed: Math.floor(Math.random() * 1e9),
  overrides: {},
};

const pickedFromGallery = localStorage.getItem(SELECTED_TEMPLATE_KEY);
if (pickedFromGallery !== null) {
  state.templateIndex = parseInt(pickedFromGallery, 10);
  localStorage.removeItem(SELECTED_TEMPLATE_KEY);
}

let currentDesignId = null;
let currentImage = null;
let currentLayoutElements = [];
let toastTimer = null;

const editor = setupCanvasEditor(canvas, canvasOverlay, {
  getElements: () => currentLayoutElements,
  onOverride: (key, patch) => {
    state.overrides[key] = { ...state.overrides[key], ...patch };
    render();
  },
  getFocal: () => state.imageFocal,
  onFocalChange: (patch) => {
    state.imageFocal = { ...state.imageFocal, ...patch };
    render();
  },
  getImageNaturalSize: () => (currentImage
    ? { width: currentImage.naturalWidth || currentImage.width, height: currentImage.naturalHeight || currentImage.height }
    : null),
});

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function currentContent() {
  return {
    headline: state.headline || "Your Escape Room",
    tagline: state.tagline || "",
    badge: state.badge || "",
    cta: state.cta || "",
    contact: state.contact || "",
    hasImage: Boolean(state.imageUrl && currentImage),
  };
}

function render() {
  const [w, h] = state.size.split("x").map(Number);
  canvas.width = w;
  canvas.height = h;

  const layout = generateLayout(state.templateIndex, state.seed, w, h, currentContent(), state.primary, state.accent, state.overrides, state.imageFocal);
  renderLayout(canvas, layout, currentImage);
  currentLayoutElements = layout.elements;
  state.templateIndex = layout.templateIndex;
  els.layoutLabel.textContent = `${layout.templateLabel} · #${layout.templateIndex + 1}`;
  editor.sync();
}

function bindTextInputs() {
  const map = [
    [els.headline, "headline"],
    [els.tagline, "tagline"],
    [els.badge, "badge"],
    [els.cta, "cta"],
    [els.contact, "contact"],
  ];
  map.forEach(([el, key]) => {
    el.addEventListener("input", () => {
      state[key] = el.value;
      render();
    });
  });

  els.primary.addEventListener("input", () => {
    state.primary = els.primary.value;
    render();
  });
  els.accent.addEventListener("input", () => {
    state.accent = els.accent.value;
    render();
  });
  els.size.addEventListener("change", () => {
    state.size = els.size.value;
    render();
  });
}

function bindImageUpload() {
  els.uploadDrop.addEventListener("click", (e) => {
    if (e.target !== els.removeImageBtn) els.imageInput.click();
  });

  els.imageInput.addEventListener("change", async () => {
    const file = els.imageInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    els.uploadDropText.textContent = "Uploading…";
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Upload failed");

      state.imageUrl = payload.url;
      state.imageFocal = { x: 0.5, y: 0.5, zoom: 1 };
      currentImage = await loadImage(payload.url);
      els.uploadDropText.textContent = "Change photo";
      els.removeImageBtn.hidden = false;
      render();
    } catch (err) {
      showToast(err.message || "Could not upload photo");
      els.uploadDropText.textContent = "Click to upload a photo";
    }
  });

  els.removeImageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.imageUrl = null;
    state.imageFocal = { x: 0.5, y: 0.5, zoom: 1 };
    currentImage = null;
    delete state.overrides.image;
    els.imageInput.value = "";
    els.uploadDropText.textContent = "Click to upload a photo";
    els.removeImageBtn.hidden = true;
    render();
  });
}

function bindShuffle() {
  els.shuffleBtn.addEventListener("click", () => {
    state.templateIndex = Math.floor(Math.random() * LAYOUT_TEMPLATES.length);
    state.seed = Math.floor(Math.random() * 1e9);
    state.overrides = {};
    render();
  });

  els.resetPositionsBtn.addEventListener("click", () => {
    state.overrides = {};
    state.imageFocal = { x: 0.5, y: 0.5, zoom: 1 };
    render();
    showToast("Positions reset");
  });
}

function bindDownload() {
  els.downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    const safeName = (state.headline || "escape-room-ad").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    link.download = `${safeName}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}

function makeThumbnail() {
  const thumbCanvas = document.createElement("canvas");
  const scale = 300 / canvas.width;
  thumbCanvas.width = 300;
  thumbCanvas.height = canvas.height * scale;
  thumbCanvas.getContext("2d").drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas.toDataURL("image/jpeg", 0.7);
}

function bindSave() {
  els.saveBtn.addEventListener("click", async () => {
    const defaultName = state.headline || "Untitled Design";
    const name = window.prompt("Name this design:", defaultName);
    if (name === null) return;

    const body = {
      name,
      data: state,
      thumbnail: makeThumbnail(),
    };

    try {
      let res;
      if (currentDesignId) {
        res = await fetch(`/api/designs/${currentDesignId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/designs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Save failed");
      if (payload.id) currentDesignId = payload.id;
      showToast("Design saved");
    } catch (err) {
      showToast(err.message || "Could not save design");
    }
  });
}

function applyLoadedDesign(design) {
  const data = design.data;
  Object.assign(state, data);
  state.overrides = data.overrides || {};

  els.headline.value = state.headline || "";
  els.tagline.value = state.tagline || "";
  els.badge.value = state.badge || "";
  els.cta.value = state.cta || "";
  els.contact.value = state.contact || "";
  els.primary.value = state.primary || "#1b1035";
  els.accent.value = state.accent || "#ff5722";
  els.size.value = state.size || "1080x1350";

  currentDesignId = design.id;

  if (state.imageUrl) {
    loadImage(state.imageUrl).then((img) => {
      currentImage = img;
      els.uploadDropText.textContent = "Change photo";
      els.removeImageBtn.hidden = false;
      render();
    });
  } else {
    currentImage = null;
    els.uploadDropText.textContent = "Click to upload a photo";
    els.removeImageBtn.hidden = true;
    render();
  }
}

async function openDesignsModal() {
  els.modal.hidden = false;
  els.designsList.innerHTML = "<p class='empty-state'>Loading…</p>";

  try {
    const res = await fetch("/api/designs");
    const designs = await res.json();

    if (designs.length === 0) {
      els.designsList.innerHTML = "<p class='empty-state'>No saved designs yet. Create one and hit Save!</p>";
      return;
    }

    els.designsList.innerHTML = "";
    designs.forEach((d) => {
      const card = document.createElement("div");
      card.className = "design-card";
      card.innerHTML = `
        <img src="${d.thumbnail || ""}" alt="${d.name}">
        <div class="design-card-body">
          <div class="design-card-name">${d.name}</div>
          <div class="design-card-date">${new Date(d.updated_at).toLocaleDateString()}</div>
          <button class="design-card-delete">Delete</button>
        </div>
      `;
      card.querySelector("img").addEventListener("click", async () => {
        const full = await fetch(`/api/designs/${d.id}`).then((r) => r.json());
        applyLoadedDesign(full);
        els.modal.hidden = true;
        showToast(`Loaded "${d.name}"`);
      });
      card.querySelector(".design-card-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
        await fetch(`/api/designs/${d.id}`, { method: "DELETE" });
        openDesignsModal();
      });
      els.designsList.appendChild(card);
    });
  } catch (err) {
    els.designsList.innerHTML = "<p class='empty-state'>Could not load designs.</p>";
  }
}

function bindModal() {
  els.myDesignsBtn.addEventListener("click", openDesignsModal);
  els.closeModalBtn.addEventListener("click", () => {
    els.modal.hidden = true;
  });
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) els.modal.hidden = true;
  });
}

function bindResize() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => editor.sync(), 80);
  });
}

bindTextInputs();
bindImageUpload();
bindShuffle();
bindDownload();
bindSave();
bindModal();
bindResize();
render();
