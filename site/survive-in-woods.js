// Safe-circle radius per fire level, from GameScene.fireRadius(level:)
(function () {
  const box = document.getElementById('fireScale');
  const radius = lv => 330 + 90 * (Math.min(lv, 5) - 1) + 50 * Math.max(0, lv - 5);
  const max = radius(15);
  for (let lv = 1; lv <= 15; lv++) {
    const r = radius(lv);
    const row = document.createElement('div');
    row.className = 'bar-row';
    const camp = lv === 5 || lv === 10 || lv === 15;
    row.innerHTML = `<span class="lv">Lv ${lv}</span><div><div class="bar${camp ? ' camp' : ''}" style="width:${(r / max * 100).toFixed(1)}%"></div></div><span class="r">${r}</span>`;
    row.title = camp ? `Level ${lv}: a new camp appears` : `Level ${lv}`;
    box.appendChild(row);
  }
})();

// A few fireflies drifting over the hero
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.querySelector('canvas.fireflies');
  const ctx = c.getContext('2d');
  let w, h, flies;
  function size() {
    const r = c.getBoundingClientRect();
    w = c.width = r.width * devicePixelRatio;
    h = c.height = r.height * devicePixelRatio;
    flies = Array.from({ length: 28 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      p: Math.random() * Math.PI * 2
    }));
  }
  size();
  addEventListener('resize', size);
  (function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const f of flies) {
      f.x = (f.x + f.vx * devicePixelRatio + w) % w;
      f.y = (f.y + f.vy * devicePixelRatio + h) % h;
      const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t / 700 + f.p));
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 7 * devicePixelRatio);
      g.addColorStop(0, `rgba(255, 220, 140, ${a})`);
      g.addColorStop(1, 'rgba(255, 220, 140, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 7 * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  })(0);
})();
