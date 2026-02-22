import express from "express";
import { createCanvas, loadImage, registerFont } from "canvas";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "5mb" }));

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable (URL) : " + url);
  return Buffer.from(await r.arrayBuffer());
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

    // Charger la police (fichier .ttf)
    const fontBuffer = await fetchBuffer(assets.font);
    const fs = await import("fs");
    const fontPath = "/tmp/font.ttf";
    fs.writeFileSync(fontPath, fontBuffer);
    registerFont(fontPath, { family: "CustomFont" });

    // Fond (on le charge AVANT pour prendre sa taille exacte)
    const bg = await loadImage(await fetchBuffer(assets.background));

    // Canvas = taille exacte du background (plus jamais d'image coupée)
    const W = bg.width;
    const H = bg.height;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Dessiner le background tel quel
    ctx.drawImage(bg, 0, 0);

    // Réglages texte
    ctx.font = layout.text.fontPx + "px CustomFont";
    ctx.textBaseline = "alphabetic";

    // 3 lignes : bannière + montant
    for (let i = 0; i < rows.length; i++) {
      // bannière
      const banner = await loadImage(await fetchBuffer(rows[i].banner));
      ctx.drawImage(banner, layout.bannerSlots[i].x, layout.bannerSlots[i].y);

      // bloc 1st derrière le texte du 1er
      if (rows[i].isFirst && assets.firstBox) {
        const firstBox = await loadImage(await fetchBuffer(assets.firstBox));
        const fb = layout.firstBox;
        ctx.drawImage(
          firstBox,
          layout.amountSlots[i].x + fb.offsetX,
          layout.amountSlots[i].y + fb.offsetY,
          fb.w,
          fb.h
        );
      }

      // couleur du texte
      ctx.fillStyle = rows[i].isFirst ? layout.text.colorFirst : layout.text.colorNormal;

      // texte montant
      drawText(
        ctx,
        rows[i].amountText,
        layout.amountSlots[i].x,
        layout.amountSlots[i].y,
        layout.amountSlots[i].anchor
      );
    }

    // renvoyer l'image
    const img = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.send(img);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (_, res) => res.send("OK"));

const port = process.env.PORT || 10000;
app.listen(port);
