// =============================
// GitHub / Server — index.js (ENTIER) — À JOUR
// =============================
const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "5mb" }));

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable : " + url);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// Image anchored (topleft/center)
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

// Text: reliable center (horizontal + vertical) using metrics
function drawTextCentered(ctx, text, cx, cy, fontPxFallback = 0) {
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

  // fallback if metrics are unavailable
  const fp = Number(fontPxFallback) || 0;
  const baselineY = cy + fp * 0.35;
  ctx.fillText(t, cx, baselineY);
}

// Text: anchored horizontally only (left/center/right) at y (top)
function drawTextTop(ctx, text, x, y, anchor = "left") {
  const a = String(anchor || "left").toLowerCase();
  ctx.textAlign = (a === "center" || a === "right") ? a : "left";
  ctx.textBaseline = "top";
  ctx.fillText(String(text), x, y);
}

app.post("/render", async (req, res) => {
  try {
    const payload = req.body.json ?? req.body;
    const { rows, assets, layout } = payload;

    // ======================
    // POLICE
    // ======================
    const fontBuffer = await fetchBuffer(assets.font);
    const fontPath = "/tmp/font.ttf";
    fs.writeFileSync(fontPath, fontBuffer);
    registerFont(fontPath, { family: "CustomFont" });

    // ======================
    // BACKGROUND
    // ======================
    const bg = await loadImage(await fetchBuffer(assets.background));
    const W = bg.width;
    const H = bg.height;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(bg, 0, 0);

    // ======================
    // PRELOAD FIRST BOX (toujours, fixe)
    // ======================
    let firstBoxImg = null;
    if (assets.firstBox && layout.firstBox) {
      firstBoxImg = await loadImage(await fetchBuffer(assets.firstBox));
    }

    // ======================
    // 1) BANNIÈRES (BEHIND EVERYTHING)
    // ======================
    const n = Math.min(
      3,
      rows.length,
      layout.bannerSlots.length,
      layout.amountSlots.length
    );

    for (let i = 0; i < n; i++) {
      const bannerImg = await loadImage(await fetchBuffer(rows[i].banner));
      const bs = layout.bannerSlots[i];
      drawImageAnchored(ctx, bannerImg, bs.x, bs.y, bs.anchor || "topleft");
    }

    // ======================
    // 2) FIRST BOX (FIXE, AU PREMIER PLAN)
    //    Rien au-dessus sauf le texte du 1er
    // ======================
    if (firstBoxImg && layout.firstBox) {
      const fb = layout.firstBox;
      drawImageAnchored(
        ctx,
        firstBoxImg,
        fb.x,
        fb.y,
        fb.anchor || "topleft",
        fb.w || null,
        fb.h || null
      );
    }

    // ======================
    // 3) MONTANTS
    //    - texte du 1er au-dessus du rectangle rouge
    //    - textes 2e/3e au-dessus de tout aussi (OK)
    // ======================
    for (let i = 0; i < n; i++) {
      const fontPx =
        (layout.text.fontPxByRow && layout.text.fontPxByRow[i])
          ? layout.text.fontPxByRow[i]
          : layout.text.fontPx;

      ctx.font = `${fontPx}px CustomFont`;
      ctx.fillStyle = (i === 0)
        ? layout.text.colorFirst
        : layout.text.colorNormal;

      const slot = layout.amountSlots[i];

      // Tu as donné des coords "texte" fixes.
      // On les traite comme un POINT-CENTRE du texte.
      if (String(slot.anchor).toLowerCase() === "center") {
        drawTextCentered(ctx, rows[i].amountText, slot.x, slot.y, fontPx);
      } else {
        // fallback
        drawTextTop(ctx, rows[i].amountText, slot.x, slot.y, slot.anchor);
      }
    }

    // ======================
    // 4) FOOTER NUMBER (centre)
    // ======================
    if (layout.footerNumber && layout.footerNumber.text != null) {
      const f = layout.footerNumber;
      ctx.font = `${f.fontPx}px CustomFont`;
      ctx.fillStyle = f.color || "#FC2D35";

      // footer coords = centre du texte
      drawTextCentered(ctx, String(f.text), f.x, f.y, f.fontPx);
    }

    // ======================
    // EXPORT
    // ======================
    const img = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(img);

  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(process.env.PORT || 10000);
