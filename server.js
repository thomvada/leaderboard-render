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

function drawImageAnchored(ctx, img, x, y, anchor = "topleft", w = null, h = null) {
  const iw = w ?? img.width;
  const ih = h ?? img.height;

  let dx = x;
  let dy = y;

  if (anchor === "center") {
    dx = x - iw / 2;
    dy = y - ih / 2;
  }

  if (w && h) ctx.drawImage(img, dx, dy, w, h);
  else ctx.drawImage(img, dx, dy);
}

/**
 * Draw text with horizontal anchor only.
 * - slot.anchor can be: "left" | "center" | "right"
 * - Unknown values fall back to "center"
 * - y is used as TOP because ctx.textBaseline="top"
 */
function drawTextAnchored(ctx, text, slot) {
  const prevAlign = ctx.textAlign;

  const a = String(slot?.anchor || "center").toLowerCase();
  const textAlign = (a === "left" || a === "right" || a === "center") ? a : "center";

  ctx.textAlign = textAlign;
  ctx.fillText(String(text), slot.x, slot.y);

  ctx.textAlign = prevAlign;
}

app.post("/render", async (req, res) => {
  try {
    const payload = req.body.json ?? req.body;
    const { rows, assets, layout } = payload;

    if (!rows || !Array.isArray(rows)) throw new Error("Payload invalide: rows manquant.");
    if (!assets?.background) throw new Error("Payload invalide: assets.background manquant.");
    if (!assets?.font) throw new Error("Payload invalide: assets.font manquant.");
    if (!layout?.bannerSlots || !layout?.amountSlots) throw new Error("Payload invalide: layout.* manquant.");

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

    // Nous travaillons en TOP pour avoir un y stable
    ctx.textBaseline = "top";

    // ======================
    // PRELOAD FIRST BOX (si présent)
    // ======================
    let firstBoxImg = null;
    if (assets.firstBox && layout.firstBox) {
      firstBoxImg = await loadImage(await fetchBuffer(assets.firstBox));
    }

    // ======================
    // BANNIÈRES + 1st BOX + MONTANTS
    // ======================
    const n = Math.min(rows.length, 3); // si tu veux strict top3 côté render
    for (let i = 0; i < n; i++) {
      const row = rows[i];

      // Banner
      if (!row?.banner) throw new Error(`Banner manquante pour rows[${i}] (${row?.name || "?"})`);
      const banner = await loadImage(await fetchBuffer(row.banner));
      const bs = layout.bannerSlots[i];
      if (!bs) throw new Error(`layout.bannerSlots[${i}] manquant`);
      drawImageAnchored(ctx, banner, bs.x, bs.y, bs.anchor || "topleft");

      // First box (dessinée APRES la bannière, AVANT le texte)
      if (row.isFirst && firstBoxImg && layout.firstBox) {
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

      // Font size
      const fontPx =
        (layout.text?.fontPxByRow && layout.text.fontPxByRow[i])
          ? layout.text.fontPxByRow[i]
          : (layout.text?.fontPx || 120);

      ctx.font = `${fontPx}px CustomFont`;

      // Color
      ctx.fillStyle = row.isFirst
        ? (layout.text?.colorFirst || "#FFFFFF")
        : (layout.text?.colorNormal || "#FC2D35");

      // Amount
      const as = layout.amountSlots[i];
      if (!as) throw new Error(`layout.amountSlots[${i}] manquant`);
      drawTextAnchored(ctx, row.amountText, as);
    }

    // ======================
    // FOOTER NUMBER (STABLE)
    // ======================
    if (layout.footerNumber && layout.footerNumber.text != null) {
      const f = layout.footerNumber;

      ctx.font = `${f.fontPx}px CustomFont`;
      ctx.fillStyle = f.color || "#FC2D35";

      // centrage horizontal fiable
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // conversion centre Photoshop -> top Canvas
      const topY = f.y - (f.fontPx / 2);
      ctx.fillText(String(f.text), f.x, topY);

      // reset align pour éviter effets de bord
      ctx.textAlign = "start";
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
