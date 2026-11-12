(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* Size a canvas to its CSS box at device resolution; returns CSS pixel size. */
  function fit(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: r.width, H: r.height };
  }

  /* Connect a group of tab buttons so exactly one is on. */
  function tabGroup(buttons, onSelect) {
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      onSelect(b);
    }));
  }

  /* ─── Headline ─── */
  $$('[data-split]').forEach((el) => {
    el.innerHTML = [...el.textContent]
      .map((c, i) => `<span class="char" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  });

  /* ─── Reveal on scroll + counters ─── */
  function countUp(el) {
    const end = +el.dataset.count, dec = +(el.dataset.decimals || 0), suf = el.dataset.suffix || '';
    const t0 = performance.now(), dur = 1400;
    (function tick(t) {
      const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 4);
      el.textContent = (end * e).toFixed(dec) + suf;
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (!reduced) $$('[data-count]', e.target).forEach(countUp);
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
  $$('[data-reveal]').forEach((el) => io.observe(el));

  /* ─── Nav: progress bar, hide on scroll down, active link ─── */
  const nav = $('#nav'), bar = $('#progress');
  let lastY = scrollY, ticking = false;
  function onScroll() {
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
    nav.classList.toggle('is-stuck', y > 8);
    const menuOpen = links.classList.contains('is-open');
    if (Math.abs(y - lastY) > 6) {
      nav.classList.toggle('is-hidden', y > lastY && y > 500 && !menuOpen);
      lastY = y;
    }
    ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  const links = $('#navLinks'), burger = $('#burger');
  function setMenu(open) {
    links.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  burger.addEventListener('click', () => setMenu(!links.classList.contains('is-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  const navAnchors = $$('a', links);
  const sectionIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navAnchors.forEach((a) => {
        const on = a.getAttribute('href') === '#' + e.target.id;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main > section[id]').forEach((s) => sectionIo.observe(s));

  /* ─── Theme: circular wipe from the toggle where supported ─── */
  const themeListeners = [];
  $('#theme').addEventListener('click', (e) => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    const apply = () => {
      root.dataset.theme = next;
      $('meta[name="theme-color"]').content = next === 'light' ? '#f6f2ea' : '#171513';
      try { localStorage.setItem('theme', next); } catch (err) { /* private mode */ }
      themeListeners.forEach((fn) => fn());
    };
    if (!document.startViewTransition || reduced) return apply();
    const r = e.currentTarget.getBoundingClientRect();
    root.style.setProperty('--tx', r.left + r.width / 2 + 'px');
    root.style.setProperty('--ty', r.top + r.height / 2 + 'px');
    document.startViewTransition(apply);
  });

  /* ─── Hero simulator ───
     The decision rules, thresholds and weather limits below are the rule table
     from the adaptive cruise control project's README. Only the scene and the
     traffic are invented, so the panel behaves like the real logic. */
  (function sim() {
    const canvas = $('#simCanvas'), ctx = canvas.getContext('2d');
    const WEATHER = {
      Sunny: { max: 50, sky: 0 }, Cloudy: { max: 45, sky: .1 }, Rainy: { max: 38, sky: .16, rain: 1 },
      Foggy: { max: 32, sky: .1, fog: 1 }, Night: { max: 42, sky: 0, night: 1 },
    };
    const ORDER = Object.keys(WEATHER);
    const LABEL = { 1: 'EMERGENCY STOP', 2: 'BRAKING: VEHICLE TOO CLOSE', 3: 'STOPPING: RED LIGHT', 4: 'WEATHER ADAPTATION', 5: 'CRUISING' };
    const TONE = { 1: 'stop', 2: 'warn', 3: 'warn', 4: 'go', 5: 'go' };
    const K = 7.35; // area ratio = K / d², so 0.15 at 7 m and 0.08 at about 9.6 m

    const s = { v: 46, lead: 42, d: 26, wx: 'Sunny', red: 0, odo: 0, t: 0, level: 5, target: 50, ratio: 0, conf: .87, nextLead: 5, nextWx: 15, nextEvent: 26, ev: 0 };
    const hud = { ratio: $('#simRatio'), action: $('#simAction'), wx: $('#simWeather'), speed: $('#simSpeed') };
    const rungs = $$('#simLadder li');
    let lastLevel = 0;

    const skyline = Array.from({ length: 34 }, (_, i) => ({
      x: i / 34 + (Math.sin(i * 12.9) * .01), w: .022 + .03 * Math.abs(Math.sin(i * 3.1)), h: .05 + .19 * Math.abs(Math.sin(i * 7.7 + 1.2)), tree: i % 3 === 0,
    }));
    const drops = Array.from({ length: 90 }, (_, i) => ({ x: Math.abs(Math.sin(i * 91.7)), y: Math.abs(Math.sin(i * 47.3)), l: .6 + Math.abs(Math.sin(i * 13.1)) }));

    function cutIn() { s.d = Math.min(s.d, 7.6); s.lead = Math.max(14, s.v - 26); s.nextLead = 5; s.conf = .91; }
    function redLight() { s.red = 5.5; }
    function nextWeather() { s.wx = ORDER[(ORDER.indexOf(s.wx) + 1) % ORDER.length]; }

    function step(dt) {
      s.t += dt;
      s.ratio = s.d < 60 ? K / (s.d * s.d) : 0;
      const base = WEATHER[s.wx].max;

      // Priority ladder: the first rule that applies wins.
      if (s.ratio > .15) { s.level = 1; s.target = 0; }
      else if (s.ratio >= .08) { s.level = 2; s.target = base * (.7 - .5 * (s.ratio - .08) / .07); }
      else if (s.red > 0) { s.level = 3; s.target = 0; }
      else if (s.wx !== 'Sunny') { s.level = 4; s.target = base; }
      else { s.level = 5; s.target = 50; }

      const a = s.target < s.v ? (s.level === 1 ? 75 : 24) : 9;
      s.v += clamp(s.target - s.v, -a * dt, a * dt);
      s.odo += s.v / 3.6 * dt;
      s.d += (s.lead - s.v) / 3.6 * dt;
      s.red = Math.max(0, s.red - dt);

      if (s.d < 5.7) { s.d = 5.7; s.lead = Math.max(s.lead, s.v + 6); }
      if (s.d > 85) { s.lead = s.v - 7; }
      if (s.v < 4 && s.d < 13) s.lead = Math.max(s.lead, 30); // the car ahead clears after a stop

      s.nextLead -= dt; s.nextWx -= dt; s.nextEvent -= dt;
      if (s.nextLead <= 0) { s.lead = 26 + Math.random() * 34; s.nextLead = 5 + Math.random() * 5; s.conf = .78 + Math.random() * .18; }
      if (s.nextWx <= 0) { nextWeather(); s.nextWx = 15; }
      if (s.nextEvent <= 0) { (s.ev++ % 2 ? cutIn : redLight)(); s.nextEvent = 22; }
    }

    function updateHud() {
      hud.ratio.textContent = s.ratio.toFixed(3);
      hud.speed.textContent = Math.round(s.target);
      hud.wx.textContent = s.wx;
      if (s.level !== lastLevel) {
        hud.action.textContent = LABEL[s.level];
        hud.action.dataset.tone = TONE[s.level];
        rungs.forEach((r) => r.classList.toggle('is-on', +r.dataset.level === s.level));
        lastLevel = s.level;
      }
    }

    function draw() {
      const { W, H } = fit(canvas, ctx);
      if (!W || !H) return;
      const wx = WEATHER[s.wx];
      const hz = H * .4, cx = W / 2;
      const m = W * 1.3;          // pixels per metre at 1 m depth (horizontal scale)
      const A = (H - hz) * 5.2;   // ground projection: y = hz + A/d, bottom edge at 5.2 m
      const yAt = (d) => hz + A / d;
      const xAt = (lat, d) => cx + lat * m / d;

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (wx.sky) { ctx.fillStyle = `rgba(150,160,170,${wx.sky})`; ctx.fillRect(0, 0, W, hz); }

      // Horizon: buildings (grey) and vegetation (olive) in segmentation colours.
      const drift = (s.odo * .0012) % 1;
      skyline.forEach((b) => {
        const x = ((b.x - drift + 1) % 1) * W * 1.1 - W * .05;
        if (b.tree) {
          ctx.fillStyle = '#5f7f24';
          ctx.beginPath(); ctx.ellipse(x, hz, b.w * W * .7, b.h * H * .42, 0, Math.PI, 0); ctx.fill();
        } else {
          ctx.fillStyle = '#464646';
          ctx.fillRect(x, hz - b.h * H, b.w * W, b.h * H);
        }
      });

      // Ground: sidewalk, road.
      const poly = (pts, c) => { ctx.fillStyle = c; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
      const NEAR = 4, FAR = 400;
      ctx.fillStyle = '#26170f'; ctx.fillRect(0, hz, W, H - hz);
      poly([[xAt(-10, NEAR), yAt(NEAR)], [xAt(-10, FAR), yAt(FAR)], [xAt(10, FAR), yAt(FAR)], [xAt(10, NEAR), yAt(NEAR)]], '#c81fbe');
      poly([[xAt(-7, NEAR), yAt(NEAR)], [xAt(-7, FAR), yAt(FAR)], [xAt(7, FAR), yAt(FAR)], [xAt(7, NEAR), yAt(NEAR)]], '#6f3a70');

      // Lane markings (CARLA road-line green), moving with the car.
      ctx.globalAlpha = .95;
      const strip = (lat, d1, d2, hw = .09) => poly([[xAt(lat - hw, d1), yAt(d1)], [xAt(lat - hw, d2), yAt(d2)], [xAt(lat + hw, d2), yAt(d2)], [xAt(lat + hw, d1), yAt(d1)]], '#b4f03c');
      [-6.6, 6.6].forEach((l) => strip(l, NEAR, FAR, .07));
      const period = 9, off = s.odo % period;
      for (let z = period - off; z < 150; z += period) {
        const d1 = Math.max(NEAR, z), d2 = z + 3.6;
        if (d2 < NEAR) continue;
        [-2, 2].forEach((l) => strip(l, d1, d2));
      }
      ctx.globalAlpha = 1;

      // Roadside poles passing the camera.
      const poleP = 22, poleOff = s.odo % poleP;
      ctx.strokeStyle = '#b9b9b9';
      for (let z = 110 - ((110 + poleOff) % poleP); z > 5; z -= poleP) {
        const sc = m / z; ctx.lineWidth = Math.max(.6, .16 * sc);
        [-8, 8].forEach((l) => { const x = xAt(l, z), y = yAt(z); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 6.5 * sc); ctx.stroke(); });
      }

      // Traffic light when the sign layer is engaged.
      if (s.red > 0) {
        const z = 30, sc = m / z, x = xAt(-3.6, z), y = yAt(z) - 5.5 * sc;
        ctx.fillStyle = '#e8c21a'; ctx.fillRect(x - .28 * sc, y, .56 * sc, 1.5 * sc);
        ctx.fillStyle = '#ff3b30'; ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(x, y + .35 * sc, .2 * sc, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = '#3fe07a'; ctx.lineWidth = 1.5; ctx.strokeRect(x - .5 * sc, y - .2 * sc, sc, 1.9 * sc);
        ctx.fillStyle = '#3fe07a'; ctx.font = '500 11px "Hanken Grotesk", sans-serif';
        ctx.fillText('traffic light', x - .5 * sc, y - .2 * sc - 5);
      }

      // Lead vehicle and its detection box.
      if (s.d < 90) {
        const sc = m / s.d, w = 1.8 * sc, h = w / 1.2, x = cx - w / 2, y = yAt(s.d) - h;
        const braking = s.lead < s.v - 1;
        ctx.fillStyle = '#1b2dbd';
        ctx.beginPath(); ctx.roundRect(x, y + h * .36, w, h * .56, w * .05); ctx.fill();
        ctx.beginPath(); ctx.roundRect(x + w * .13, y, w * .74, h * .42, [w * .09, w * .09, 0, 0]); ctx.fill();
        ctx.fillStyle = '#0a1036'; ctx.fillRect(x + w * .2, y + h * .07, w * .6, h * .28);
        ctx.fillStyle = '#05060a'; ctx.fillRect(x + w * .07, y + h * .9, w * .18, h * .1); ctx.fillRect(x + w * .75, y + h * .9, w * .18, h * .1);
        ctx.fillStyle = braking ? '#ff3b30' : '#7e1711';
        if (braking) { ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 14; }
        ctx.fillRect(x + w * .05, y + h * .46, w * .17, h * .09); ctx.fillRect(x + w * .78, y + h * .46, w * .17, h * .09);
        ctx.shadowBlur = 0;

        if (s.d < 60) {
          const col = s.level === 1 ? '#ff6b5e' : '#ff4fd8', pad = 3;
          ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
          const tag = `car ${Math.round(s.conf * 100)}%`;
          ctx.font = '500 11px "Hanken Grotesk", sans-serif';
          const tw = ctx.measureText(tag).width + 8;
          ctx.fillStyle = col; ctx.fillRect(x - pad - .75, y - pad - 16, tw, 16);
          ctx.fillStyle = '#000'; ctx.fillText(tag, x - pad + 3, y - pad - 4);
        }
      }

      // Weather overlays.
      if (wx.night) { ctx.fillStyle = 'rgba(2,5,22,.5)'; ctx.fillRect(0, 0, W, H); }
      if (wx.fog) {
        const g = ctx.createLinearGradient(0, hz - H * .2, 0, H);
        g.addColorStop(0, 'rgba(190,198,200,.62)'); g.addColorStop(.45, 'rgba(190,198,200,.42)'); g.addColorStop(1, 'rgba(190,198,200,.06)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      if (wx.rain) {
        ctx.strokeStyle = 'rgba(205,225,255,.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        drops.forEach((p) => {
          const x = ((p.x + s.t * .12) % 1) * W, y = ((p.y + s.t * 1.5 * p.l) % 1) * H;
          ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 15 * p.l);
        });
        ctx.stroke();
      }
    }

    let running = false, last = 0, visible = true, hudClock = 0;
    function frame(t) {
      if (!running) return;
      const dt = Math.min((t - last) / 1000, .05); last = t;
      step(dt); draw();
      hudClock += dt;
      if (hudClock > .08) { updateHud(); hudClock = 0; }
      requestAnimationFrame(frame);
    }
    function start() { if (running || reduced) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
    function stop() { running = false; }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : (visible && start()); });

    /* With reduced motion the scene stays still and the buttons jump to the result. */
    function settle() { for (let i = 0; i < 90; i++) step(1 / 30); draw(); updateHud(); }
    function act(fn) { fn(); if (reduced) settle(); else updateHud(); }
    $('#simCut').addEventListener('click', () => act(cutIn));
    $('#simRed').addEventListener('click', () => act(redLight));
    $('#simWx').addEventListener('click', () => act(nextWeather));
    new ResizeObserver(() => { if (!running) { draw(); } }).observe(canvas);
    step(0); draw(); updateHud();
    if (reduced) { settle(); document.fonts && document.fonts.ready.then(draw); }
  })();

  /* ─── ACC frame switcher ─── */
  const frames = $$('#frames img');
  tabGroup($$('[data-frame]'), (b) => frames.forEach((im, i) => im.classList.toggle('is-on', i === +b.dataset.frame)));

  /* ─── GymTech role matrix (from the project's README) ─── */
  (function roles() {
    const ROLES = ['Admin', 'Receptionist', 'Trainer', 'Member'];
    const FEATURES = [
      ['KPI analytics & total revenue', 'A'],
      ['Manage user accounts & roles', 'A'],
      ['Manage trainers & specialities', 'A'],
      ['Assign trainers to members', 'AR'],
      ['Member CRUD operations', 'AR'],
      ['Create / renew subscriptions', 'AR'],
      ['Record & process payments', 'AR'],
      ['Check in attendance', 'ART'],
      ['View assigned clients & schedule', 'T'],
      ['View personal membership & history', 'M'],
      ['Self-service plan purchase', 'M'],
    ];
    const list = $('#perms'), tabs = $('#roleTabs');
    list.innerHTML = FEATURES.map(([f], i) => `<li style="--i:${i}"><i></i>${f.replace(/&/g, '&amp;')}</li>`).join('');
    tabs.innerHTML = ROLES.map((r, i) => `<button type="button" class="tab${i ? '' : ' is-on'}" aria-pressed="${!i}" data-role="${r[0]}">${r}</button>`).join('');
    const items = $$('li', list);
    const show = (key) => items.forEach((li, i) => li.classList.toggle('is-on', FEATURES[i][1].includes(key)));
    tabGroup($$('.tab', tabs), (b) => show(b.dataset.role));
    show('A');
  })();

  /* ─── Flag mini-quiz ─── */
  (function quiz() {
    const FLAGS = [
      ['Romania', 'v', '#002b7f', '#fcd116', '#ce1126'], ['Hungary', 'h', '#ce2939', '#ffffff', '#477050'],
      ['Germany', 'h', '#000000', '#dd0000', '#ffce00'], ['France', 'v', '#002395', '#ffffff', '#ed2939'],
      ['Italy', 'v', '#009246', '#ffffff', '#ce2b37'], ['Belgium', 'v', '#000000', '#fdda24', '#ef3340'],
      ['Ireland', 'v', '#169b62', '#ffffff', '#ff883e'], ['Netherlands', 'h', '#ae1c28', '#ffffff', '#21468b'],
      ['Austria', 'h', '#ed2939', '#ffffff', '#ed2939'], ['Bulgaria', 'h', '#ffffff', '#00966e', '#d62612'],
      ['Estonia', 'h', '#0072ce', '#000000', '#ffffff'], ['Lithuania', 'h', '#fdb913', '#006a44', '#c1272d'],
      ['Poland', 'h', '#ffffff', '#dc143c'], ['Ukraine', 'h', '#0057b7', '#ffd700'], ['Latvia', 'h', '#9e3039', '#9e3039', '#ffffff', '#9e3039', '#9e3039'],
    ];
    const flag = $('#flag'), opts = $('#flagOptions'), score = $('#flagScore');
    const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let right = 0, total = 0, prev = null;

    function round() {
      const pool = shuffle(FLAGS.filter((f) => f !== prev));
      const answer = pool[0]; prev = answer;
      const [, dir, ...cols] = answer;
      flag.style.gridTemplate = dir === 'v' ? `1fr / repeat(${cols.length}, 1fr)` : `repeat(${cols.length}, 1fr) / 1fr`;
      flag.innerHTML = cols.map((c) => `<span style="background:${c}"></span>`).join('');
      opts.innerHTML = '';
      shuffle(pool.slice(0, 4)).forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'opt'; b.textContent = f[0];
        b.addEventListener('click', () => {
          total++;
          const ok = f === answer;
          if (ok) right++;
          score.textContent = `${right} / ${total}`;
          b.classList.add(ok ? 'is-right' : 'is-wrong');
          $$('.opt', opts).forEach((o) => { o.disabled = true; if (o.textContent === answer[0]) o.classList.add('is-right'); });
          setTimeout(() => { flag.classList.add('is-swap'); setTimeout(() => { round(); flag.classList.remove('is-swap'); }, reduced ? 0 : 240); }, 950);
        });
        opts.append(b);
      });
    }
    round();
  })();

  /* ─── PID playground: textbook DC motor, derivative on measurement ─── */
  (function pid() {
    const canvas = $('#pidCanvas'), ctx = canvas.getContext('2d');
    const sliders = { kp: $('#kp'), ki: $('#ki'), kd: $('#kd') };
    const outs = { kp: $('#kpOut'), ki: $('#kiOut'), kd: $('#kdOut') };
    const T = 3, DT = .0005, EVERY = 12;
    const YMAX = 1.5;
    let curve = [], prevCurve = null, anim = 0;

    function simulate(Kp, Ki, Kd) {
      const J = .01, b = .1, K = .01, R = 1, L = .5;
      let w = 0, i = 0, I = 0, peak = 0, lastOut = 0;
      const pts = [];
      const n = Math.round(T / DT);
      for (let s = 0; s < n; s++) {
        const e = 1 - w; I += e * DT;
        const dw = (K * i - b * w) / J;
        const V = Kp * e + Ki * I - Kd * dw;
        i += DT * (V - R * i - K * w) / L;
        w += DT * dw;
        if (w > peak) peak = w;
        if (Math.abs(w - 1) > .02) lastOut = (s + 1) * DT;
        if (s % EVERY === 0) pts.push(w);
      }
      pts.push(w);
      return { pts, overshoot: Math.max(0, peak - 1) * 100, settle: lastOut, final: w };
    }

    function draw(mix = 1) {
      const { W, H } = fit(canvas, ctx);
      if (!W || !H) return;
      const css = getComputedStyle(document.documentElement);
      const line = css.getPropertyValue('--line').trim(), muted = css.getPropertyValue('--muted').trim(), accent = css.getPropertyValue('--accent').trim();
      const pad = { l: 36, r: 12, t: 12, b: 24 };
      const px = (t) => pad.l + (t / T) * (W - pad.l - pad.r);
      const py = (y) => H - pad.b - (y / YMAX) * (H - pad.t - pad.b);
      ctx.clearRect(0, 0, W, H);

      ctx.font = '400 11px "Hanken Grotesk", sans-serif'; ctx.lineWidth = 1;
      ctx.strokeStyle = line; ctx.fillStyle = muted;
      ctx.beginPath();
      for (let t = 0; t <= T; t++) { ctx.moveTo(px(t), pad.t); ctx.lineTo(px(t), H - pad.b); ctx.fillText(t + (t === T ? ' s' : ''), px(t) - (t === T ? 20 : 3), H - 7); }
      [0, .5, 1, 1.5].forEach((y) => { ctx.moveTo(pad.l, py(y)); ctx.lineTo(W - pad.r, py(y)); ctx.fillText(y.toFixed(1), 8, py(y) + 4); });
      ctx.stroke();

      // ±2% settling band and setpoint.
      ctx.globalAlpha = .13; ctx.fillStyle = accent;
      ctx.fillRect(pad.l, py(1.02), W - pad.l - pad.r, py(.98) - py(1.02));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = muted; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, py(1)); ctx.lineTo(W - pad.r, py(1)); ctx.stroke(); ctx.setLineDash([]);

      // Response, morphing from the previous curve.
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      curve.forEach((y, i) => {
        const from = prevCurve ? prevCurve[i] : 0;
        const v = from + (y - from) * mix;
        const x = px(i / (curve.length - 1) * T), yy = py(v);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      });
      ctx.stroke(); ctx.restore();
    }

    function update() {
      const Kp = +sliders.kp.value, Ki = +sliders.ki.value, Kd = +sliders.kd.value;
      Object.keys(sliders).forEach((k) => { outs[k].textContent = sliders[k].value; });
      const r = simulate(Kp, Ki, Kd);
      $('#pidOs').textContent = r.overshoot.toFixed(1) + '%';
      $('#pidTs').textContent = r.settle >= T - DT ? `> ${T} s` : r.settle.toFixed(2) + ' s';
      $('#pidSs').textContent = (Math.abs(1 - r.final) * 100).toFixed(1) + '%';
      prevCurve = curve.length ? curve : null;
      curve = r.pts;
      cancelAnimationFrame(anim);
      if (reduced || !prevCurve) return draw();
      const t0 = performance.now();
      (function tick(t) {
        const k = clamp((t - t0) / 380, 0, 1);
        draw(1 - Math.pow(1 - k, 3));
        if (k < 1) anim = requestAnimationFrame(tick);
      })(t0);
    }

    const presets = $$('[data-pid]');
    Object.values(sliders).forEach((s) => s.addEventListener('input', () => {
      presets.forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
      update();
    }));
    tabGroup(presets, (b) => {
      const [p, i, d] = b.dataset.pid.split(',');
      sliders.kp.value = p; sliders.ki.value = i; sliders.kd.value = d;
      update();
    });
    themeListeners.push(() => draw());
    new ResizeObserver(() => draw()).observe(canvas);
    update();
    document.fonts && document.fonts.ready.then(() => draw());
  })();

  /* ─── Language meters on the CEFR scale ─── */
  $$('.cefr').forEach((el) => {
    const n = +el.dataset.level;
    el.innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? 'is-on' : ''}"></i>`).join('');
  });

  /* ─── Copy e-mail ─── */
  const copy = $('#copyMail');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(copy.dataset.mail); copy.textContent = 'Copied'; }
    catch (e) { copy.textContent = 'Press ⌘/Ctrl + C'; getSelection().selectAllChildren(copy.previousElementSibling); }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
  });

  /* ─── Contact form ───
     Messages are posted to Web3Forms, which emails them to CONTACT.email.
     Paste your access key below (it is meant to be public, so it is safe in the page).
     Until then the form falls back to opening the visitor's own email app. */
  const CONTACT = {
    endpoint: 'https://api.web3forms.com/submit',
    accessKey: 'eadfb48b-155c-4143-b172-a9c38676e2d3', // Web3Forms access key (public by design; mirrors FORM_ACCESS_KEY in .env)
    email: 'kovacs.erik171004@gmail.com',
  };
  (function contactForm() {
    const form = $('#contactForm'), status = $('#cStatus'), send = $('#cSend');
    const f = { email: $('#cEmail'), msg: $('#cMsg') };
    const errs = { email: $('#cEmailErr'), msg: $('#cMsgErr') };
    const count = $('#cCount'), MAX = 1500, KEY = 'contactDraft';
    const loadedAt = Date.now();

    const store = {
      get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
      set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
      clear() { try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ } },
    };
    const updateCount = () => { count.textContent = `${f.msg.value.length} / ${MAX}`; count.classList.toggle('is-near', f.msg.value.length > MAX * .9); };

    const draft = store.get();
    if (draft.email) f.email.value = draft.email;
    if (draft.msg) f.msg.value = draft.msg;
    updateCount();
    form.addEventListener('input', (e) => {
      updateCount(); store.set({ email: f.email.value, msg: f.msg.value });
      if (e.target.getAttribute('aria-invalid')) validate(e.target);
    });

    function setErr(key, el, text) {
      errs[key].textContent = text;
      if (text) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      return !text;
    }
    const checks = {
      email: () => setErr('email', f.email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim()) ? '' : 'Please enter a valid email so I can reply.'),
      msg: () => setErr('msg', f.msg, f.msg.value.trim().length < 10 ? 'Please write at least a short message (10+ characters).' : ''),
    };
    const validate = (el) => (el === f.email ? checks.email() : el === f.msg ? checks.msg() : true);
    const showStatus = (html, tone) => { status.innerHTML = html; status.dataset.tone = tone || 'error'; status.hidden = false; };
    const mailError = `Or write to me directly at <a href="mailto:${CONTACT.email}">${CONTACT.email}</a>.`;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.hidden = true;
      const ok = [checks.email(), checks.msg()];
      if (ok.includes(false)) { form.querySelector('[aria-invalid="true"]').focus(); return; }

      const email = f.email.value.trim(), message = f.msg.value.trim();
      const domain = email.split('@')[1];
      const subject = `Message from ${domain} via your portfolio`;

      // Bots: honeypot filled, or submitted faster than a person could type.
      if (form.botcheck.checked || Date.now() - loadedAt < 2500) { return finish(); }

      if (!CONTACT.accessKey) {
        showStatus('The form isn\'t connected yet, so your email app should open with the message ready to send.', 'info');
        location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message + '\n\nReply to: ' + email)}`;
        return;
      }

      send.disabled = true; send.classList.add('is-loading');
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
      try {
        const res = await fetch(CONTACT.endpoint, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: CONTACT.accessKey, subject, from_name: 'Portfolio website', name: email, email, message, botcheck: '' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Request failed');
        finish();
      } catch (err) {
        showStatus(`Sorry, your message couldn't be sent${err.name === 'AbortError' ? ' (the request timed out)' : ''}. Your text is still here, so you can try again. ${mailError}`);
      } finally {
        clearTimeout(timer); send.disabled = false; send.classList.remove('is-loading');
      }
    });

    function clearForm() {
      form.reset(); updateCount();
      Object.values(f).forEach((el) => el.removeAttribute('aria-invalid'));
      Object.values(errs).forEach((p) => { p.textContent = ''; });
      status.hidden = true;
    }

    const toast = $('#toast');
    let toastTimer;
    function hideToast() {
      clearTimeout(toastTimer);
      if (toast.hidden) return;
      toast.classList.add('is-out');
      setTimeout(() => { toast.hidden = true; toast.classList.remove('is-out'); }, reduced ? 0 : 350);
    }
    function showToast() {
      clearTimeout(toastTimer);
      toast.classList.remove('is-out');
      toast.hidden = false;
      // Restart the entrance and countdown animations if it was already open.
      toast.style.animation = 'none'; void toast.offsetWidth; toast.style.animation = '';
      const arm = () => { toastTimer = setTimeout(hideToast, 6000); };
      arm();
      toast.onmouseenter = () => clearTimeout(toastTimer);
      toast.onmouseleave = arm;
    }
    $('#toastClose').addEventListener('click', hideToast);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') hideToast(); });

    function finish() {
      store.clear(); clearForm(); showToast();
    }
  })();

  $('#year').textContent = new Date().getFullYear();
  window.__siteReady = true;
})();
