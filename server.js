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

app.post("/render", async (req, res) => {
  try {
    const { rows, assets, layout } = req.body;

    // Police
    const fontBuffer = await fetchBuffer(assets.font);
    const fontPath = "/tmp/font.ttf";
    fs.writeFileSync(fontPath, fontBuffer);
    registerFont(fontPath, { family: "CustomFont" });

    // Background => taille exacte (plus d'image coupée)
    const bg = await loadImage(await fetchBuffer(assets.background));
    const W = bg.width;
    const H = bg.height;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bg, 0, 0);

    // IMPORTANT: y = haut du texte (coordonnées plus intuitives)
    ctx.font = layout.text.fontPx + "px CustomFont";
    ctx.textBaseline = "top";

    for (let i = 0; i < rows.length; i++) {
      // Bannière
      const banner = await loadImage(await fetchBuffer(rows[i].banner));
      ctx.drawImage(banner, layout.bannerSlots[i].x, layout.bannerSlots[i].y);

      // Rectangle 1st derrière le texte du 1er
      if (rows[i].isFirst && assets.firstBox) {
        const firstBox = await loadImage(await fetchBuffer(assets.firstBox));
        const fb = layout.firstBox || {};
        const boxX = layout.amountSlots[i].x + (fb.offsetX || 0);
        const boxY = layout.amountSlots[i].y + (fb.offsetY || 0);

        if (fb.w && fb.h) ctx.drawImage(firstBox, boxX, boxY, fb.w, fb.h);
        else ctx.drawImage(firstBox, boxX, boxY);
      }

      // Couleur texte
      ctx.fillStyle = rows[i].isFirst ? layout.text.colorFirst : layout.text.colorNormal;

      // Texte
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
