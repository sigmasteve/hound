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
