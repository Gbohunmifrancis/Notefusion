/**
 * NoteFusion — 3D Audio Ribbon & Harmonic Field (Three.js)
 * Inspired by ThreeUI catalog (Ribbon Field, Audio Wordmark, Stream Convergence).
 * 
 * Features:
 * - Multi-frequency 3D sinusoidal ribbons representing acoustic audio staves
 * - Floating harmonic pitch particles visualizing tone & solfa transcription
 * - Mouse parallax tilt & touch-responsive fluid motion
 * - Dynamic sync with hero audio playback (accelerated wave harmonics on play)
 * - Automatic pause via IntersectionObserver when scrolled offscreen
 * - Reduced motion accessibility check & DPR clamping
 */

(function () {
  "use strict";

  // Check WebGL availability & reduced motion preference
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches) {
    return; // Respect reduced motion
  }

  var container = document.getElementById("hero3dStage");
  var canvas = document.getElementById("hero3dCanvas");
  if (!container || !canvas) return;

  // Global controller exposed for interaction
  var NoteFusion3D = {
    isPlaying: false,
    theme: document.documentElement.getAttribute("data-theme") || "light",
    setPlaying: function (playing) {
      this.isPlaying = !!playing;
    },
    setTheme: function (theme) {
      this.theme = theme;
      if (typeof this._onThemeChange === "function") {
        this._onThemeChange(theme);
      }
    }
  };
  window.NoteFusion3D = NoteFusion3D;

  // Wait for Three.js to be available
  function initWhenThreeReady() {
    if (typeof THREE === "undefined") {
      setTimeout(initWhenThreeReady, 50);
      return;
    }
    setupScene();
  }

  function setupScene() {
    // ── Three.js Scene, Camera, Renderer ────────────────────────────────────
    var scene = new THREE.Scene();

    var width = container.clientWidth || window.innerWidth;
    var height = container.clientHeight || 480;

    var camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 3.5, 17);
    camera.lookAt(0, 0, 0);

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
    } catch (e) {
      console.warn("WebGL not supported, falling back to static visual", e);
      return;
    }

    var pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0); // Transparent

    // ── Lighting ─────────────────────────────────────────────────────────────
    var ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    var dirLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
    dirLight.position.set(10, 20, 15);
    scene.add(dirLight);

    var blueLight = new THREE.PointLight(0x1769e8, 3.5, 60);
    blueLight.position.set(-14, -3, 8);
    scene.add(blueLight);

    var cyanLight = new THREE.PointLight(0x38bdf8, 3.0, 60);
    cyanLight.position.set(14, 6, 10);
    scene.add(cyanLight);

    // ── 3D Ribbon Field (Multiple Frequency Waves) ───────────────────────────
    // Inspired by ThreeUI Ribbon Field / Audio Wordmark
    var ribbonCount = 5;
    var ribbonSegments = 140;
    var ribbonMeshes = [];
    var ribbonColors = [
      0x1769e8, // Primary Brand Royal Blue
      0x0284c7, // Vibrant Electric Ocean
      0x38bdf8, // Luminous Sky Cyan
      0x6366f1, // Indigo Harmonic
      0x0ea5e9  // Azure Stream
    ];

    var ribbonsGroup = new THREE.Group();
    scene.add(ribbonsGroup);

    for (var r = 0; r < ribbonCount; r++) {
      // Create ribbon strip geometry with substantial width
      var geom = new THREE.PlaneGeometry(42, 1.0, ribbonSegments, 1);
      
      // Double-sided phong material with prominent glow
      var mat = new THREE.MeshPhongMaterial({
        color: ribbonColors[r],
        emissive: ribbonColors[r],
        emissiveIntensity: 0.32,
        specular: 0xffffff,
        shininess: 90,
        transparent: true,
        opacity: 0.88 - r * 0.06,
        wireframe: false,
        side: THREE.DoubleSide
      });

      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = (r - (ribbonCount - 1) / 2) * 1.15;
      mesh.position.z = (r - (ribbonCount - 1) / 2) * -1.3;
      mesh.rotation.x = 0.22;
      
      // Store original vertices for procedural displacement
      var posAttr = geom.attributes.position;
      mesh.userData = {
        baseY: mesh.position.y,
        initialY: new Float32Array(posAttr.array.length),
        freqX: 0.16 + r * 0.035,
        speed: 1.3 + r * 0.25,
        phase: r * 0.75,
        amp: 1.15 + (ribbonCount - r) * 0.2
      };

      for (var i = 0; i < posAttr.array.length; i++) {
        mesh.userData.initialY[i] = posAttr.array[i];
      }

      ribbonMeshes.push(mesh);
      ribbonsGroup.add(mesh);
    }

    // Theme updater callback
    NoteFusion3D._onThemeChange = function (theme) {
      var isDark = theme === "dark";
      ambientLight.intensity = isDark ? 0.7 : 1.1;
      dirLight.intensity = isDark ? 2.2 : 1.8;
      ribbonMeshes.forEach(function (m) {
        m.material.emissiveIntensity = isDark ? 0.48 : 0.32;
        m.material.opacity = isDark ? 0.92 : 0.84;
      });
    };
    NoteFusion3D._onThemeChange(NoteFusion3D.theme);

    // ── Floating Harmonic Pitch Particles (Stream Convergence) ───────────────
    var particleCount = 140;
    var particleGeom = new THREE.BufferGeometry();
    var particlePositions = new Float32Array(particleCount * 3);
    var particleSizes = new Float32Array(particleCount);
    var particleData = [];

    for (var p = 0; p < particleCount; p++) {
      var px = (Math.random() - 0.5) * 32;
      var py = (Math.random() - 0.5) * 6;
      var pz = (Math.random() - 0.5) * 8;
      
      particlePositions[p * 3] = px;
      particlePositions[p * 3 + 1] = py;
      particlePositions[p * 3 + 2] = pz;

      particleSizes[p] = Math.random() * 2.5 + 1.5;

      particleData.push({
        origX: px,
        speed: Math.random() * 0.6 + 0.4,
        amp: Math.random() * 0.8 + 0.4,
        freq: Math.random() * 0.3 + 0.15,
        offset: Math.random() * Math.PI * 2
      });
    }

    particleGeom.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    particleGeom.setAttribute("size", new THREE.BufferAttribute(particleSizes, 1));

    // Particle Material with Soft Circular Falloff
    var canvasDot = document.createElement("canvas");
    canvasDot.width = 32;
    canvasDot.height = 32;
    var ctx = canvasDot.getContext("2d");
    var grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.3, "rgba(56, 189, 248, 0.8)");
    grad.addColorStop(0.7, "rgba(23, 105, 232, 0.3)");
    grad.addColorStop(1, "rgba(23, 105, 232, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    var particleTexture = new THREE.CanvasTexture(canvasDot);

    var particleMat = new THREE.PointsMaterial({
      size: 0.35,
      map: particleTexture,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    var particleSystem = new THREE.Points(particleGeom, particleMat);
    scene.add(particleSystem);

    // ── Mouse / Cursor Interaction & Parallax ───────────────────────────────
    var targetMouseX = 0;
    var targetMouseY = 0;
    var mouseX = 0;
    var mouseY = 0;

    function onMouseMove(e) {
      var rect = container.getBoundingClientRect();
      var clientX = e.clientX;
      var clientY = e.clientY;
      
      var nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      var ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      
      targetMouseX = Math.max(-1.5, Math.min(1.5, nx));
      targetMouseY = Math.max(-1.5, Math.min(1.5, ny));
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });

    function onTouchMove(e) {
      if (e.touches.length > 0) {
        var touch = e.touches[0];
        var rect = container.getBoundingClientRect();
        var nx = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        var ny = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
        targetMouseX = Math.max(-1.2, Math.min(1.2, nx));
        targetMouseY = Math.max(-1.2, Math.min(1.2, ny));
      }
    }
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    // ── Resize Listener ──────────────────────────────────────────────────────
    function onResize() {
      if (!container || !renderer) return;
      var newW = container.clientWidth || window.innerWidth;
      var newH = container.clientHeight || 480;

      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();

      renderer.setSize(newW, newH);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    window.addEventListener("resize", onResize, { passive: true });

    // ── Visibility & Off-screen Pause (IntersectionObserver) ─────────────────
    var isVisible = true;
    var animFrameId = null;

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            isVisible = entry.isIntersecting;
            if (isVisible && !animFrameId) {
              clock.start();
              animate();
            }
          });
        },
        { threshold: 0.05 }
      );
      observer.observe(container);
    }

    // ── Animation Loop ───────────────────────────────────────────────────────
    var clock = new THREE.Clock();
    var currentEnergy = 1.0;

    function animate() {
      if (!isVisible) {
        animFrameId = null;
        return;
      }

      animFrameId = requestAnimationFrame(animate);

      var delta = clock.getDelta();
      var elapsedTime = clock.getElapsedTime();

      // Lerp energy: 1.0 when idle, 2.5 when playing
      var targetEnergy = NoteFusion3D.isPlaying ? 2.6 : 1.0;
      currentEnergy += (targetEnergy - currentEnergy) * 0.08;

      // Smooth mouse lerp
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      // Parallax camera tilt
      camera.position.x = mouseX * 2.2;
      camera.position.y = 4 + mouseY * 1.4;
      camera.lookAt(0, 0, 0);

      // Subtle group sway
      ribbonsGroup.rotation.y = mouseX * 0.12 + Math.sin(elapsedTime * 0.3) * 0.04;
      ribbonsGroup.rotation.z = Math.cos(elapsedTime * 0.25) * 0.03;

      // Animate Ribbon Meshes
      for (var r = 0; r < ribbonMeshes.length; r++) {
        var mesh = ribbonMeshes[r];
        var pos = mesh.geometry.attributes.position;
        var count = pos.count;
        var data = mesh.userData;

        var effectiveSpeed = data.speed * (0.8 + currentEnergy * 0.6);
        var effectiveAmp = data.amp * (0.8 + currentEnergy * 0.45);

        for (var i = 0; i < count; i++) {
          var x = pos.getX(i);

          var wave1 = Math.sin(x * data.freqX + elapsedTime * effectiveSpeed + data.phase);
          var wave2 = Math.cos(x * 0.35 - elapsedTime * (effectiveSpeed * 0.7) + data.phase * 1.5) * 0.45;
          var wave3 = Math.sin(x * 0.08 + elapsedTime * 0.5) * 0.3;

          var distToMouse = Math.abs(x - mouseX * 8);
          var mouseRipple = Math.exp(-distToMouse * 0.3) * Math.sin(elapsedTime * 4.0) * 0.4;

          var y = (wave1 + wave2 + wave3) * effectiveAmp + mouseRipple;
          pos.setY(i, y);
        }

        pos.needsUpdate = true;
      }

      // Animate Harmonic Pitch Particles
      var pPos = particleGeom.attributes.position;
      var pArr = pPos.array;

      for (var p = 0; p < particleCount; p++) {
        var pData = particleData[p];
        var idx = p * 3;

        pArr[idx] += pData.speed * 0.04 * (0.8 + currentEnergy * 0.6);
        if (pArr[idx] > 18) {
          pArr[idx] = -18;
        }

        var pWave = Math.sin(pArr[idx] * pData.freq + elapsedTime * 1.5 + pData.offset);
        pArr[idx + 1] = pWave * pData.amp * (0.8 + currentEnergy * 0.5);
      }

      pPos.needsUpdate = true;

      // Render Scene
      renderer.render(scene, camera);
    }

    // Start animation loop
    animate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhenThreeReady);
  } else {
    initWhenThreeReady();
  }
})();
