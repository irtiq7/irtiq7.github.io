// Project list logic shared by the admin dashboard and the tests.
// projects.json is the source of truth. From it we generate, between markers, the Projects page, the project lines
// in llms.txt, and Disallow lines in robots.txt for hidden pages. No DOM here, so it can run in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProjectsLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var SITE = "https://irtiq7.github.io/";
  var HTML_START = "<!-- projects:start -->", HTML_END = "<!-- projects:end -->";
  var LLMS_START = "<!-- projects:llms:start -->", LLMS_END = "<!-- projects:llms:end -->";

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function stripTags(h) { return String(h).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "project"; }
  // Only same-site relative links: page.html, page.html?x=1 or folder/page.html
  function safeUrl(u) { u = String(u || "").trim(); return /^[A-Za-z0-9_\-\/]+(\.html)?(\?[A-Za-z0-9_\-=&.]*)?$/.test(u) && u.indexOf("..") < 0 ? u : ""; }
  function safePage(p) { p = String(p || "").trim(); return /^[A-Za-z0-9_\-\/]+\.html$/.test(p) && p.indexOf("..") < 0 ? p : ""; }

  // Clean a projects.json document, or return null if it is unusable
  function validate(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.projects)) return null;
    var seen = {}, out = [];
    d.projects.slice(0, 200).forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var title = String(p.title || "").trim().slice(0, 120), url = safeUrl(p.url);
      if (!title || !url) return;
      var id = String(p.id || slug(title)).replace(/[^a-z0-9-]/g, "").slice(0, 50) || slug(title);
      while (seen[id]) id += "-2";
      seen[id] = 1;
      out.push({
        id: id, title: title, url: url,
        pages: (Array.isArray(p.pages) ? p.pages : []).map(safePage).filter(Boolean).slice(0, 10),
        summary_html: String(p.summary_html || "").slice(0, 2000),
        llms: p.llms ? String(p.llms).replace(/\s+/g, " ").trim().slice(0, 600) : null,
        hidden: !!p.hidden
      });
    });
    return { note: d.note || "", projects: out };
  }

  function between(text, start, end) {
    var a = text.indexOf(start), b = text.indexOf(end);
    return a < 0 || b < a ? null : { a: a + start.length, b: b };
  }
  // The visible projects as list items for projects.html
  function renderHtml(projects) {
    return projects.filter(function (p) { return !p.hidden; }).map(function (p) {
      return '        <li><h3><a href="' + esc(p.url) + '">' + esc(p.title) + '</a></h3><div>\n          <p>' + p.summary_html + '</p></div></li>';
    }).join("\n");
  }
  function applyHtml(page, projects) {
    var r = between(page, HTML_START, HTML_END); if (!r) return null;
    var body = renderHtml(projects);
    return page.slice(0, r.a) + "\n" + (body ? body + "\n        " : "        ") + page.slice(r.b);
  }
  // Lines for llms.txt: only visible projects that have a description for agents
  function renderLlms(projects) {
    return projects.filter(function (p) { return !p.hidden && p.llms; }).map(function (p) { return "- [" + p.title.replace(/[\[\]]/g, "") + "](" + SITE + p.url + "): " + p.llms; }).join("\n");
  }
  function applyLlms(text, projects) {
    var r = between(text, LLMS_START, LLMS_END); if (!r) return null;
    var body = renderLlms(projects);
    return text.slice(0, r.a) + "\n" + (body ? body + "\n" : "") + text.slice(r.b);
  }
  // robots.txt: every group that disallows /admin.html also disallows the hidden pages
  function applyRobots(text, projects) {
    var all = {}, hidden = [];
    projects.forEach(function (p) { p.pages.forEach(function (pg) { all["/" + pg] = 1; if (p.hidden && hidden.indexOf("/" + pg) < 0) hidden.push("/" + pg); }); });
    var nl = /\r\n/.test(text) ? "\r\n" : "\n", out = [], found = false;
    text.split(/\r?\n/).forEach(function (line) {
      var m = /^Disallow:\s*(\S+)\s*$/i.exec(line);
      if (m && all[m[1]]) return; // managed line, rewritten below
      out.push(line);
      if (m && m[1] === "/admin.html") { found = true; hidden.forEach(function (h) { out.push("Disallow: " + h); }); }
    });
    var res = out.join(nl);
    if (!found && hidden.length) res = res.replace(/\s*$/, "") + nl + nl + "User-agent: *" + nl + hidden.map(function (h) { return "Disallow: " + h; }).join(nl) + nl;
    return res;
  }
  // A short sentence describing a change set, for the commit message
  function describe(before, after) {
    var b = {}; before.forEach(function (p) { b[p.id] = p; });
    var parts = [];
    after.forEach(function (p) {
      if (!b[p.id]) parts.push("add " + p.title); else if (b[p.id].hidden !== p.hidden) parts.push((p.hidden ? "hide " : "show ") + p.title);
    });
    before.forEach(function (p) { if (!after.some(function (q) { return q.id === p.id; })) parts.push("remove " + p.title); });
    if (!parts.length && JSON.stringify(before.map(function (p) { return p.id; })) !== JSON.stringify(after.map(function (p) { return p.id; }))) parts.push("reorder");
    return parts.join(", ") || "update";
  }
  // Read the current Projects page into a projects.json document (used once, to migrate)
  function parseProjectsHtml(page) {
    var out = [], re = /<li><h3><a href="([^"]+)">([^<]+)<\/a><\/h3><div>\s*<p>([\s\S]*?)<\/p><\/div><\/li>/g, m;
    while ((m = re.exec(page))) out.push({ title: m[2].replace(/&amp;/g, "&"), url: m[1], summary_html: m[3].trim() });
    return out;
  }

  return { HTML_START: HTML_START, HTML_END: HTML_END, LLMS_START: LLMS_START, LLMS_END: LLMS_END, esc: esc, stripTags: stripTags, slug: slug, safeUrl: safeUrl, safePage: safePage,
    validate: validate, renderHtml: renderHtml, applyHtml: applyHtml, renderLlms: renderLlms, applyLlms: applyLlms, applyRobots: applyRobots, describe: describe, parseProjectsHtml: parseProjectsHtml };
});
