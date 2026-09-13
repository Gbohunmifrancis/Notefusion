/**
 * NoteFusion — Condensation Ambient Glass Background
 * Ported from ThreeUI ElementsCollection: Condensation (variant: 'condensation')
 * Runtime: Canvas 2D
 */
(function () {
  "use strict";

  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches) return;

  var canvas = document.getElementById("condensationCanvas");
  if (!canvas) return;

  var context = canvas.getContext("2d");
  if (!context) return;

  var width = 1;
  var height = 1;
  var dpr = 1;
  var floorY = 1;
  var baseMaxDrops = 120;
  var maxDrops = 120;
  var lastCascade = 0;
  var simulatedNow = 0;
  var lastFrame = 0;
  var drops = [];
  var splashes = [];
  var bubbleSprites = new Map();

  var options = {
    speed: 1.0,
    dropAmount: 1.0,
    opacity: 0.85
  };

  function getBubbleSprite(radius) {
    var spriteRadius = Math.max(0.5, Math.round(radius * 2) / 2);
    var cached = bubbleSprites.get(spriteRadius);
    if (cached) return cached;

    var padding = Math.ceil(2 * dpr);
    var size = Math.ceil(spriteRadius * 2 + padding * 2);
    var sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    var spriteContext = sprite.getContext("2d");
    if (!spriteContext) return null;
    var center = size / 2;
    var lit = spriteRadius / (4.4 * dpr);
    spriteContext.fillStyle = "rgba(96,139,196," + (0.18 + lit * 0.22) + ")";
    spriteContext.beginPath();
    spriteContext.arc(center, center, spriteRadius, 0, Math.PI * 2);
    spriteContext.fill();
    spriteContext.strokeStyle = "rgba(70,98,148," + (0.35 + lit * 0.35) + ")";
    spriteContext.lineWidth = 0.9 * dpr;
    spriteContext.stroke();
    spriteContext.fillStyle = "rgba(255,255,255," + (0.32 + lit * 0.3) + ")";
    spriteContext.beginPath();
    spriteContext.arc(
      center - spriteRadius * 0.32,
      center - spriteRadius * 0.36,
      Math.max(0.45 * dpr, spriteRadius * 0.24),
      0,
      Math.PI * 2
    );
    spriteContext.fill();
    bubbleSprites.set(spriteRadius, sprite);
    return sprite;
  }

  function seedDrop(headStart) {
    headStart = headStart || 0;
    var margin = 8 * dpr;
    var availableWidth = Math.max(1, width - margin * 2);
    var availableHeight = Math.max(1, floorY - margin * 2);
    drops.push({
      x: margin + Math.random() * availableWidth,
      y: margin + Math.random() * availableHeight,
      r: (0.5 + headStart * 0.7) * dpr,
      rMax: (2.1 + Math.random() * 2.3) * dpr,
      grow: (0.0022 + Math.random() * 0.0032) * dpr,
      running: false,
      vy: 0
    });
  }

  function resize() {
    var parent = canvas.parentElement || document.body;
    var bounds = parent.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    height = canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    canvas.style.width = bounds.width + "px";
    canvas.style.height = bounds.height + "px";
    floorY = Math.max(1, height - 2 * dpr);
    baseMaxDrops = Math.max(70, Math.min(220, Math.round((width * height) / (dpr * dpr) / 5200)));
    maxDrops = Math.round(baseMaxDrops * options.dropAmount);
    drops = [];
    splashes = [];
    bubbleSprites.clear();
    var seedCount = Math.round(maxDrops * 0.62);
    for (var index = 0; index < seedCount; index += 1) seedDrop(Math.random() * 3);
  }

  function step(now, motionScale) {
    motionScale = motionScale || 1;
    if (drops.length < maxDrops && Math.random() < 0.34 * motionScale) seedDrop();
    if (now - lastCascade > 6400) {
      lastCascade = now;
      var nonRunning = drops.filter(function (d) { return !d.running; });
      nonRunning.sort(function (a, b) { return b.r - a.r; });
      nonRunning.slice(0, 3).forEach(function (d) {
        d.running = true;
        d.vy = 0.35 * dpr;
      });
    }

    for (var index = drops.length - 1; index >= 0; index -= 1) {
      var drop = drops[index];
      if (!drop) continue;
      if (!drop.running) {
        drop.r += drop.grow * motionScale;
        if (drop.r >= drop.rMax) {
          drop.running = true;
          drop.vy = 0.3 * dpr;
        }
        continue;
      }

      drop.vy = Math.min(drop.vy + 0.075 * dpr * motionScale, 5.4 * dpr);
      drop.y += drop.vy * motionScale;
      for (var otherIndex = drops.length - 1; otherIndex >= 0; otherIndex -= 1) {
        var other = drops[otherIndex];
        if (!other || other === drop || other.running) continue;
        var overlapsX = Math.abs(other.x - drop.x) < drop.r + other.r + 1.5 * dpr;
        var overlapsY = other.y > drop.y - drop.r && other.y < drop.y + drop.vy + drop.r;
        if (overlapsX && overlapsY) {
          drop.r = Math.sqrt(drop.r * drop.r + other.r * other.r);
          drops.splice(otherIndex, 1);
          if (otherIndex < index) index -= 1;
        }
      }

      if (drop.y >= floorY) {
        splashes.push({ x: drop.x, y: floorY, r0: drop.r, born: now });
        drops.splice(index, 1);
      }
    }
    splashes = splashes.filter(function (splash) { return now - splash.born < 760; });
  }

  function draw(now) {
    context.clearRect(0, 0, width, height);
    for (var i = 0; i < drops.length; i++) {
      var drop = drops[i];
      var sprite = getBubbleSprite(drop.r);
      if (sprite) {
        context.drawImage(sprite, drop.x - sprite.width / 2, drop.y - sprite.height / 2);
      }
    }

    for (var j = 0; j < splashes.length; j++) {
      var splash = splashes[j];
      var progress = (now - splash.born) / 760;
      if (progress < 0 || progress > 1) continue;
      var radius = splash.r0 + progress * 16 * dpr;
      context.strokeStyle = "rgba(75,108,158," + ((1 - progress) * 0.52) + ")";
      context.lineWidth = 1.1 * dpr;
      context.beginPath();
      context.ellipse(splash.x, splash.y, radius, radius * 0.34, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }

  var animFrame = 0;
  var isVisible = true;

  function tick(now) {
    var delta = lastFrame ? Math.min(50, now - lastFrame) : 16.67;
    lastFrame = now;
    simulatedNow += delta * options.speed;
    step(simulatedNow, options.speed);
    draw(simulatedNow);
    if (isVisible && !document.hidden) {
      animFrame = requestAnimationFrame(tick);
    } else {
      animFrame = 0;
    }
  }

  window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      isVisible = entries[0] ? entries[0].isIntersecting : true;
      if (isVisible && !animFrame) {
        lastFrame = performance.now();
        animFrame = requestAnimationFrame(tick);
      }
    });
    observer.observe(canvas.parentElement || canvas);
  }

  resize();
  animFrame = requestAnimationFrame(tick);
})();
