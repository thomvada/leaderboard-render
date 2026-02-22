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

function drawText(ctx, text, x, y, align) {
  const m = ctx.measureText(text);
  if (align === "right") x -= m.width;
  if (align === "center") x -= m.width / 2;
  ctx.fillText(text, x, y);
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

    ctx.textBaseline = "top";

    // ======================
    // BANNIÈRES + MONTANTS
    // ======================
    for (let i = 0; i < rows.length; i++) {

      const banner = await loadImage(await fetchBuffer(rows[i].banner));
      const bs = layout.bannerSlots[i];
      drawImageAnchored(ctx, banner, bs.x, bs.y, bs.anchor || "topleft");

      if (rows[i].isFirst && assets.firstBox && layout.firstBox) {
        const firstBoxImg = await loadImage(await fetchBuffer(assets.firstBox));
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

      const fontPx =
        (layout.text.fontPxByRow && layout.text.fontPxByRow[i])
          ? layout.text.fontPxByRow[i]
          : layout.text.fontPx;

      ctx.font = fontPx + "px CustomFont";

      ctx.fillStyle = rows[i].isFirst
        ? layout.text.colorFirst
        : layout.text.colorNormal;

      drawText(
        ctx,
        rows[i].amountText,
        layout.amountSlots[i].x,
        layout.amountSlots[i].y,
        layout.amountSlots[i].anchor
      );
    }

    // ======================
    // FOOTER FORCÉ (IGNORER N8N)
    // ======================
    ctx.font = "71px CustomFont";
    ctx.fillStyle = "#FC2D35";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // POSITION FORCÉE
    ctx.fillText("7", 396.02, 1019.55);

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
