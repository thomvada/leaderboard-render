const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "5mb" }));

// =============================
// UTILS
// =============================
async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable : " + url);
  return Buffer.from(await r.arrayBuffer());
}

async function loadImageFromUrl(url) {
  const buf = await fetchBuffer(url);
  return await loadImage(buf);
}

// Dessine image centrée
function drawImageCenter(ctx, img, cx, cy) {
  ctx.drawImage(img, cx - img.width / 2, cy - img.height / 2);
}

// Texte centré horizontal + vertical (FIABLE)
function drawTextCenter(ctx, text, cx, cy, fontPx) {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent || fontPx * 0.8;
  const descent = m.actualBoundingBoxDescent || fontPx * 0.2;

  const baselineY = cy + (ascent - descent) / 2;

  ctx.fillText(text, cx, baselineY);
}

// =============================
app.post("/render", async (req, res) => {
  try {
    const payload = req.body.json ?? req.body;
    const { rows, assets, layout } = payload;

    // FONT
    const fontBuffer = await fetchBuffer(assets.font);
    const fontPath = "/tmp/font.ttf";
    fs.writeFileSync(fontPath, fontBuffer);
    registerFont(fontPath, { family: "CustomFont" });

    // BACKGROUND
    const bg = await loadImageFromUrl(assets.background);
    const canvas = createCanvas(bg.width, bg.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(bg, 0, 0);

    const n = Math.min(3, rows.length);

    for (let i = 0; i < n; i++) {
      const row = rows[i];

      // FIRST BOX (uniquement slot 0)
      if (i === 0 && assets.firstBox) {
        const firstBoxImg = await loadImageFromUrl(assets.firstBox);
        drawImageCenter(ctx, firstBoxImg, layout.firstBox.x, layout.firstBox.y);
      }

      // BANNER
      const banner = await loadImageFromUrl(row.banner);
      const bs = layout.bannerSlots[i];
      drawImageCenter(ctx, banner, bs.x, bs.y);

      // TEXT
      ctx.font = `${layout.text.fontPx}px CustomFont`;
      ctx.fillStyle =
        i === 0 ? layout.text.colorFirst : layout.text.colorNormal;

      const as = layout.amountSlots[i];
      drawTextCenter(ctx, row.amountText, as.x, as.y, layout.text.fontPx);
    }

    // FOOTER
    if (layout.footer?.text) {
      ctx.font = `${layout.footer.fontPx}px CustomFont`;
      ctx.fillStyle = layout.footer.color;
      drawTextCenter(
        ctx,
        layout.footer.text,
        layout.footer.x,
        layout.footer.y,
        layout.footer.fontPx
      );
    }

    const img = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.status(200).send(img);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 10000);
