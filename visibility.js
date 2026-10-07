// Project page gate. Loaded in the <head> of each project page.
// If projects.json says this page's project is hidden, visitors see a short notice instead of the page.
// The owner (signed in to the admin dashboard in this browser) still sees the page, with a banner.
// This is a static site, so it hides the page from visitors and listings, not from someone who fetches the raw file.
(function () {
  "use strict";
  var path = location.pathname.replace(/^\/+/, "") || "index.html";
  if (!/\.html$/.test(path)) return;
  var done = false, root = document.documentElement;
  root.style.visibility = "hidden"; // avoid a flash of the page while we check
  function reveal() { if (done) return; done = true; root.style.visibility = ""; }
  setTimeout(reveal, 1500); // never leave a blank page if projects.json is slow or missing
  var src = (document.currentScript && document.currentScript.src) || "";
  var url = src.replace(/visibility\.js.*$/, "projects.json") + "?v=" + Date.now();

  function owner() { try { return !!(sessionStorage.getItem("gh") || localStorage.getItem("gh")); } catch (e) { return false; } }
  function el(tag, text, css) { var n = document.createElement(tag); if (text) n.textContent = text; if (css) n.style.cssText = css; return n; }
  function show() {
    if (owner()) {
      var bar = el("div", null, "position:fixed;top:0;left:0;right:0;z-index:99999;padding:0.5rem 1rem;background:#fcee0a;color:#05060d;font:700 13px ui-monospace,Menlo,Consolas,monospace;text-align:center");
      bar.appendChild(document.createTextNode("Hidden project: visitors cannot see this page, only you can. "));
      var a = el("a", "Manage in the dashboard", "color:#05060d"); a.href = src.replace(/visibility\.js.*$/, "admin.html"); bar.appendChild(a);
      document.body.appendChild(bar);
    } else {
      document.title = "Not available";
      document.body.textContent = "";
      document.body.style.cssText = "margin:0;background:#0a0b14;color:#e6f1ff;font:16px ui-monospace,Menlo,Consolas,monospace";
      var box = el("main", null, "max-width:560px;margin:18vh auto;padding:0 1.5rem;line-height:1.6");
      box.appendChild(el("h1", "This project is not available", "font-size:1.4rem;margin:0 0 1rem;color:#00f0ff"));
      box.appendChild(el("p", "The owner has hidden it for now. Please check back later.", "color:#9ba8cc"));
      var home = el("a", "Back to the projects", "color:#00f0ff"); home.href = src.replace(/visibility\.js.*$/, "projects.html"); box.appendChild(home);
      document.body.appendChild(box);
    }
  }
  fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var hidden = d && Array.isArray(d.projects) && d.projects.some(function (p) { return p && p.hidden && Array.isArray(p.pages) && p.pages.indexOf(path) >= 0; });
    if (!hidden) { reveal(); return; }
    var go = function () { show(); reveal(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }).catch(reveal);
})();
