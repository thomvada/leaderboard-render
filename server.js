const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "5mb" }));

// ---------------------------
// Simple caches (perf + stabilité)
// ---------------------------
const bufferCache = new Map(); // url -> Buffer
const imageCache = new Map(); // url -> Image
let registeredFontKey = null;

async function fetchBuffer(url) {
  if (!url) throw new Error("URL manquante");
  if (bufferCache.has(url)) return bufferCache.get(url);

  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable : " + url);

  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  bufferCache.set(url, buf);
  return buf;
}

async function loadImageFromUrl(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const buf = await fetchBuffer(url);
  const img = await loadImage(buf);
  imageCache.set(url, img);
  return img;
}

async function ensureFontRegistered(fontUrl) {
  // Re-register uniquement si l’URL change
  if (registeredFontKey === fontUrl) return;

  const fontBuffer = await fetchBuffer(fontUrl);
  const fontPath = "/tmp/font.ttf";
  fs.writeFileSync(fontPath, fontBuffer);
  registerFont(fontPath, { family: "CustomFont" });

  registeredFontKey = fontUrl;
}

// ---------------------------
// Image anchor (center/topleft)
// ---------------------------
function drawImageAnchored(ctx, img, x, y, anchor = "topleft", w = null, h = null) {
  const iw = w ?? img.width;
  const ih = h ?? img.height;

  let dx = x;
  let dy = y;

  if (String(anchor).toLowerCase() === "center") {
    dx = x - iw / 2;
    dy = y - ih / 2;
  }

  if (w && h) ctx.drawImage(img, dx, dy, w, h);
  else ctx.drawImage(img, dx, dy);
}

// ---------------------------
// Text CENTER (fiable) via metrics
// - (cx,cy) = centre visuel du texte
// - fallback si metrics indisponibles
// ---------------------------
function fillTextCentered(ctx, text, cx, cy, fontPxFallback = 0) {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const t = String(text);
  const m = ctx.measureText(t);

  const ascent = m.actualBoundingBoxAscent ?? 0;
  const descent = m.actualBoundingBoxDescent ?? 0;

  if (ascent > 0 || descent > 0) {
    const baselineY = cy + (ascent - descent) / 2;
    ctx.fillText(t, cx, baselineY);
    return;
  }

  // Fallback propre si la police ne renvoie pas de bounding boxes
  // approx: baseline ~ cy + fontPx*0.35 (empirique mais stable)
  const fp = Number(fontPxFallback) || 0;
  const baselineY = cy + fp * 0.35;
  ctx.fillText(t, cx, baselineY);
}

// ---------------------------
// Optional debug visuals
// ---------------------------
function drawDebugCross(ctx, x, y, size = 10) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

app.post("/render", async (req, res) => {
  try {
    const payload = req.body?.json ?? req.body;
    const { rows, assets, layout } = payload || {};

    if (!rows || !Array.isArray(rows)) throw new Error("Payload invalide: rows manquant.");
    if (!assets?.background) throw new Error("Payload invalide: assets.background manquant.");
    if (!assets?.font) throw new Error("Payload invalide: assets.font manquant.");
    if (!layout?.bannerSlots || !layout?.amountSlots) throw new Error("Payload invalide: layout.bannerSlots/amountSlots manquants.");

    // Font
    await ensureFontRegistered(assets.font);

    // Background
    const bg = await loadImageFromUrl(assets.background);
    const W = bg.width;
    const H = bg.height;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(bg, 0, 0);

    // Preload firstBox if any
    let firstBoxImg = null;
    if (assets.firstBox && layout.firstBox) {
      firstBoxImg = await loadImageFromUrl(assets.firstBox);
    }

    const n = Math.min(
      3,
      rows.length,
      layout.bannerSlots.length,
      layout.amountSlots.length
    );

    const debugEnabled = Boolean(layout.debug?.enabled);

    for (let i = 0; i < n; i++) {
      const row = rows[i];
      const bs = layout.bannerSlots[i];
      const as = layout.amountSlots[i];

      if (!row?.banner) throw new Error(`Banner manquante pour rows[${i}] (${row?.name || "?"})`);
      if (!bs) throw new Error(`layout.bannerSlots[${i}] manquant`);
      if (!as) throw new Error(`layout.amountSlots[${i}] manquant`);

      // 1) First box (derrière le 1er) — couche standard
      if (row.isFirst && firstBoxImg && layout.firstBox) {
        const fb = layout.firstBox;
        const layer = String(fb.layer || "belowBanner").toLowerCase();

        if (layer === "belowbanner" || layer === "below_banner") {
          drawImageAnchored(ctx, firstBoxImg, fb.x, fb.y, fb.anchor || "topleft", fb.w || null, fb.h || null);
        }
      }

      // 2) Banner
      const bannerImg = await loadImageFromUrl(row.banner);
      drawImageAnchored(ctx, bannerImg, bs.x, bs.y, bs.anchor || "topleft");

      // 3) First box alternative (au-dessus de la bannière) si tu veux
      if (row.isFirst && firstBoxImg && layout.firstBox) {
        const fb = layout.firstBox;
        const layer = String(fb.layer || "belowBanner").toLowerCase();

        if (layer === "abovebanner" || layer === "above_banner") {
          drawImageAnchored(ctx, firstBoxImg, fb.x, fb.y, fb.anchor || "topleft", fb.w || null, fb.h || null);
        }
      }

      // 4) Amount text — CENTER fiable
      const fontPx =
        (layout.text?.fontPxByRow && layout.text.fontPxByRow[i])
          ? layout.text.fontPxByRow[i]
          : (layout.text?.fontPx || 120);

      ctx.font = `${fontPx}px CustomFont`;
      ctx.fillStyle = row.isFirst
        ? (layout.text?.colorFirst || "#FFFFFF")
        : (layout.text?.colorNormal || "#FC2D35");

      fillTextCentered(ctx, row.amountText, as.x, as.y, fontPx);

      // Debug
      if (debugEnabled) {
        ctx.save();
        ctx.strokeStyle = "#00FF00";
        drawDebugCross(ctx, bs.x, bs.y, 12);
        ctx.strokeStyle = "#FF00FF";
        drawDebugCross(ctx, as.x, as.y, 12);
        ctx.restore();
      }
    }

    // Footer number — CENTER fiable
    if (layout.footerNumber && layout.footerNumber.text != null) {
      const f = layout.footerNumber;
      const fp = Number(f.fontPx) || 60;

      ctx.font = `${fp}px CustomFont`;
      ctx.fillStyle = f.color || "#FC2D35";

      fillTextCentered(ctx, String(f.text), f.x, f.y, fp);

      if (debugEnabled) {
        ctx.save();
        ctx.strokeStyle = "#00FFFF";
        drawDebugCross(ctx, f.x, f.y, 12);
        ctx.restore();
      }
    }

    // Export PNG
    const img = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(img);

  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(process.env.PORT || 10000);
