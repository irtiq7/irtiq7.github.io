(function () {
  var c = window.GUESTBOOK || {};
  var host = document.getElementById("giscus-host");
  if (!c.categoryId) {
    var f = document.getElementById("giscus-fallback");
    if (f) f.hidden = false;
    return;
  }
  var s = document.createElement("script");
  s.src = "https://giscus.app/client.js";
  s.async = true;
  s.crossOrigin = "anonymous";
  var a = {
    repo: c.repo, "repo-id": c.repoId, category: c.category, "category-id": c.categoryId,
    mapping: "specific", term: "Guestbook", strict: "1", "reactions-enabled": "1",
    "emit-metadata": "0", "input-position": "top", theme: "preferred_color_scheme", lang: "en", loading: "lazy"
  };
  Object.keys(a).forEach(function (k) { s.setAttribute("data-" + k, a[k]); });
  host.appendChild(s);
})();
