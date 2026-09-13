/*
 * NoteFusion Landing Page Interactions
 * Handles header state, mobile drawer, scroll animations, and interactive hero previews.
 */

(function () {
  "use strict";

  // ── Header Scroll State ───────────────────────────────────────────────────
  var header = document.getElementById("siteHeader");
  if (header) {
    var updateHeaderScroll = function () {
      header.dataset.scrolled = window.scrollY > 12 ? "true" : "false";
    };
    updateHeaderScroll();
    window.addEventListener("scroll", updateHeaderScroll, { passive: true });
  }

  // ── Mobile Menu Toggle (transitions.dev menu-dropdown & icon-swap) ──────
  var hamburgerBtn = document.getElementById("hamburgerBtn");
  var hamburgerIconSwap = document.getElementById("hamburgerIconSwap");
  var mobileMenu = document.getElementById("mobileMenu");
  var dropdownCloseMs = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")
  ) || 150;

  if (hamburgerBtn && mobileMenu) {
    var closeTimeout = null;

    function openDropdown() {
      if (closeTimeout) clearTimeout(closeTimeout);
      mobileMenu.classList.remove("is-closing");
      mobileMenu.classList.add("is-open");
      hamburgerBtn.setAttribute("aria-expanded", "true");
      if (hamburgerIconSwap) hamburgerIconSwap.setAttribute("data-state", "b");
    }

    function closeDropdown() {
      mobileMenu.classList.remove("is-open");
      mobileMenu.classList.add("is-closing");
      hamburgerBtn.setAttribute("aria-expanded", "false");
      if (hamburgerIconSwap) hamburgerIconSwap.setAttribute("data-state", "a");
      closeTimeout = setTimeout(function () {
        mobileMenu.classList.remove("is-closing");
      }, dropdownCloseMs);
    }

    hamburgerBtn.addEventListener("click", function () {
      var isOpen = mobileMenu.classList.contains("is-open");
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Close menu when clicking on any menu link
    var menuLinks = mobileMenu.querySelectorAll("a");
    menuLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        closeDropdown();
      });
    });
  }

  // ── Scroll Reveal Animations ──────────────────────────────────────────────
  var revealables = document.querySelectorAll(".reveal");
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!("IntersectionObserver" in window) || motion.matches) {
    revealables.forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );

    revealables.forEach(function (el) {
      observer.observe(el);
    });
  }

  // ── Interactive Hero Showcase Card ────────────────────────────────────────
  var btnPlay = document.getElementById("heroBtnPlay");
  var waveformBox = document.getElementById("heroWaveformBox");
  var timeDisplay = document.getElementById("heroTimeDisplay");
  var scrubLine = document.getElementById("heroScrubLine");
  var btnChangeKey = document.getElementById("heroBtnChangeKey");
  var keyPill = document.getElementById("heroKeyPill");
  var staffSvg = document.getElementById("heroStaffSvg");
  var heroSolfaTiles = document.querySelectorAll(".preview-col-solfa .solfa-tile");

  // Audio Play Simulation
  var isPlaying = false;
  var playTimer = null;
  var scrubTimer = null;
  var playSeconds = 12;
  var currentElapsed = 0;

  function updateSolfaBeats(second) {
    if (heroSolfaTiles.length === 0) return;
    var activeIdx = second % heroSolfaTiles.length;
    heroSolfaTiles.forEach(function (tile, idx) {
      if (idx === activeIdx) {
        tile.classList.add("is-active-beat");
      } else {
        tile.classList.remove("is-active-beat");
      }
    });
  }

  function clearSolfaBeats() {
    heroSolfaTiles.forEach(function (tile) {
      tile.classList.remove("is-active-beat");
    });
  }

  if (btnPlay && waveformBox) {
    btnPlay.addEventListener("click", function () {
      isPlaying = !isPlaying;

      // Sync with 3D Three.js scene
      if (window.NoteFusion3D && typeof window.NoteFusion3D.setPlaying === "function") {
        window.NoteFusion3D.setPlaying(isPlaying);
      }

      var heroPlayIconSwap = document.getElementById("heroPlayIconSwap");

      if (isPlaying) {
        waveformBox.classList.add("waveform-playing");
        btnPlay.classList.add("is-playing");
        if (heroPlayIconSwap) heroPlayIconSwap.setAttribute("data-state", "b");
        btnPlay.setAttribute("aria-label", "Pause playback");
        if (scrubLine) scrubLine.classList.add("is-active");

        playTimer = setInterval(function () {
          currentElapsed = (currentElapsed + 1) % (playSeconds + 1);
          var secStr = currentElapsed < 10 ? "0" + currentElapsed : "" + currentElapsed;
          if (timeDisplay) timeDisplay.textContent = "00:" + secStr;
          updateSolfaBeats(currentElapsed);
        }, 1000);

        // Smooth 60fps scrubber line animation
        var startTs = performance.now() - (currentElapsed * 1000);
        function stepScrub(now) {
          if (!isPlaying) return;
          var elapsedMs = (now - startTs) % (playSeconds * 1000);
          var pct = (elapsedMs / (playSeconds * 1000)) * 100;
          if (scrubLine) scrubLine.style.left = pct + "%";
          scrubTimer = requestAnimationFrame(stepScrub);
        }
        scrubTimer = requestAnimationFrame(stepScrub);
      } else {
        waveformBox.classList.remove("waveform-playing");
        btnPlay.classList.remove("is-playing");
        if (heroPlayIconSwap) heroPlayIconSwap.setAttribute("data-state", "a");
        btnPlay.setAttribute("aria-label", "Play recording");
        if (playTimer) clearInterval(playTimer);
        if (scrubTimer) cancelAnimationFrame(scrubTimer);
        if (scrubLine) {
          scrubLine.classList.remove("is-active");
          scrubLine.style.left = "0%";
        }
        clearSolfaBeats();
        currentElapsed = 0;
        if (timeDisplay) timeDisplay.textContent = "00:12";
      }
    });
  }

  // ── Authentic Music Engraving Constants ──────────────────────────────────
  var GONVILLE_CLEF = '<g transform="translate(10, 34) scale(7.8)" fill="currentColor">' +
    '<path d="M 1.405 -4.317 C 1.411 -4.32 1.417 -4.32 1.426 -4.32 C 1.46 -4.32 1.5 -4.291 1.558 -4.219 C 1.791 -3.951 1.956 -3.485 1.956 -3.105 C 1.956 -3.076 1.95 -3.053 1.95 -3.024 C 1.924 -2.572 1.74 -2.2 1.374 -1.849 L 1.276 -1.754 L 1.241 -1.716 L 1.241 -1.705 L 1.261 -1.619 L 1.293 -1.463 L 1.325 -1.319 C 1.368 -1.123 1.385 -1.022 1.385 -1.022 C 1.385 -1.022 1.385 -1.022 1.385 -1.022 C 1.385 -1.022 1.397 -1.022 1.411 -1.025 C 1.426 -1.025 1.472 -1.031 1.521 -1.031 C 1.555 -1.031 1.59 -1.025 1.607 -1.025 C 2.013 -0.973 2.327 -0.683 2.416 -0.274 C 2.434 -0.207 2.439 -0.135 2.439 -0.063 C 2.439 0.325 2.206 0.697 1.817 0.873 C 1.794 0.887 1.786 0.89 1.786 0.89 L 1.786 0.893 C 1.786 0.893 1.803 0.959 1.817 1.034 L 1.86 1.253 L 1.901 1.428 C 1.924 1.541 1.935 1.621 1.935 1.693 C 1.935 1.757 1.927 1.814 1.912 1.881 C 1.814 2.281 1.466 2.52 1.103 2.52 C 0.924 2.52 0.74 2.462 0.579 2.333 C 0.435 2.212 0.372 2.102 0.372 1.958 C 0.372 1.705 0.576 1.526 0.789 1.526 C 0.864 1.526 0.939 1.549 1.011 1.593 C 1.132 1.676 1.187 1.803 1.187 1.927 C 1.187 2.117 1.054 2.304 0.827 2.318 L 0.804 2.318 L 0.821 2.33 C 0.916 2.37 1.011 2.39 1.103 2.39 C 1.336 2.39 1.555 2.272 1.688 2.068 C 1.763 1.953 1.803 1.817 1.803 1.682 C 1.803 1.63 1.794 1.578 1.783 1.521 C 1.783 1.515 1.774 1.469 1.763 1.426 C 1.699 1.115 1.662 0.933 1.662 0.933 C 1.662 0.933 1.662 0.933 1.662 0.933 C 1.656 0.933 1.644 0.933 1.636 0.939 C 1.607 0.945 1.547 0.959 1.521 0.962 C 1.457 0.971 1.397 0.973 1.339 0.973 C 0.775 0.973 0.251 0.593 0.069 0.032 C 0.023 -0.118 -0.003 -0.268 -0.003 -0.418 C -0.003 -0.717 0.092 -1.011 0.276 -1.273 C 0.478 -1.558 0.68 -1.803 0.927 -2.056 L 1.014 -2.146 L 0.994 -2.252 L 0.956 -2.428 L 0.907 -2.652 C 0.893 -2.736 0.876 -2.817 0.873 -2.834 C 0.858 -2.929 0.85 -3.021 0.85 -3.116 C 0.85 -3.479 0.968 -3.828 1.189 -4.107 C 1.256 -4.193 1.374 -4.308 1.405 -4.317"/>' +
    '<path d="M 1.581 -3.747 C 1.575 -3.747 1.567 -3.747 1.558 -3.747 C 1.44 -3.747 1.287 -3.637 1.184 -3.476 C 1.077 -3.318 1.022 -3.108 1.022 -2.892 C 1.022 -2.834 1.025 -2.773 1.034 -2.713 C 1.043 -2.67 1.045 -2.641 1.068 -2.537 L 1.109 -2.356 C 1.12 -2.301 1.129 -2.258 1.129 -2.252 L 1.129 -2.252 C 1.132 -2.252 1.221 -2.35 1.25 -2.385 C 1.538 -2.71 1.711 -3.053 1.748 -3.355 C 1.751 -3.384 1.751 -3.407 1.751 -3.436 C 1.751 -3.525 1.74 -3.612 1.719 -3.658 C 1.696 -3.704 1.644 -3.741 1.581 -3.747"/>' +
    '<path d="M 1.146 -1.521 C 1.14 -1.561 1.132 -1.593 1.132 -1.598 C 1.132 -1.598 1.132 -1.598 1.129 -1.598 C 1.123 -1.598 0.999 -1.454 0.913 -1.354 C 0.766 -1.175 0.611 -0.962 0.547 -0.858 C 0.426 -0.654 0.366 -0.426 0.366 -0.202 C 0.366 -0.055 0.395 0.086 0.446 0.222 C 0.602 0.622 0.959 0.873 1.348 0.873 C 1.394 0.873 1.446 0.87 1.495 0.861 C 1.558 0.85 1.636 0.827 1.636 0.818 L 1.636 0.818 C 1.636 0.818 1.63 0.789 1.621 0.757 L 1.538 0.346 L 1.472 0.037 L 1.428 -0.176 L 1.382 -0.383 C 1.359 -0.507 1.351 -0.539 1.351 -0.539 C 1.351 -0.539 1.351 -0.541 1.348 -0.541 C 1.331 -0.541 1.238 -0.495 1.198 -0.467 C 1.048 -0.363 0.971 -0.199 0.971 -0.037 C 0.971 0.115 1.045 0.268 1.189 0.357 C 1.221 0.377 1.233 0.395 1.233 0.415 C 1.233 0.418 1.233 0.426 1.233 0.429 C 1.227 0.464 1.207 0.478 1.178 0.478 C 1.166 0.478 1.152 0.475 1.135 0.467 C 0.87 0.351 0.691 0.078 0.691 -0.222 L 0.691 -0.222 C 0.691 -0.567 0.907 -0.867 1.238 -0.985 L 1.256 -0.991 L 1.227 -1.135 L 1.146 -1.521"/>' +
    '<path d="M 1.578 -0.559 C 1.555 -0.562 1.532 -0.562 1.515 -0.562 C 1.509 -0.562 1.5 -0.562 1.495 -0.562 L 1.48 -0.562 L 1.492 -0.51 L 1.552 -0.228 L 1.59 -0.043 L 1.63 0.138 L 1.711 0.539 L 1.742 0.691 C 1.754 0.732 1.76 0.766 1.763 0.766 C 1.763 0.766 1.763 0.766 1.763 0.766 C 1.765 0.766 1.814 0.737 1.846 0.714 C 1.993 0.611 2.102 0.449 2.143 0.282 C 2.157 0.228 2.163 0.17 2.163 0.115 C 2.163 -0.219 1.915 -0.521 1.578 -0.559"/>' +
    '</g>';

  var STAFF_LINES = '<g stroke="currentColor" stroke-width="1.2">' +
    '<line x1="0" y1="10" x2="240" y2="10"/>' +
    '<line x1="0" y1="18" x2="240" y2="18"/>' +
    '<line x1="0" y1="26" x2="240" y2="26"/>' +
    '<line x1="0" y1="34" x2="240" y2="34"/>' +
    '<line x1="0" y1="42" x2="240" y2="42"/>' +
    '</g>';

  var BAR_LINES = '<line x1="228" y1="10" x2="228" y2="42" stroke="currentColor" stroke-width="1.2"/>' +
    '<line x1="233" y1="10" x2="233" y2="42" stroke="currentColor" stroke-width="2.8"/>';

  // Interactive Key Switching in Hero Card
  var KEYS = [
    {
      name: "D major",
      doh: "D",
      keySigText: "2 sharps (F♯, C♯)",
      svgContent: STAFF_LINES + GONVILLE_CLEF +
        '<text x="32" y="14" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="bold" fill="currentColor">♯</text>' +
        '<text x="40" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="bold" fill="currentColor">♯</text>' +
        '<ellipse cx="70" cy="46" rx="4.5" ry="3.2" transform="rotate(-15 70 46)" fill="currentColor"/>' +
        '<line x1="74" y1="46" x2="74" y2="18" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="42" rx="4.5" ry="3.2" transform="rotate(-15 100 42)" fill="currentColor"/>' +
        '<line x1="104" y1="42" x2="104" y2="16" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="38" rx="4.5" ry="3.2" transform="rotate(-15 130 38)" fill="currentColor"/>' +
        '<line x1="134" y1="38" x2="134" y2="14" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="34" rx="4.5" ry="3.2" transform="rotate(-15 160 34)" fill="currentColor"/>' +
        '<line x1="164" y1="34" x2="164" y2="12" stroke="currentColor" stroke-width="1.6"/>' +
        '<polygon points="74,18 164,12 164,8 74,14" fill="currentColor"/>' +
        '<ellipse cx="200" cy="30" rx="4.5" ry="3.2" transform="rotate(-15 200 30)" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<line x1="204" y1="30" x2="204" y2="10" stroke="currentColor" stroke-width="1.6"/>' +
        BAR_LINES
    },
    {
      name: "G major",
      doh: "G",
      keySigText: "1 sharp (F♯)",
      svgContent: STAFF_LINES + GONVILLE_CLEF +
        '<text x="32" y="14" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="bold" fill="currentColor">♯</text>' +
        '<ellipse cx="70" cy="34" rx="4.5" ry="3.2" transform="rotate(-15 70 34)" fill="currentColor"/>' +
        '<line x1="74" y1="34" x2="74" y2="12" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="30" rx="4.5" ry="3.2" transform="rotate(-15 100 30)" fill="currentColor"/>' +
        '<line x1="104" y1="30" x2="104" y2="10" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="26" rx="4.5" ry="3.2" transform="rotate(-15 130 26)" fill="currentColor"/>' +
        '<line x1="134" y1="26" x2="134" y2="8" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="22" rx="4.5" ry="3.2" transform="rotate(-15 160 22)" fill="currentColor"/>' +
        '<line x1="164" y1="22" x2="164" y2="6" stroke="currentColor" stroke-width="1.6"/>' +
        '<polygon points="74,12 164,6 164,2 74,8" fill="currentColor"/>' +
        '<ellipse cx="200" cy="18" rx="4.5" ry="3.2" transform="rotate(-15 200 18)" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<line x1="196" y1="18" x2="196" y2="38" stroke="currentColor" stroke-width="1.6"/>' +
        BAR_LINES
    },
    {
      name: "C major",
      doh: "C",
      keySigText: "Natural (no accidentals)",
      svgContent: STAFF_LINES + GONVILLE_CLEF +
        '<line x1="62" y1="50" x2="78" y2="50" stroke="currentColor" stroke-width="1.2"/>' +
        '<ellipse cx="70" cy="50" rx="4.5" ry="3.2" transform="rotate(-15 70 50)" fill="currentColor"/>' +
        '<line x1="74" y1="50" x2="74" y2="24" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="46" rx="4.5" ry="3.2" transform="rotate(-15 100 46)" fill="currentColor"/>' +
        '<line x1="104" y1="46" x2="104" y2="22" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="42" rx="4.5" ry="3.2" transform="rotate(-15 130 42)" fill="currentColor"/>' +
        '<line x1="134" y1="42" x2="134" y2="20" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="38" rx="4.5" ry="3.2" transform="rotate(-15 160 38)" fill="currentColor"/>' +
        '<line x1="164" y1="38" x2="164" y2="18" stroke="currentColor" stroke-width="1.6"/>' +
        '<polygon points="74,24 164,18 164,14 74,20" fill="currentColor"/>' +
        '<ellipse cx="200" cy="34" rx="4.5" ry="3.2" transform="rotate(-15 200 34)" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<line x1="204" y1="34" x2="204" y2="14" stroke="currentColor" stroke-width="1.6"/>' +
        BAR_LINES
    },
    {
      name: "F major",
      doh: "F",
      keySigText: "1 flat (B♭)",
      svgContent: STAFF_LINES + GONVILLE_CLEF +
        '<text x="32" y="26" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="bold" fill="currentColor">♭</text>' +
        '<ellipse cx="70" cy="38" rx="4.5" ry="3.2" transform="rotate(-15 70 38)" fill="currentColor"/>' +
        '<line x1="74" y1="38" x2="74" y2="14" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="34" rx="4.5" ry="3.2" transform="rotate(-15 100 34)" fill="currentColor"/>' +
        '<line x1="104" y1="34" x2="104" y2="12" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="30" rx="4.5" ry="3.2" transform="rotate(-15 130 30)" fill="currentColor"/>' +
        '<line x1="134" y1="30" x2="134" y2="10" stroke="currentColor" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="26" rx="4.5" ry="3.2" transform="rotate(-15 160 26)" fill="currentColor"/>' +
        '<line x1="164" y1="26" x2="164" y2="8" stroke="currentColor" stroke-width="1.6"/>' +
        '<polygon points="74,14 164,8 164,4 74,10" fill="currentColor"/>' +
        '<ellipse cx="200" cy="22" rx="4.5" ry="3.2" transform="rotate(-15 200 22)" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<line x1="204" y1="22" x2="204" y2="2" stroke="currentColor" stroke-width="1.6"/>' +
        BAR_LINES
    }
  ];

  var currentKeyIndex = 0;

  function popSolfaTiles() {
    var tiles = document.querySelectorAll(".solfa-tile");
    tiles.forEach(function (tile, i) {
      tile.classList.remove("solfa-pop-animate");
      void tile.offsetWidth;
      setTimeout(function () {
        tile.classList.add("solfa-pop-animate");
      }, i * 35);
    });
  }

  function cycleKey() {
    currentKeyIndex = (currentKeyIndex + 1) % KEYS.length;
    var k = KEYS[currentKeyIndex];
    if (keyPill) {
      keyPill.innerHTML = 'Key ' + k.name + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
    }
    if (staffSvg) {
      staffSvg.innerHTML = k.svgContent;
    }
    popSolfaTiles();
  }

  if (btnChangeKey) {
    btnChangeKey.addEventListener("click", cycleKey);
  }
  if (keyPill) {
    keyPill.addEventListener("click", cycleKey);
  }

  // Spotlight Section Interactive Key Buttons
  var spotlightKeyBtns = document.querySelectorAll(".key-switch-btn");
  var spotlightSolfaNote = document.getElementById("spotlightSolfaNote");
  var spotlightDohLabel = document.getElementById("spotlightDohLabel");

  if (spotlightKeyBtns.length > 0) {
    spotlightKeyBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        spotlightKeyBtns.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        var keyName = btn.dataset.key || "D";
        if (spotlightDohLabel) spotlightDohLabel.textContent = "Doh is " + keyName;
        if (spotlightSolfaNote) {
          spotlightSolfaNote.textContent = "The solfa syllables (d r m f s l t d′) remain identical to sing — only Doh moves to " + keyName + ". Instant, lossless re-labelling.";
        }
        popSolfaTiles();
      });
    });
  }

  // ── Light / Dark Mode Toggle (transitions.dev icon-swap) ──────────────────
  var themeToggleBtn = document.getElementById("themeToggleBtn");
  var mobileThemeToggleBtn = document.getElementById("mobileThemeToggleBtn");
  var themeIconSwap = document.getElementById("themeIconSwap");
  var mobileThemeIconSwap = document.getElementById("mobileThemeIconSwap");

  function syncThemeIcons(theme) {
    var state = theme === "dark" ? "b" : "a";
    if (themeIconSwap) themeIconSwap.setAttribute("data-state", state);
    if (mobileThemeIconSwap) mobileThemeIconSwap.setAttribute("data-state", state);
  }

  // Initialize icon swap state to match active theme immediately
  var activeTheme = document.documentElement.getAttribute("data-theme") || "light";
  syncThemeIcons(activeTheme);

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    syncThemeIcons(next);
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", next === "dark" ? "#08090C" : "#F7F5F0");
    try {
      localStorage.setItem("notefusion-theme", next);
    } catch (e) {}

    // Notify 3D canvas if available
    if (window.NoteFusion3D && typeof window.NoteFusion3D.setTheme === "function") {
      window.NoteFusion3D.setTheme(next);
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }
  if (mobileThemeToggleBtn) {
    mobileThemeToggleBtn.addEventListener("click", toggleTheme);
  }

  // ── Waitlist Form Submission & CTA Focus Handling ─────────────────────────
  var waitlistForm = document.getElementById("waitlistForm");
  var waitlistEmail = document.getElementById("waitlistEmail");
  var waitlistFullName = document.getElementById("waitlistFullName");
  var waitlistRole = document.getElementById("waitlistRole");
  var waitlistSource = document.getElementById("waitlistSource");
  var waitlistSubmitBtn = document.getElementById("waitlistSubmitBtn");
  var waitlistAlert = document.getElementById("waitlistAlert");
  var waitlistAlertText = document.getElementById("waitlistAlertText");
  var waitlistConflict = document.getElementById("waitlistConflict");
  var conflictEmailText = document.getElementById("conflictEmailText");
  var waitlistSuccess = document.getElementById("waitlistSuccess");
  var successEmailText = document.getElementById("successEmailText");
  var waitlistCard = document.getElementById("waitlistCard");

  var WAITLIST_API_ENDPOINT = "https://notefusion-api-3c2513a1e974.herokuapp.com/api/waitlist";

  // Smooth-scroll & focus input when any waitlist CTA is clicked
  var waitlistCtas = document.querySelectorAll('a[href="#waitlist"]');
  waitlistCtas.forEach(function (cta) {
    cta.addEventListener("click", function (e) {
      var source = cta.getAttribute("data-waitlist-source");
      if (source && waitlistSource) {
        waitlistSource.value = source;
      }
      var targetSection = document.getElementById("waitlist");
      if (targetSection) {
        e.preventDefault();
        targetSection.scrollIntoView({ behavior: "smooth", block: "center" });
        if (waitlistCard) {
          waitlistCard.classList.remove("is-pulsing");
          void waitlistCard.offsetWidth; // Trigger reflow for animation restart
          waitlistCard.classList.add("is-pulsing");
        }
        setTimeout(function () {
          if (waitlistEmail && !waitlistEmail.disabled) {
            waitlistEmail.focus();
          }
        }, 450);
      }
    });
  });

  if (waitlistForm && waitlistSubmitBtn) {
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function showAlert(msg) {
      if (waitlistAlert && waitlistAlertText) {
        waitlistAlertText.textContent = msg;
        waitlistAlert.removeAttribute("hidden");
      }
    }

    function hideAlert() {
      if (waitlistAlert) waitlistAlert.setAttribute("hidden", "");
    }

    function hideStatusCards() {
      if (waitlistConflict) waitlistConflict.setAttribute("hidden", "");
      if (waitlistSuccess) waitlistSuccess.setAttribute("hidden", "");
    }

    function setSubmitting(isSubmitting) {
      waitlistSubmitBtn.disabled = isSubmitting;
      if (isSubmitting) {
        waitlistSubmitBtn.classList.add("is-loading");
      } else {
        waitlistSubmitBtn.classList.remove("is-loading");
      }
    }

    waitlistForm.addEventListener("submit", function (e) {
      e.preventDefault();
      hideAlert();
      hideStatusCards();

      var email = waitlistEmail ? waitlistEmail.value.trim() : "";
      var fullName = waitlistFullName ? waitlistFullName.value.trim() : "";
      var role = waitlistRole ? waitlistRole.value : "";
      var source = waitlistSource ? waitlistSource.value : "landing_cta";

      if (!email || !emailRegex.test(email)) {
        showAlert("Please enter a valid email address.");
        if (waitlistEmail) waitlistEmail.focus();
        return;
      }

      setSubmitting(true);

      var payload = {
        email: email,
        name: fullName || null,
        role: role || null,
        source: source || null
      };

      fetch(WAITLIST_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        setSubmitting(false);

        if (result.ok || result.status === 200 || result.status === 201) {
          if (successEmailText) successEmailText.textContent = email;
          waitlistForm.setAttribute("hidden", "");
          if (waitlistSuccess) waitlistSuccess.removeAttribute("hidden");
          if (waitlistCard) {
            waitlistCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          return;
        }

        if (result.status === 409) {
          if (conflictEmailText) conflictEmailText.textContent = email;
          if (waitlistConflict) waitlistConflict.removeAttribute("hidden");
          return;
        }

        var errorMsg = (result.data && (result.data.message || (result.data.errors && result.data.errors[0])))
          || "Unable to join the waitlist. Please try again in a few moments.";
        showAlert(errorMsg);
      })
      .catch(function () {
        setSubmitting(false);
        showAlert("Unable to connect to the waitlist server. Please check your internet connection and try again.");
      });
    });
  }
})();
