const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "5mb" }));

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable (URL) : " + url);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function drawText(ctx, text, x, y, align) {
  const m = ctx.measureText(text);
  if (align === "right") x -= m.width;
  if (align === "center") x -= m.width / 2;
  ctx.fillText(text, x, y);
}

// ✅ Nouvelle fonction : place une image selon un repère
function drawImageAnchored(ctx, img, x, y, anchor = "topleft", w = null, h = null) {
  const iw = w ?? img.width;
  const ih = h ?? img.height;

  let dx = x;
  let dy = y;

  if (anchor === "center") {
    dx = x - iw / 2;
    dy = y - ih / 2;
  } else if (anchor === "top") {
    dx = x - iw / 2;
  } else if (anchor === "left") {
    dy = y - ih / 2;
  }
  // default: "topleft" => rien

  if (w && h) ctx.drawImage(img, dx, dy, w, h);
  else ctx.drawImage(img, dx, dy);
}

app.post("/render", async (req, res) => {
  try {
    const { rows, assets, layout } = req.body;

    // Police
    const fontBuffer = await fetchBuffer(assets.font);
    const fontPath = "/tmp/font.ttf";
    fs.writeFileSync(fontPath, fontBuffer);
    registerFont(fontPath, { family: "CustomFont" });

    // Background => taille exacte
    const bg = await loadImage(await fetchBuffer(assets.background));
    const W = bg.width;
    const H = bg.height;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bg, 0, 0);

    // Texte: y = haut du texte (plus simple)
    ctx.textBaseline = "top";

    for (let i = 0; i < rows.length; i++) {
      // Bannière
      const banner = await loadImage(await fetchBuffer(rows[i].banner));
      const bs = layout.bannerSlots[i];
      drawImageAnchored(ctx, banner, bs.x, bs.y, bs.anchor || "topleft");

      // Rectangle 1st (uniquement pour le 1er)
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

      // Taille de police par ligne si fourni
      const fontPx =
        (layout.text.fontPxByRow && layout.text.fontPxByRow[i])
          ? layout.text.fontPxByRow[i]
          : layout.text.fontPx;

      ctx.font = fontPx + "px CustomFont";

      // Couleur texte
      ctx.fillStyle = rows[i].isFirst ? layout.text.colorFirst : layout.text.colorNormal;

      // Texte montant
      drawText(ctx, rows[i].amountText, layout.amountSlots[i].x, layout.amountSlots[i].y, layout.amountSlots[i].anchor);
    }

    const img = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(img);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/", (_, res) => res.send("OK"));

const port = process.env.PORT || 10000;
app.listen(port);
