/* The home page's key example (#solfa): pick a key and doh, and the notes under the solfa, move with it while
 * the solfa stays as it is. The header menu needs no script (a <details>); the theme toggle is site-theme.js. */
(function () {
  "use strict";
  var NOTES = {
    "D": ["D", "D", "E", "F♯", "G", "F♯", "E"],
    "G": ["G", "G", "A", "B", "C", "B", "A"],
    "C": ["C", "C", "D", "E", "F", "E", "D"],
    "F": ["F", "F", "G", "A", "B♭", "A", "G"],
    "B♭": ["B♭", "B♭", "C", "D", "E♭", "D", "C"]
  };
  var buttons = document.querySelectorAll(".rekey .segmented button");
  var doh = document.getElementById("rekey-doh");
  var row = document.getElementById("rekey-notes");
  if (!buttons.length || !doh || !row) return;
  var cells = row.querySelectorAll("td");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-key");
      var notes = NOTES[key];
      if (!notes) return;
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      doh.textContent = "Doh is " + key;
      notes.forEach(function (n, i) { if (cells[i]) cells[i].textContent = n; });
    });
  });
})();
