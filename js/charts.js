/**
 * Minimal canvas chart helpers. Deliberately dependency-free so the app
 * never has a broken chart when offline and the CDN hasn't been cached yet.
 */

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

function drawDonut(canvas, data, { centerLabel, centerSub } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 6;
  const inner = r * 0.62;
  if (total <= 0) {
    ctx.strokeStyle = 'rgba(244,239,227,0.15)';
    ctx.lineWidth = r - inner;
    ctx.beginPath();
    ctx.arc(cx, cy, (r + inner) / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    let start = -Math.PI / 2;
    for (const d of data) {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = r - inner;
      ctx.arc(cx, cy, (r + inner) / 2, start, start + slice - 0.02);
      ctx.stroke();
      start += slice;
    }
  }
  if (centerLabel) {
    ctx.fillStyle = '#F4EFE3';
    ctx.font = '600 20px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(centerLabel, cx, cy - 2);
  }
  if (centerSub) {
    ctx.fillStyle = 'rgba(244,239,227,0.55)';
    ctx.font = '400 11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(centerSub, cx, cy + 16);
  }
}

function drawBars(canvas, data, { formatY } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 8, padB = 24, padT = 12, padR = 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const bw = chartW / data.length;

  data.forEach((d, i) => {
    const barH = (d.value / max) * chartH;
    const x = padL + i * bw + bw * 0.18;
    const y = padT + (chartH - barH);
    const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
    grad.addColorStop(0, d.color || '#C9A24B');
    grad.addColorStop(1, (d.color || '#C9A24B') + '55');
    ctx.fillStyle = grad;
    const bwActual = bw * 0.64;
    roundRectTop(ctx, x, y, bwActual, barH, 4);
    ctx.fill();

    ctx.fillStyle = 'rgba(244,239,227,0.55)';
    ctx.font = '500 10px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, x + bwActual / 2, h - 6);
  });
}

function roundRectTop(ctx, x, y, w, h, r) {
  if (h < r) r = h;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawLine(canvas, points, { color = '#C9A24B', fill = true, formatY } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) {
    ctx.fillStyle = 'rgba(244,239,227,0.4)';
    ctx.font = '400 12px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data yet', w / 2, h / 2);
    return;
  }
  const padL = 4, padR = 4, padT = 10, padB = 20;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const stepX = chartW / (points.length - 1);

  const xy = points.map((p, i) => ({
    x: padL + i * stepX,
    y: padT + chartH - ((p.value - min) / range) * chartH
  }));

  if (fill) {
    ctx.beginPath();
    ctx.moveTo(xy[0].x, padT + chartH);
    xy.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(xy[xy.length - 1].x, padT + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    grad.addColorStop(0, color + '44');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.beginPath();
  xy.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  xy.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(244,239,227,0.5)';
  ctx.font = '500 9px "Inter", sans-serif';
  ctx.textAlign = 'center';
  points.forEach((p, i) => {
    if (points.length > 8 && i % Math.ceil(points.length / 6) !== 0 && i !== points.length - 1) return;
    ctx.fillText(p.label, xy[i].x, h - 4);
  });
}

window.BudJetCharts = { drawDonut, drawBars, drawLine };
