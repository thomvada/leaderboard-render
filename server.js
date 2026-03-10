const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "5mb" }));

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fichier introuvable : " + url);
  return Buffer.from(await r.arrayBuffer());
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

// Convert PS unit value (string "2,853") into px using pxPerUnit
function psValueToPx(v, pxPerUnit) {
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return n * pxPerUnit;
}

// Draw baseline text (left/center) with absolute px coords
function drawTextBaseline(ctx, text, x, y, anchor = "baselineLeft") {
  const a = String(anchor || "baselineLeft").toLowerCase();
  ctx.textAlign = a.includes("center") ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(text), x, y);
}

app.post("/render", async (req, res) => {
  try {
    const payload = req.body?.json ?? req.body;
    const { rows, assets, layout } = payload || {};

    if (!rows || !Array.isArray(rows)) throw new Error("Payload invalide: rows manquant.");
    if (!assets?.background) throw new Error("Payload invalide: assets.background manquant.");
    if (!assets?.font) throw new Error("Payload invalide: assets.font manquant.");
    if (!layout?.bannerSlots || !layout?.amountSlots) throw new Error("Payload invalide: layout.bannerSlots/amountSlots manquants.");

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
    // PRELOAD FIRST BOX + CROWN
    // ======================
    let firstBoxImg = null;
    if (assets.firstBox && layout.firstBox) {
      firstBoxImg = await loadImage(await fetchBuffer(assets.firstBox));
    }

    let crownImg = null;
    if (assets.crown && layout.crown) {
      crownImg = await loadImage(await fetchBuffer(assets.crown));
    }

    const n = Math.min(
      5,
      rows.length,
      layout.bannerSlots.length,
      layout.amountSlots.length
    );

    const pxPerUnit = Number(layout?.coordSystem?.pxPerUnit) || 1;

    // ======================
    // 1) BANNIÈRES (fond) — TOP-LEFT PX
    // ======================
    for (let i = 0; i < n; i++) {
      const bannerImg = await loadImage(await fetchBuffer(rows[i].banner));
      const bs = layout.bannerSlots[i];
      drawImageAnchored(ctx, bannerImg, bs.x, bs.y, bs.anchor || "topleft");
    }

    // ======================
    // 2) TEXTES 2e → n (au-dessus des bannières)
    //    Baseline-left, coords PS -> px
    // ======================
    for (let i = 1; i < n; i++) {
      const fontPx = layout.text?.fontPxByRow?.[i] ?? 158;
      ctx.font = `${fontPx}px CustomFont`;
      ctx.fillStyle = layout.text?.colorNormal || "#FC2D35";

      const s = layout.amountSlots[i];
      const xPx = psValueToPx(s.x, pxPerUnit);
      const yPx = psValueToPx(s.y, pxPerUnit);

      drawTextBaseline(ctx, rows[i].amountText, xPx, yPx, s.anchor || "baselineLeft");
    }

    // ======================
    // 3) FIRST BOX (AU PREMIER PLAN, TOUJOURS)
    // ======================
    if (firstBoxImg && layout.firstBox) {
      const fb = layout.firstBox;
      drawImageAnchored(ctx, firstBoxImg, fb.x, fb.y, fb.anchor || "topleft");
    }

    // ======================
    // 4) TEXTE DU 1er (SEUL élément au-dessus du rectangle rouge)
    // ======================
    if (n >= 1) {
      const fontPx = layout.text?.fontPxByRow?.[0] ?? 158;
      ctx.font = `${fontPx}px CustomFont`;
      ctx.fillStyle = layout.text?.colorFirst || "#FFFFFF";

      const s0 = layout.amountSlots[0];
      const x0Px = psValueToPx(s0.x, pxPerUnit);
      const y0Px = psValueToPx(s0.y, pxPerUnit);

      drawTextBaseline(ctx, rows[0].amountText, x0Px, y0Px, s0.anchor || "baselineLeft");
    }

    // ======================
    // 5) FOOTER (baseline-center)
    // ======================
    if (layout.footerNumber && layout.footerNumber.text != null) {
      const f = layout.footerNumber;
      const fontPx = Number(f.fontPx) || 71;

      ctx.font = `${fontPx}px CustomFont`;
      ctx.fillStyle = f.color || "#FC2D35";

      const fxPx = psValueToPx(f.x, pxPerUnit);
      const fyPx = psValueToPx(f.y, pxPerUnit);

      drawTextBaseline(ctx, String(f.text), fxPx, fyPx, f.anchor || "baselineCenter");
    }

    // ======================
    // 6) CROWN (TOUT AU-DESSUS)
    // ======================
    if (crownImg && layout.crown) {
      const c = layout.crown;
      drawImageAnchored(ctx, crownImg, c.x, c.y, c.anchor || "topleft", c.w || null, c.h || null);
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
