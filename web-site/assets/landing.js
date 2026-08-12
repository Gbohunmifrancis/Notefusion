/*
 * Landing page behaviour. Two things only — a border on the header once you
 * scroll, and a fade-in for sections as they arrive.
 *
 * Everything else on the page works without JavaScript: the FAQ is a native
 * <details> and the nav is anchor links. The reveal styles are scoped to
 * `html.js`, a class set inline in the <head>, so a visitor with JS disabled
 * gets the whole page unanimated rather than a stack of invisible sections.
 */

(function () {
  "use strict";

  // ── Header border on scroll ──────────────────────────────────────────────
  var header = document.getElementById("siteHeader");
  if (header) {
    var setScrolled = function () {
      header.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
    };
    setScrolled();
    window.addEventListener("scroll", setScrolled, { passive: true });
  }

  // ── Reveal on scroll ─────────────────────────────────────────────────────
  var revealables = document.querySelectorAll(".reveal");

  // Without IntersectionObserver — or with reduced motion asked for — show
  // everything immediately rather than leaving it at opacity 0 forever.
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The visitor may flip the OS setting while the page is open (and Chrome
  // desktops do it at the OS level, which arrives as a change event here). When
  // they do, everything already revealed stays revealed and everything still
  // below the fold appears rather than waiting for the observer to fire — the
  // reveal is a courtesy, not something to sit behind.
  motion.addEventListener("change", function (ev) {
    if (!ev.matches) return;
    revealables.forEach(function (el) {
      el.classList.add("is-visible");
    });
  });

  if (!("IntersectionObserver" in window) || motion.matches) {
    revealables.forEach(function (el) {
      el.classList.add("is-visible");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target); // one-way: no fade-out on scroll up
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
  );

  revealables.forEach(function (el) {
    observer.observe(el);
  });
})();
