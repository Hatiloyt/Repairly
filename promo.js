(() => {
  const canvas = document.getElementById("promo-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const DURATION = 24;
  const $ = (id) => document.getElementById(id);
  const playButton = $("promo-play");
  const restartButton = $("promo-restart");
  const downloadButton = $("promo-download");
  const caption = $("promo-caption");
  const runtime = $("promo-runtime");
  const status = $("promo-status");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const scenes = {
    de: [
      { kicker: "01 / DEINE GARAGE", title: ["Dein Auto.", "Dein Motorrad."], sub: "Fahrzeuge eintragen. Passende Reparaturen entdecken.", caption: "Speichere Auto und Motorrad in deiner persönlichen Garage." },
      { kicker: "02 / DEIN FEED", title: ["Die passende", "Anleitung finden."], sub: "Dein Feed sortiert Reparaturen nach deinen Fahrzeugen.", caption: "Repairly empfiehlt Anleitungen, die zu deinen Fahrzeugen passen." },
      { kicker: "03 / COMMUNITY", title: ["Wissen teilen", "hilft allen."], sub: "Erstelle klare Schritte, kommentiere und lerne von anderen.", caption: "Teile Reparaturen und tausche hilfreiche Tipps aus." },
      { kicker: "04 / GEMEINSAM GEPRÜFT", title: ["Zusammen wird", "gutes Wissen sichtbar."], sub: "Bestätige erfolgreiche Reparaturen aus der Community.", caption: "Zehn erfolgreiche Bestätigungen machen eine Anleitung verifiziert." },
    ],
    en: [
      { kicker: "01 / YOUR GARAGE", title: ["Your car.", "Your motorcycle."], sub: "Add your vehicles. Discover repairs that fit.", caption: "Save your car and motorcycle in your personal garage." },
      { kicker: "02 / YOUR FEED", title: ["Find the right", "repair guide."], sub: "Your feed ranks repairs for your vehicles.", caption: "Repairly recommends guides that match your vehicles." },
      { kicker: "03 / COMMUNITY", title: ["Sharing know-how", "helps everyone."], sub: "Write clear steps, comment, and learn from others.", caption: "Share repairs and exchange helpful tips." },
      { kicker: "04 / VERIFIED TOGETHER", title: ["Good know-how", "moves us forward."], sub: "Confirm repairs that worked for the community.", caption: "Ten successful confirmations earn a community verified badge." },
    ],
  };

  const palette = {
    bg: "#101713", bg2: "#17221c", ink: "#f2f0dd", muted: "#aab1a0", green: "#b8eb81",
    green2: "#80b85f", deep: "#293d2f", yellow: "#f0ca72", orange: "#df895d", blue: "#7c9ba1",
    panel: "#202b24", line: "rgba(237, 239, 216, .16)", shadow: "rgba(0,0,0,.25)",
  };

  let elapsed = 0;
  let lastFrame = 0;
  let playing = !reducedMotion;
  let recording = false;
  let recorder = null;
  let lastScene = -1;
  let lastRuntimeSecond = -1;

  function language() {
    return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "de";
  }
  function copy(key) { return scenes[language()][key]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
  function ease(t) { t = clamp(t); return t * t * (3 - 2 * t); }
  function polygon(points, fill, stroke = null, width = 1) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function line(x1, y1, x2, y2, color, width = 1, dash = []) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function circle(x, y, radius, fill, stroke = null, width = 1) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function roundedRect(x, y, w, h, r, fill, stroke = null) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function text(value, x, y, size, color, weight = 500, font = "Inter, ui-sans-serif, system-ui, sans-serif") {
    ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function centeredText(value, x, y, size, color, weight = 600) {
    ctx.font = `${weight} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = "center"; ctx.fillText(value, x, y); ctx.textAlign = "left";
  }
  function formatTime(seconds) {
    const v = Math.max(0, Math.floor(seconds));
    return `00:${String(v).padStart(2, "0")}`;
  }

  function drawBackdrop(t, sceneIndex) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette.bg); g.addColorStop(.58, palette.bg2); g.addColorStop(1, "#111813");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Angular workshop roof and distant hills establish the low-poly world.
    polygon([[0, 0], [475, 0], [350, 167], [0, 210]], "#1c2921");
    polygon([[0, 210], [350, 167], [545, 334], [0, 468]], "#202d24");
    polygon([[W, 0], [W, 215], [894, 157], [1000, 0]], "#19241d");
    polygon([[W, 215], [W, 452], [880, 325], [894, 157]], "#202b23");
    polygon([[0, 469], [545, 334], [795, 455], [W, 363], [W, H], [0, H]], "#243029");
    polygon([[0, 605], [478, 407], [720, 491], [378, H], [0, H]], "#27352b");
    polygon([[W, 487], [885, 414], [670, H], [W, H]], "#1c2921");
    // Floor perspective lines.
    for (let i = 0; i < 9; i += 1) {
      const x = i * 172 - 330 + ((t * 18) % 172);
      line(640, 389, x, 720, "rgba(190, 211, 174, .085)", 1);
    }
    for (let i = 0; i < 5; i += 1) {
      const y = 432 + i * 61 + ((t * 7) % 61);
      line(0, y, W, y + (y - 430) * .12, "rgba(190, 211, 174, .06)", 1);
    }
    // Workshop lights.
    for (let i = 0; i < 4; i += 1) {
      const x = 195 + i * 300;
      polygon([[x, 85], [x + 108, 80], [x + 152, 88], [x + 43, 96]], "rgba(218, 235, 188, .3)");
      polygon([[x + 22, 97], [x + 137, 94], [x + 198, 278], [x + 66, 248]], "rgba(184, 235, 129, .035)");
    }
    // Small drifting polygon glints.
    for (let i = 0; i < 16; i += 1) {
      const x = (i * 197 + Math.sin(t * .28 + i) * 32 + 40) % W;
      const y = (i * 89 + t * (7 + i % 3) + 38) % 450;
      const r = 2 + (i % 3);
      polygon([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], `rgba(184,235,129,${.17 + .07 * Math.sin(t + i)})`);
    }
    // Subtle side index makes the visual feel like a designed campaign.
    text(`REPAIRLY   /   ${String(sceneIndex + 1).padStart(2, "0")}`, 76, 671, 10, "rgba(235,239,219,.45)", 700, "ui-monospace, SFMono-Regular, monospace");
  }

  function drawWheel(cx, cy, r, t, color = "#18201b") {
    circle(cx + 5, cy + 5, r + 2, "rgba(0,0,0,.22)");
    circle(cx, cy, r, color);
    circle(cx, cy, r * .68, "#829181");
    circle(cx, cy, r * .48, "#bdc3ae");
    circle(cx, cy, r * .17, "#526355");
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 1.6);
    for (let i = 0; i < 6; i += 1) {
      ctx.rotate(Math.PI / 3); line(0, 0, 0, r * .63, "#596a5c", 2);
    }
    ctx.restore();
    circle(cx - r * .24, cy - r * .25, r * .13, "rgba(255,255,255,.17)");
  }

  function drawCar(x, y, scale, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    // Ground shadow and angular chassis.
    ctx.beginPath(); ctx.ellipse(271, 250, 248, 32, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,.26)"; ctx.fill();
    drawWheel(125, 219, 51, t); drawWheel(410, 219, 51, t + .4);
    polygon([[31, 193], [50, 150], [108, 135], [172, 79], [323, 67], [381, 114], [456, 132], [494, 177], [491, 215], [454, 226], [76, 226], [34, 214]], "#73965f");
    polygon([[51, 152], [111, 140], [171, 89], [240, 86], [240, 156]], "#a1c37b");
    polygon([[250, 86], [315, 75], [365, 119], [376, 151], [250, 156]], "#55794d");
    polygon([[109, 140], [172, 94], [236, 92], [236, 155]], "#263d32");
    polygon([[253, 92], [312, 82], [354, 121], [365, 151], [253, 155]], "#314d3b");
    polygon([[47, 155], [101, 143], [96, 192], [34, 193]], "#91b474");
    polygon([[110, 160], [382, 158], [450, 167], [474, 186], [420, 192], [69, 192]], "#9fc677");
    polygon([[252, 157], [379, 158], [391, 193], [253, 193]], "#86ab69");
    polygon([[31, 191], [82, 186], [79, 206], [36, 210]], "#d5d0ac");
    polygon([[449, 159], [480, 169], [492, 186], [456, 187]], "#ecd58e");
    polygon([[187, 164], [221, 164], [222, 179], [180, 179]], "#455d46");
    line(70, 198, 462, 198, "rgba(25,37,29,.55)", 3);
    polygon([[171, 89], [240, 86], [240, 92], [171, 95]], "rgba(240,239,221,.72)");
    polygon([[253, 92], [312, 82], [318, 88], [253, 98]], "rgba(240,239,221,.62)");
    ctx.restore();
  }

  function drawMotorcycle(x, y, scale, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.ellipse(157, 181, 157, 22, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fill();
    const wheel = (cx) => {
      circle(cx, 143, 53, "#17201b"); circle(cx, 143, 43, "#919b87"); circle(cx, 143, 35, "#29382d");
      for (let i = 0; i < 8; i += 1) { const a = i * Math.PI / 4 + t * .7; line(cx, 143, cx + Math.cos(a) * 38, 143 + Math.sin(a) * 38, "#b9c1a7", 1.5); }
      circle(cx, 143, 8, "#d2d0b5");
    };
    wheel(58); wheel(254);
    polygon([[57, 142], [96, 93], [147, 106], [203, 106], [250, 140], [236, 149], [190, 126], [128, 124], [71, 153]], "#8cb96a");
    polygon([[105, 101], [119, 70], [165, 58], [207, 75], [204, 110], [166, 123], [125, 118]], "#c5df84");
    polygon([[121, 75], [163, 64], [197, 79], [189, 103], [151, 111], [125, 101]], "#526f47");
    polygon([[87, 85], [121, 71], [134, 81], [111, 93], [80, 97]], "#262e27");
    polygon([[207, 72], [227, 54], [249, 58], [230, 78]], "#a8c777");
    line(218, 70, 248, 128, "#bbc8ae", 7); line(121, 110, 74, 145, "#7b8c7b", 6);
    polygon([[137, 112], [181, 114], [195, 130], [144, 132]], "#667564");
    polygon([[137, 105], [180, 108], [171, 116], [135, 114]], "#212a23");
    circle(245, 125, 9, "#d8d1a2"); line(106, 89, 83, 71, "#9ea994", 4);
    line(218, 56, 250, 47, "#aeb8a4", 3);
    ctx.restore();
  }

  function drawGarageScene(t, progress) {
    const slide = 1 - ease(progress * 1.45);
    ctx.save(); ctx.translate(-slide * 120, 0);
    drawCar(39, 345 + Math.sin(t * 1.1) * 3, 1.02, t);
    drawMotorcycle(760, 417 + Math.sin(t * 1.4 + 1) * 3, .92, t);
    ctx.restore();
    const cardY = 482 + (1 - ease(progress * 1.7)) * 50;
    roundedRect(77, cardY, 407, 82, 4, "rgba(22,31,25,.95)", "rgba(224,236,206,.21)");
    polygon([[96, cardY + 20], [119, cardY + 11], [144, cardY + 19], [145, cardY + 40], [96, cardY + 40]], "#749c5d");
    polygon([[101, cardY + 22], [119, cardY + 15], [139, cardY + 22], [137, cardY + 31], [104, cardY + 31]], "#b9d595");
    text(language() === "de" ? "MEINE GARAGE" : "MY GARAGE", 163, cardY + 26, 10, palette.green, 750);
    text("VOLKSWAGEN GOLF VII", 163, cardY + 48, 13, palette.ink, 700);
    roundedRect(326, cardY + 17, 137, 48, 3, "#253429");
    polygon([[337, cardY + 42], [346, cardY + 31], [359, cardY + 30], [370, cardY + 38], [370, cardY + 44]], "#94b972");
    circle(347, cardY + 44, 4, "#17201b"); circle(364, cardY + 44, 4, "#17201b");
    text("YAMAHA MT-07", 377, cardY + 45, 9, palette.ink, 700);
  }

  function drawGuideCard(x, y, scale, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    roundedRect(0, 0, 353, 264, 6, "#eef0de", "rgba(255,255,255,.6)");
    polygon([[0, 0], [353, 0], [353, 116], [0, 97]], "#769564");
    polygon([[0, 74], [106, 31], [202, 106], [130, 122]], "#91ac70");
    polygon([[106, 31], [213, 14], [353, 80], [202, 106]], "#55754f");
    polygon([[202, 106], [353, 80], [353, 116], [0, 97]], "#374f3d");
    // Filter illustration.
    ctx.save(); ctx.translate(245, 53); ctx.rotate(-.15 + Math.sin(t * 1.4) * .025);
    polygon([[-19, -28], [18, -32], [40, -14], [36, 26], [4, 36], [-27, 18]], "#e7e7d1");
    for (let i = -18; i <= 18; i += 9) line(i, -24, i + 6, 24, "#b7bea9", 2);
    ctx.restore();
    text(language() === "de" ? "WARTUNG" : "MAINTENANCE", 22, 131, 9, "#5c7950", 800);
    text(language() === "de" ? "Innenraumfilter wechseln" : "Replace cabin air filter", 22, 157, 17, "#1a251e", 730);
    text("VOLKSWAGEN GOLF VII  ·  25 MIN", 22, 179, 9, "#667066", 700);
    line(22, 196, 330, 196, "#d7dacb", 1);
    for (let i = 0; i < 3; i += 1) {
      circle(31, 217 + i * 18, 3.5, i < 2 ? "#83a469" : "#c5cbbb");
      roundedRect(43, 214 + i * 18, 154 - i * 12, 5, 2, i < 2 ? "#aeb6a3" : "#d1d5c8");
    }
    roundedRect(239, 208, 91, 35, 3, "#dce7ce");
    text("9.8", 254, 231, 15, "#375137", 760); text("/ 10", 286, 231, 8, "#64725f", 600);
    ctx.restore();
  }

  function drawFeedScene(t, progress) {
    // Vehicle match tokens.
    roundedRect(726, 94, 184, 38, 19, "rgba(29,43,33,.92)", "rgba(184,235,129,.35)");
    circle(746, 113, 5, palette.green); text(language() === "de" ? "FÜR DEINEN GOLF VII" : "FOR YOUR GOLF VII", 760, 117, 9, palette.ink, 700);
    drawGuideCard(777 + (1 - ease(progress)) * 120, 195 + Math.sin(t * .85) * 5, .93, t);
    // Floating match check.
    const bob = Math.sin(t * 2) * 7;
    circle(1126, 234 + bob, 39, "#b8eb81");
    line(1109, 234 + bob, 1121, 246 + bob, "#253528", 5);
    line(1121, 246 + bob, 1145, 218 + bob, "#253528", 5);
    roundedRect(1024, 300 + bob, 214, 56, 4, "rgba(19,29,22,.95)", "rgba(184,235,129,.3)");
    text(language() === "de" ? "PASST ZU DEINEM FAHRZEUG" : "MATCHES YOUR VEHICLE", 1042, 323 + bob, 9, palette.green, 750);
    text(language() === "de" ? "Empfehlung  ·  96 %" : "Recommended  ·  96%", 1042, 341 + bob, 10, palette.ink, 600);
  }

  function drawAvatar(x, y, color, initials) {
    circle(x, y, 21, color); circle(x, y - 6, 7, "#eed9b1");
    polygon([[x - 13, y + 15], [x - 10, y + 4], [x, y], [x + 10, y + 4], [x + 14, y + 15]], "#e7e1c9");
    text(initials, x + 27, y + 4, 9, "rgba(243,241,223,.75)", 700);
  }

  function drawCommunityScene(t, progress) {
    const rise = (1 - ease(progress * 1.4)) * 70;
    drawGuideCard(733, 180 + rise, .78, t);
    // Writing card.
    roundedRect(133, 135 + rise, 454, 354, 5, "#222e25", "rgba(231,238,220,.22)");
    text(language() === "de" ? "NEUER BEITRAG" : "NEW REPAIR GUIDE", 163, 174 + rise, 10, palette.green, 800);
    text(language() === "de" ? "So habe ich den Filter" : "How I replaced the", 163, 220 + rise, 22, palette.ink, 700);
    text(language() === "de" ? "selbst gewechselt." : "cabin air filter.", 163, 249 + rise, 22, palette.ink, 700);
    roundedRect(163, 272 + rise, 186, 28, 3, "#304236");
    text("GOLF VII  ·  WARTUNG", 175, 291 + rise, 9, "#d5e2c6", 750);
    for (let i = 0; i < 3; i += 1) {
      circle(171, 334 + i * 34 + rise, 10, i === 0 ? palette.green : "#47594a");
      text(String(i + 1), 168, 338 + i * 34 + rise, 9, "#1c2a20", 800);
      roundedRect(193, 329 + i * 34 + rise, 303 - i * 27, 6, 2, "#879586");
      roundedRect(193, 342 + i * 34 + rise, 212 - i * 23, 4, 2, "#546355");
    }
    roundedRect(163, 446 + rise, 138, 26, 3, "#b8eb81");
    centeredText(language() === "de" ? "VERÖFFENTLICHEN" : "PUBLISH GUIDE", 232, 463 + rise, 8, "#223126", 800);
    // Comments coming in on the right.
    roundedRect(898, 468, 286, 86, 4, "rgba(23,33,26,.96)", "rgba(235,239,220,.2)");
    drawAvatar(925, 499, "#d59570", "Alex");
    text(language() === "de" ? "Hat bei meinem auch geklappt!" : "Worked on mine too!", 977, 499, 10, palette.ink, 600);
    text(language() === "de" ? "Guter Tipp, danke." : "Great tip, thanks.", 977, 519, 9, palette.muted, 500);
    for (let i = 0; i < 3; i += 1) {
      const bx = 1043 + i * 30;
      circle(bx, 601 + Math.sin(t * 2 + i) * 5, 11 + i, i === 1 ? palette.green : [palette.yellow, palette.blue, palette.orange][i]);
      text(["✓", "♥", "✦"][i], bx - 4, 605 + Math.sin(t * 2 + i) * 5, 10, "#26342a", 800);
    }
  }

  function drawVerifiedScene(t, progress) {
    const pulse = 1 + Math.sin(t * 2.1) * .035;
    // Low-poly horizon vehicles.
    drawCar(31, 492, .56, t);
    drawMotorcycle(920, 538, .57, t);
    // Oversized animated verification medallion.
    ctx.save(); ctx.translate(644, 376); ctx.scale(pulse, pulse);
    const n = 12; const outer = 163; const inner = 145;
    const pts = [];
    for (let i = 0; i < n * 2; i += 1) {
      const a = -Math.PI / 2 + i * Math.PI / n;
      const r = i % 2 ? inner : outer;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    polygon(pts, "#b8eb81", "rgba(237,246,217,.8)", 2);
    polygon([[0, -112], [98, -54], [87, 62], [0, 115], [-89, 63], [-102, -53]], "#6f9757");
    polygon([[-102, -53], [0, -112], [0, 0], [-89, 63]], "#86ab65");
    polygon([[0, -112], [98, -54], [0, 0]], "#9dc778");
    polygon([[0, 0], [98, -54], [87, 62]], "#63844f");
    line(-45, 0, -11, 34, "#f4f1dd", 14);
    line(-11, 34, 51, -41, "#f4f1dd", 14);
    ctx.restore();
    // Confirmation row.
    roundedRect(433, 572, 422, 60, 30, "rgba(20,29,23,.96)", "rgba(184,235,129,.5)");
    for (let i = 0; i < 10; i += 1) {
      const x = 463 + i * 40;
      const shown = clamp((progress * 10.8) - i + .45);
      circle(x, 602, 12, shown > 0 ? `rgba(184,235,129,${.38 + .62 * shown})` : "#354137", shown > 0 ? "#c8f29d" : "#617064");
      if (shown > 0) { line(x - 5, 602, x - 1, 606, "#29372b", 2.3); line(x - 1, 606, x + 6, 598, "#29372b", 2.3); }
    }
    text(language() === "de" ? "10× VON DER COMMUNITY BESTÄTIGT" : "10× CONFIRMED BY THE COMMUNITY", 476, 660, 10, palette.ink, 800);
    // Closing brand lockup.
    const fade = ease((progress - .18) / .5);
    ctx.globalAlpha = fade;
    roundedRect(466, 92, 357, 52, 3, "rgba(16,23,19,.88)", "rgba(184,235,129,.38)");
    centeredText("REPAIRLY", 644, 127, 28, palette.ink, 800);
    circle(727, 116, 4, palette.green);
    ctx.globalAlpha = 1;
  }

  function drawScene(time) {
    const safeTime = clamp(time, 0, DURATION - .001);
    const index = Math.min(3, Math.floor(safeTime / 6));
    const sceneTime = safeTime - index * 6;
    const data = copy(index);
    const intro = ease(sceneTime / .9);
    drawBackdrop(safeTime, index);

    if (index === 0) drawGarageScene(sceneTime, sceneTime / 5.8);
    if (index === 1) drawFeedScene(sceneTime, sceneTime / 5.8);
    if (index === 2) drawCommunityScene(sceneTime, sceneTime / 5.8);
    if (index === 3) drawVerifiedScene(sceneTime, sceneTime / 5.8);

    // Headline panel, repeated as a consistent campaign device.
    const x = 78 - (1 - intro) * 62;
    const fade = clamp(sceneTime / .55);
    ctx.globalAlpha = fade;
    text(data.kicker, x, 138, 11, palette.green, 800, "ui-monospace, SFMono-Regular, monospace");
    text(data.title[0], x, 195, 39, palette.ink, 720);
    text(data.title[1], x, 240, 39, palette.ink, 720);
    text(data.sub, x, 272, 13, "#c3cabc", 450);
    ctx.globalAlpha = 1;

    // Scene progress ticks.
    for (let i = 0; i < 4; i += 1) {
      roundedRect(78 + i * 22, 304, i === index ? 31 : 13, 3, 2, i === index ? palette.green : "rgba(230,238,216,.36)");
    }
    // Tiny overlapping color sliver on scene change.
    if (sceneTime < .32 && index > 0) {
      const alpha = 1 - sceneTime / .32;
      ctx.fillStyle = `rgba(184,235,129,${alpha * .1})`; ctx.fillRect(0, 0, W, H);
    }

    if (index !== lastScene) {
      lastScene = index;
      if (caption) caption.textContent = data.caption;
    }
    return { index, time: safeTime };
  }

  function updateControls(time) {
    if (!playButton) return;
    const label = playing ? "promoPause" : "promoPlay";
    const translations = language() === "en"
      ? { promoPause: "Pause", promoPlay: "Play" }
      : { promoPause: "Pause", promoPlay: "Abspielen" };
    const span = playButton.querySelector("span:not(.sr-only)");
    if (span) span.textContent = translations[label];
    playButton.setAttribute("aria-label", translations[label]);
    playButton.querySelector("svg path")?.setAttribute("d", playing ? "M6 4v12m8-12v12" : "M6 3l11 7-11 7z");
    if (runtime) {
      const second = Math.floor(time);
      if (second !== lastRuntimeSecond) {
        lastRuntimeSecond = second;
        runtime.textContent = `${formatTime(second)} / 00:24`;
      }
    }
  }

  function animationFrame(now) {
    if (!lastFrame) lastFrame = now;
    const delta = Math.min((now - lastFrame) / 1000, .05);
    lastFrame = now;
    if (playing) elapsed += delta;

    let frameTime = elapsed;
    let finishRecording = false;
    if (recording && elapsed >= DURATION) {
      elapsed = DURATION - 1 / 30;
      frameTime = elapsed;
      finishRecording = true;
      playing = false;
      recording = false;
    } else if (!recording && elapsed >= DURATION) {
      elapsed %= DURATION;
      frameTime = elapsed;
    }
    drawScene(frameTime);
    updateControls(frameTime);
    if (finishRecording && recorder?.state === "recording") recorder.stop();
    requestAnimationFrame(animationFrame);
  }

  playButton?.addEventListener("click", () => {
    playing = !playing;
    if (playing && elapsed >= DURATION - .1) elapsed = 0;
    updateControls(elapsed);
  });
  restartButton?.addEventListener("click", () => {
    elapsed = 0; playing = true; lastScene = -1; lastRuntimeSecond = -1;
    drawScene(0); updateControls(0);
  });
  document.addEventListener("repairly:languagechange", () => {
    lastScene = -1;
    drawScene(elapsed % DURATION);
    updateControls(elapsed % DURATION);
  });

  downloadButton?.addEventListener("click", () => {
    if (!canvas.captureStream || !window.MediaRecorder || recording) {
      if (status) status.textContent = language() === "en" ? "Video export is not supported in this browser." : "Videoexport wird in diesem Browser nicht unterstützt.";
      return;
    }
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      if (status) status.textContent = language() === "en" ? "Video export is not supported in this browser." : "Videoexport wird in diesem Browser nicht unterstützt.";
      return;
    }
    const stream = canvas.captureStream(30);
    const chunks = [];
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      if (status) status.textContent = language() === "en" ? "Could not start video recording." : "Videoaufnahme konnte nicht gestartet werden.";
      return;
    }
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "repairly-low-poly-werbung.webm";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
      if (status) status.textContent = language() === "en" ? "The Repairly advert video has been saved." : "Das Repairly-Werbevideo wurde gespeichert.";
      if (downloadButton) downloadButton.disabled = false;
    };
    elapsed = 0; lastScene = -1; recording = true; playing = true;
    if (status) status.textContent = language() === "en" ? "Recording the 24-second video …" : "Das 24-Sekunden-Video wird aufgenommen …";
    if (downloadButton) downloadButton.disabled = true;
    recorder.start(250);
  });

  drawScene(0);
  updateControls(0);
  requestAnimationFrame(animationFrame);
})();
