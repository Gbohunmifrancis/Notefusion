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

  // ── Mobile Menu Toggle ────────────────────────────────────────────────────
  var hamburgerBtn = document.getElementById("hamburgerBtn");
  var mobileMenu = document.getElementById("mobileMenu");
  if (hamburgerBtn && mobileMenu) {
    hamburgerBtn.addEventListener("click", function () {
      var isExpanded = hamburgerBtn.getAttribute("aria-expanded") === "true";
      hamburgerBtn.setAttribute("aria-expanded", !isExpanded);
      mobileMenu.classList.toggle("is-open", !isExpanded);
    });

    // Close menu when clicking on any menu link
    var menuLinks = mobileMenu.querySelectorAll("a");
    menuLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        hamburgerBtn.setAttribute("aria-expanded", "false");
        mobileMenu.classList.remove("is-open");
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
  var btnChangeKey = document.getElementById("heroBtnChangeKey");
  var keyPill = document.getElementById("heroKeyPill");
  var staffSvg = document.getElementById("heroStaffSvg");

  // Audio Play Simulation
  var isPlaying = false;
  var playTimer = null;
  var playSeconds = 12;

  if (btnPlay && waveformBox) {
    btnPlay.addEventListener("click", function () {
      isPlaying = !isPlaying;
      if (isPlaying) {
        waveformBox.classList.add("waveform-playing");
        btnPlay.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
        btnPlay.setAttribute("aria-label", "Pause playback");
        
        var current = 0;
        playTimer = setInterval(function () {
          current = (current + 1) % 13;
          var secStr = current < 10 ? "0" + current : "" + current;
          if (timeDisplay) timeDisplay.textContent = "00:" + secStr;
        }, 1000);
      } else {
        waveformBox.classList.remove("waveform-playing");
        btnPlay.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
        btnPlay.setAttribute("aria-label", "Play recording");
        if (playTimer) clearInterval(playTimer);
        if (timeDisplay) timeDisplay.textContent = "00:12";
      }
    });
  }

  // Interactive Key Switching in Hero Card
  var KEYS = [
    {
      name: "D major",
      doh: "D",
      keySigText: "2 sharps (F♯, C♯)",
      svgContent: '<g stroke="#101828" stroke-width="1.2">' +
        '<line x1="0" y1="8" x2="240" y2="8"/><line x1="0" y1="16" x2="240" y2="16"/>' +
        '<line x1="0" y1="24" x2="240" y2="24"/><line x1="0" y1="32" x2="240" y2="32"/>' +
        '<line x1="0" y1="40" x2="240" y2="40"/>' +
        '</g>' +
        '<!-- Treble Clef -->' +
        '<path d="M14 36c-2-4 1-9 4-9s3 4 1 7c-3 4-5 8-5 12 0 6 4 9 8 9 5 0 8-4 8-9 0-8-8-15-8-23 0-6 3-10 6-10s4 2 4 5c0 6-8 14-8 23v20c0 4-2 6-4 6s-3-2-3-4" fill="none" stroke="#101828" stroke-width="1.8"/>' +
        '<!-- Sharps for D major (F# and C#) -->' +
        '<text x="32" y="18" font-family="sans-serif" font-size="14" font-weight="bold" fill="#101828">♯</text>' +
        '<text x="40" y="26" font-family="sans-serif" font-size="14" font-weight="bold" fill="#101828">♯</text>' +
        '<!-- Beamed Notes -->' +
        '<ellipse cx="70" cy="36" rx="4.5" ry="3.5" transform="rotate(-15 70 36)" fill="#101828"/>' +
        '<line x1="74" y1="36" x2="74" y2="14" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="32" rx="4.5" ry="3.5" transform="rotate(-15 100 32)" fill="#101828"/>' +
        '<line x1="104" y1="32" x2="104" y2="14" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="28" rx="4.5" ry="3.5" transform="rotate(-15 130 28)" fill="#101828"/>' +
        '<line x1="134" y1="28" x2="134" y2="14" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="24" rx="4.5" ry="3.5" transform="rotate(-15 160 24)" fill="#101828"/>' +
        '<line x1="164" y1="24" x2="164" y2="14" stroke="#101828" stroke-width="1.6"/>' +
        '<polygon points="74,14 164,14 164,10 74,10" fill="#101828"/>' +
        '<!-- Half Note -->' +
        '<ellipse cx="200" cy="20" rx="4.5" ry="3.5" transform="rotate(-15 200 20)" fill="none" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="204" y1="20" x2="204" y2="4" stroke="#101828" stroke-width="1.6"/>' +
        '<!-- Bar lines -->' +
        '<line x1="230" y1="8" x2="230" y2="40" stroke="#101828" stroke-width="1.4"/>' +
        '<line x1="234" y1="8" x2="234" y2="40" stroke="#101828" stroke-width="2.8"/>'
    },
    {
      name: "G major",
      doh: "G",
      keySigText: "1 sharp (F♯)",
      svgContent: '<g stroke="#101828" stroke-width="1.2">' +
        '<line x1="0" y1="8" x2="240" y2="8"/><line x1="0" y1="16" x2="240" y2="16"/>' +
        '<line x1="0" y1="24" x2="240" y2="24"/><line x1="0" y1="32" x2="240" y2="32"/>' +
        '<line x1="0" y1="40" x2="240" y2="40"/>' +
        '</g>' +
        '<path d="M14 36c-2-4 1-9 4-9s3 4 1 7c-3 4-5 8-5 12 0 6 4 9 8 9 5 0 8-4 8-9 0-8-8-15-8-23 0-6 3-10 6-10s4 2 4 5c0 6-8 14-8 23v20c0 4-2 6-4 6s-3-2-3-4" fill="none" stroke="#101828" stroke-width="1.8"/>' +
        '<text x="32" y="18" font-family="sans-serif" font-size="14" font-weight="bold" fill="#101828">♯</text>' +
        '<ellipse cx="70" cy="28" rx="4.5" ry="3.5" transform="rotate(-15 70 28)" fill="#101828"/>' +
        '<line x1="74" y1="28" x2="74" y2="10" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="24" rx="4.5" ry="3.5" transform="rotate(-15 100 24)" fill="#101828"/>' +
        '<line x1="104" y1="24" x2="104" y2="10" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="20" rx="4.5" ry="3.5" transform="rotate(-15 130 20)" fill="#101828"/>' +
        '<line x1="134" y1="20" x2="134" y2="10" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="16" rx="4.5" ry="3.5" transform="rotate(-15 160 16)" fill="#101828"/>' +
        '<line x1="164" y1="16" x2="164" y2="10" stroke="#101828" stroke-width="1.6"/>' +
        '<polygon points="74,10 164,10 164,6 74,6" fill="#101828"/>' +
        '<ellipse cx="200" cy="12" rx="4.5" ry="3.5" transform="rotate(-15 200 12)" fill="none" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="204" y1="12" x2="204" y2="-4" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="230" y1="8" x2="230" y2="40" stroke="#101828" stroke-width="1.4"/>' +
        '<line x1="234" y1="8" x2="234" y2="40" stroke="#101828" stroke-width="2.8"/>'
    },
    {
      name: "C major",
      doh: "C",
      keySigText: "Natural (no accidentals)",
      svgContent: '<g stroke="#101828" stroke-width="1.2">' +
        '<line x1="0" y1="8" x2="240" y2="8"/><line x1="0" y1="16" x2="240" y2="16"/>' +
        '<line x1="0" y1="24" x2="240" y2="24"/><line x1="0" y1="32" x2="240" y2="32"/>' +
        '<line x1="0" y1="40" x2="240" y2="40"/>' +
        '</g>' +
        '<path d="M14 36c-2-4 1-9 4-9s3 4 1 7c-3 4-5 8-5 12 0 6 4 9 8 9 5 0 8-4 8-9 0-8-8-15-8-23 0-6 3-10 6-10s4 2 4 5c0 6-8 14-8 23v20c0 4-2 6-4 6s-3-2-3-4" fill="none" stroke="#101828" stroke-width="1.8"/>' +
        '<line x1="62" y1="44" x2="78" y2="44" stroke="#101828" stroke-width="1.2"/>' +
        '<ellipse cx="70" cy="44" rx="4.5" ry="3.5" transform="rotate(-15 70 44)" fill="#101828"/>' +
        '<line x1="74" y1="44" x2="74" y2="22" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="40" rx="4.5" ry="3.5" transform="rotate(-15 100 40)" fill="#101828"/>' +
        '<line x1="104" y1="40" x2="104" y2="22" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="36" rx="4.5" ry="3.5" transform="rotate(-15 130 36)" fill="#101828"/>' +
        '<line x1="134" y1="36" x2="134" y2="22" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="32" rx="4.5" ry="3.5" transform="rotate(-15 160 32)" fill="#101828"/>' +
        '<line x1="164" y1="32" x2="164" y2="22" stroke="#101828" stroke-width="1.6"/>' +
        '<polygon points="74,22 164,22 164,18 74,18" fill="#101828"/>' +
        '<ellipse cx="200" cy="28" rx="4.5" ry="3.5" transform="rotate(-15 200 28)" fill="none" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="204" y1="28" x2="204" y2="8" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="230" y1="8" x2="230" y2="40" stroke="#101828" stroke-width="1.4"/>' +
        '<line x1="234" y1="8" x2="234" y2="40" stroke="#101828" stroke-width="2.8"/>'
    },
    {
      name: "F major",
      doh: "F",
      keySigText: "1 flat (B♭)",
      svgContent: '<g stroke="#101828" stroke-width="1.2">' +
        '<line x1="0" y1="8" x2="240" y2="8"/><line x1="0" y1="16" x2="240" y2="16"/>' +
        '<line x1="0" y1="24" x2="240" y2="24"/><line x1="0" y1="32" x2="240" y2="32"/>' +
        '<line x1="0" y1="40" x2="240" y2="40"/>' +
        '</g>' +
        '<path d="M14 36c-2-4 1-9 4-9s3 4 1 7c-3 4-5 8-5 12 0 6 4 9 8 9 5 0 8-4 8-9 0-8-8-15-8-23 0-6 3-10 6-10s4 2 4 5c0 6-8 14-8 23v20c0 4-2 6-4 6s-3-2-3-4" fill="none" stroke="#101828" stroke-width="1.8"/>' +
        '<text x="32" y="26" font-family="sans-serif" font-size="14" font-weight="bold" fill="#101828">♭</text>' +
        '<ellipse cx="70" cy="32" rx="4.5" ry="3.5" transform="rotate(-15 70 32)" fill="#101828"/>' +
        '<line x1="74" y1="32" x2="74" y2="12" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="100" cy="28" rx="4.5" ry="3.5" transform="rotate(-15 100 28)" fill="#101828"/>' +
        '<line x1="104" y1="28" x2="104" y2="12" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="130" cy="24" rx="4.5" ry="3.5" transform="rotate(-15 130 24)" fill="#101828"/>' +
        '<line x1="134" y1="24" x2="134" y2="12" stroke="#101828" stroke-width="1.6"/>' +
        '<ellipse cx="160" cy="20" rx="4.5" ry="3.5" transform="rotate(-15 160 20)" fill="#101828"/>' +
        '<line x1="164" y1="20" x2="164" y2="12" stroke="#101828" stroke-width="1.6"/>' +
        '<polygon points="74,12 164,12 164,8 74,8" fill="#101828"/>' +
        '<ellipse cx="200" cy="16" rx="4.5" ry="3.5" transform="rotate(-15 200 16)" fill="none" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="204" y1="16" x2="204" y2="0" stroke="#101828" stroke-width="1.6"/>' +
        '<line x1="230" y1="8" x2="230" y2="40" stroke="#101828" stroke-width="1.4"/>' +
        '<line x1="234" y1="8" x2="234" y2="40" stroke="#101828" stroke-width="2.8"/>'
    }
  ];

  var currentKeyIndex = 0;

  function cycleKey() {
    currentKeyIndex = (currentKeyIndex + 1) % KEYS.length;
    var k = KEYS[currentKeyIndex];
    if (keyPill) {
      keyPill.innerHTML = 'Key ' + k.name + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
    }
    if (staffSvg) {
      staffSvg.innerHTML = k.svgContent;
    }
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
      });
    });
  }
})();
