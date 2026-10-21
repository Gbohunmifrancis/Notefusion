/* The Library by date (board n-ux-low V2b): Today, This week (the six days before it), Earlier, by when each sheet was
 * made, on the reader's own calendar. Only the groups that have sheets; within each, the order the list came in
 * (newest first). A sheet with no readable date goes under Earlier, and one from a clock ahead of ours under Today.
 */
(function () {
  "use strict";

  var GROUPS = [
    { key: "today", title: "Today" },
    { key: "week", title: "This week" },
    { key: "earlier", title: "Earlier" }
  ];

  /** Whole days from the day of `then` to the day of `now`, on the local calendar (a clock change is not a day). */
  function daysBefore(then, now) {
    var a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((b - a) / 864e5);
  }

  /** "today", "week" or "earlier" for a sheet made at `iso`. */
  function groupOf(iso, now) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return "earlier";
    var days = daysBefore(d, now || new Date());
    return days <= 0 ? "today" : days <= 6 ? "week" : "earlier";
  }

  /** The sheets in their groups: [{ key, title, items }], in the order Today, This week, Earlier, empty ones left out. */
  function group(items, now) {
    now = now || new Date();
    var by = {};
    (items || []).forEach(function (it) {
      var k = groupOf(it && it.createdAtUtc, now);
      (by[k] = by[k] || []).push(it);
    });
    return GROUPS.filter(function (g) { return by[g.key]; }).map(function (g) { return { key: g.key, title: g.title, items: by[g.key] }; });
  }

  window.NfLibraryGroups = { group: group, groupOf: groupOf };
})();
