// Shows an "Edit this page" button, only when the owner is signed in to the dashboard in this browser.
(function () {
  var has = false;
  try { has = !!(sessionStorage.getItem("gh") || localStorage.getItem("gh")); } catch (e) {}
  if (!has) return;
  var path = location.pathname.replace(/^\/+/, "");
  if (!path || path.slice(-1) === "/") path += "index.html";
  if (!/\.[a-z0-9]+$/i.test(path)) path += ".html";
  var q;
  if (/(^|\/)article\.html$/.test(path)) {
    var slug = new URLSearchParams(location.search).get("p") || "";
    q = /^[a-z0-9-]+$/.test(slug) ? "article=" + encodeURIComponent(slug) : "edit=" + encodeURIComponent(path);
  } else {
    q = "edit=" + encodeURIComponent(path);
  }
  var src = (document.currentScript && document.currentScript.src) || "";
  var admin = src.replace(/edit-link\.js.*$/, "admin.html");
  var a = document.createElement("a");
  a.className = "edit-fab";
  a.href = admin + "?" + q;
  a.textContent = "✎ Edit this page";
  document.body.appendChild(a);
})();
