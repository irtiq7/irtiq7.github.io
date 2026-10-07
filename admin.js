(function () {
  "use strict";
  var REPO = "irtiq7/irtiq7.github.io", BR = "main";
  var $ = function (id) { return document.getElementById(id); };
  var token = "";
  try { token = sessionStorage.getItem("gh") || localStorage.getItem("gh") || ""; } catch (e) {}

  // ---------- GitHub helpers
  function gh(path, opts) {
    opts = opts || {};
    return fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || r.status); return j; });
    });
  }
  function enc(s) { return btoa(unescape(encodeURIComponent(s))); }
  function dec(b) { return decodeURIComponent(escape(atob(b.replace(/\n/g, "")))); }
  function getFile(path) {
    return gh("/repos/" + REPO + "/contents/" + path + "?ref=" + BR + "&t=" + Date.now())
      .then(function (f) { return { sha: f.sha, text: dec(f.content) }; })
      .catch(function (e) { if (/Not Found/i.test(e.message)) return null; throw e; });
  }
  function putFile(path, content64, msg, sha) {
    var body = { message: msg, content: content64, branch: BR };
    if (sha) body.sha = sha;
    return gh("/repos/" + REPO + "/contents/" + path, { method: "PUT", body: body });
  }
  function putText(path, text, msg, sha) { return putFile(path, enc(text), msg, sha); }
  function status(msg, bad) { var s = $("status"); s.textContent = msg; s.className = bad ? "gb-error" : "gb-ok"; s.hidden = !msg; }
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function slugify(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }

  // ---------- login
  function showApp(user) {
    $("login").hidden = true; $("app").hidden = false;
    $("who").textContent = "Signed in as " + user;
    var q = new URLSearchParams(location.search), art = q.get("article"), file = q.get("edit");
    loadPosts().then(function () {
      if (art && /^[a-z0-9-]+$/.test(art)) {
        var p = posts.filter(function (x) { return x.slug === art; })[0];
        if (p) editPost(p); else status("Article not found.", true);
      } else if (file && /^[A-Za-z0-9_\-.\/]+$/.test(file) && file.indexOf("..") < 0) {
        showTab("files"); openFile(file);
      }
    });
  }
  function tryLogin(t, remember) {
    token = t.trim();
    return gh("/repos/" + REPO).then(function (r) {
      if (!r.permissions || !r.permissions.push) throw new Error("This token cannot write to " + REPO + ".");
      return gh("/user");
    }).then(function (u) {
      try { sessionStorage.setItem("gh", token); if (remember) localStorage.setItem("gh", token); } catch (e) {}
      showApp(u.login);
    });
  }
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    $("login-error").hidden = true;
    tryLogin($("token").value, $("remember").checked).catch(function (err) {
      token = ""; $("login-error").textContent = "Sign-in failed: " + err.message; $("login-error").hidden = false;
    });
  });
  $("logout").addEventListener("click", function () {
    try { sessionStorage.removeItem("gh"); localStorage.removeItem("gh"); } catch (e) {}
    location.reload();
  });
  if (token) tryLogin(token, false).catch(function () { token = ""; });

  // ---------- tabs
  var tabs = document.querySelectorAll("[data-tab]");
  function showTab(name) {
    Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("on", x.dataset.tab === name); });
    ["articles", "guestbook", "files", "projects", "analytics"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    status("");
    if (name === "guestbook") loadIssues();
    if (name === "files") loadTree();
    if (name === "projects") loadProjects();
    if (name === "analytics") loadAnalytics();
  }
  Array.prototype.forEach.call(tabs, function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });

  // ---------- articles
  var posts = [];
  function loadPosts() {
    return getFile("posts/index.json").then(function (f) {
      posts = f ? JSON.parse(f.text) : [];
      var ul = $("post-list"); ul.textContent = "";
      if (!posts.length) ul.appendChild(el("li", "No articles yet."));
      posts.forEach(function (p) {
        var li = document.createElement("li");
        li.appendChild(el("strong", p.title));
        li.appendChild(el("span", " · " + p.date, "pub-venue"));
        var e = el("button", "Edit", "mini"); e.type = "button"; e.onclick = function () { editPost(p); };
        var d = el("button", "Delete", "mini danger"); d.type = "button"; d.onclick = function () { delPost(p); };
        li.appendChild(e); li.appendChild(d); ul.appendChild(li);
      });
    }).catch(function (e) { status(e.message, true); });
  }
  var editing = null;
  function resetEditor() {
    editing = null; $("p-title").value = ""; $("p-slug").value = ""; $("p-slug").disabled = false;
    $("p-date").value = new Date().toISOString().slice(0, 10); $("p-summary").value = ""; $("p-body").value = ""; preview();
    $("editor-head").textContent = "New article";
  }
  function editPost(p) {
    getFile("posts/" + p.slug + ".md").then(function (f) {
      editing = p; $("p-title").value = p.title; $("p-slug").value = p.slug; $("p-slug").disabled = true;
      $("p-date").value = p.date; $("p-summary").value = p.summary || ""; $("p-body").value = f ? f.text : ""; preview();
      $("editor-head").textContent = "Edit article"; $("editor-head").scrollIntoView();
    }).catch(function (e) { status(e.message, true); });
  }
  function delPost(p) {
    if (!confirm("Delete \"" + p.title + "\"?")) return;
    getFile("posts/" + p.slug + ".md").then(function (f) {
      return f && gh("/repos/" + REPO + "/contents/posts/" + p.slug + ".md", { method: "DELETE", body: { message: "Admin: delete article " + p.slug, sha: f.sha, branch: BR } });
    }).then(function () { return updateIndex(function (list) { return list.filter(function (x) { return x.slug !== p.slug; }); }, "delete " + p.slug); })
      .then(function () { status("Deleted. The site updates in a minute or two."); loadPosts(); })
      .catch(function (e) { status(e.message, true); });
  }
  function updateIndex(fn, label) {
    return getFile("posts/index.json").then(function (f) {
      var list = fn(f ? JSON.parse(f.text) : []);
      list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      return putText("posts/index.json", JSON.stringify(list, null, 2) + "\n", "Admin: update article index (" + label + ")", f && f.sha);
    });
  }
  function preview() {
    var md = $("p-body").value;
    $("p-preview").innerHTML = window.DOMPurify && window.marked ? DOMPurify.sanitize(marked.parse(md)) : "";
  }
  $("p-body").addEventListener("input", preview);
  $("p-title").addEventListener("input", function () { if (!editing) $("p-slug").value = slugify($("p-title").value); });
  $("p-new").addEventListener("click", resetEditor);
  $("p-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var slug = $("p-slug").value.trim();
    if (!/^[a-z0-9-]+$/.test(slug)) return status("Slug may only contain a-z, 0-9 and hyphens.", true);
    var entry = { slug: slug, title: $("p-title").value.trim(), date: $("p-date").value, summary: $("p-summary").value.trim() };
    $("p-save").disabled = true; status("Publishing…");
    getFile("posts/" + slug + ".md").then(function (f) {
      if (f && !editing) throw new Error("An article with this slug already exists.");
      return putText("posts/" + slug + ".md", $("p-body").value, "Admin: " + (editing ? "edit" : "add") + " article " + slug, f && f.sha);
    }).then(function () {
      return updateIndex(function (l) { return l.filter(function (x) { return x.slug !== slug; }).concat([entry]); }, slug);
    }).then(function () { status("Published. The site updates in a minute or two."); resetEditor(); loadPosts(); })
      .catch(function (err) { status(err.message, true); })
      .then(function () { $("p-save").disabled = false; });
  });
  $("p-image").addEventListener("change", function () {
    var file = this.files[0]; if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return status("Use a PNG, JPG, GIF or WebP image.", true);
    if (file.size > 3 * 1024 * 1024) return status("Image is over 3 MB.", true);
    var name = Date.now() + "-" + slugify(file.name.replace(/\.[^.]+$/, "")) + "." + file.type.split("/")[1].replace("jpeg", "jpg");
    var r = new FileReader();
    r.onload = function () {
      status("Uploading image…");
      putFile("images/posts/" + name, r.result.split(",")[1], "Admin: upload image " + name).then(function () {
        var ta = $("p-body"); ta.value += "\n\n![" + file.name + "](images/posts/" + name + ")\n"; preview(); status("Image added.");
      }).catch(function (e) { status(e.message, true); });
    };
    r.readAsDataURL(file); this.value = "";
  });
  resetEditor();

  // ---------- guestbook moderation
  function loadIssues() {
    var ul = $("issue-list"); ul.textContent = "";
    ul.appendChild(el("li", "Loading…"));
    gh("/repos/" + REPO + "/issues?state=open&per_page=100").then(function (all) {
      ul.textContent = "";
      var items = all.filter(function (i) { return !i.pull_request; });
      if (!items.length) ul.appendChild(el("li", "No open issues."));
      items.forEach(function (i) {
        var approved = i.labels.some(function (l) { return l.name === "approved"; });
        var li = document.createElement("li");
        var a = el("a", i.title); a.href = i.html_url; a.rel = "noopener"; li.appendChild(a);
        li.appendChild(el("p", (approved ? "APPROVED · " : "PENDING · ") + "by " + i.user.login + " · " + i.created_at.slice(0, 10), "pub-venue"));
        li.appendChild(el("p", (i.body || "").slice(0, 600)));
        if (!approved) {
          var ok = el("button", "Approve", "mini"); ok.type = "button";
          ok.onclick = function () {
            gh("/repos/" + REPO + "/issues/" + i.number + "/labels", { method: "POST", body: { labels: ["approved"] } })
              .then(function () { return gh("/repos/" + REPO + "/issues/" + i.number + "/labels/pending", { method: "DELETE" }).catch(function () {}); })
              .then(loadIssues).catch(function (e) { status(e.message, true); });
          };
          li.appendChild(ok);
        }
        var no = el("button", approved ? "Unpublish & close" : "Reject (close)", "mini danger"); no.type = "button";
        no.onclick = function () { gh("/repos/" + REPO + "/issues/" + i.number, { method: "PATCH", body: { state: "closed", state_reason: "not_planned" } }).then(loadIssues).catch(function (e) { status(e.message, true); }); };
        li.appendChild(no); ul.appendChild(li);
      });
    }).catch(function (e) { status(e.message, true); });
  }
  $("new-question").addEventListener("click", function () {
    var q = prompt("Your question for visitors to answer:"); if (!q || q.trim().length < 5) return;
    gh("/repos/" + REPO + "/issues", { method: "POST", body: { title: "[Question] " + q.trim().slice(0, 100), body: q.trim(), labels: ["approved"] } })
      .then(function () { status("Question posted."); loadIssues(); }).catch(function (e) { status(e.message, true); });
  });

  // ---------- projects: hide, show, reorder, add and remove; the Projects page, llms.txt and robots.txt are generated from projects.json
  var PL = window.ProjectsLib, projBase = [], projEdit = [], projSha = null, projNote = "";
  function projDirty() { return JSON.stringify(projEdit) !== JSON.stringify(projBase); }
  function loadProjects() {
    return getFile("projects.json").then(function (f) {
      var ul = $("proj-list"); ul.textContent = "";
      if (!f) { ul.appendChild(el("li", "projects.json was not found in the repository.")); return; }
      var d = PL.validate(JSON.parse(f.text));
      if (!d) throw new Error("projects.json is not a valid project list.");
      projBase = d.projects; projEdit = JSON.parse(JSON.stringify(projBase)); projSha = f.sha; projNote = d.note; renderProjects();
    }).catch(function (e) { status(e.message, true); });
  }
  function renderProjects() {
    var ul = $("proj-list"); ul.textContent = "";
    if (!projEdit.length) ul.appendChild(el("li", "No projects yet. Add one below."));
    projEdit.forEach(function (p, i) {
      var li = document.createElement("li"), a = el("a", p.title); a.href = p.url; a.target = "_blank"; a.rel = "noopener";
      var head = el("strong"); head.appendChild(a);
      li.appendChild(head); li.appendChild(el("span", p.hidden ? "  HIDDEN" : "  visible", p.hidden ? "pj-badge pj-hidden" : "pj-badge"));
      li.appendChild(el("p", PL.stripTags(p.summary_html).slice(0, 160), "pub-venue"));
      function btn(label, cls, fn, aria) { var b = el("button", label, "mini" + (cls ? " " + cls : "")); b.type = "button"; if (aria) b.setAttribute("aria-label", aria); b.addEventListener("click", fn); li.appendChild(b); return b; }
      btn(p.hidden ? "Show" : "Hide", "", function () { p.hidden = !p.hidden; renderProjects(); });
      btn("↑", "", function () { if (i > 0) { projEdit.splice(i - 1, 0, projEdit.splice(i, 1)[0]); renderProjects(); } }, "Move " + p.title + " up").disabled = i === 0;
      btn("↓", "", function () { if (i < projEdit.length - 1) { projEdit.splice(i + 1, 0, projEdit.splice(i, 1)[0]); renderProjects(); } }, "Move " + p.title + " down").disabled = i === projEdit.length - 1;
      btn("Delete", "danger", function () { if (confirm("Remove \"" + p.title + "\" from the list? (Its page file is not deleted.)")) { projEdit.splice(i, 1); renderProjects(); } });
      ul.appendChild(li);
    });
    var dirty = projDirty();
    $("proj-save").disabled = $("proj-discard").disabled = !dirty; $("proj-dirty").hidden = !dirty;
  }
  $("proj-discard").addEventListener("click", function () { projEdit = JSON.parse(JSON.stringify(projBase)); renderProjects(); status(""); });
  $("proj-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("pj-title").value.trim(), url = $("pj-url").value.trim(), summary = $("pj-summary").value.trim();
    var pages = $("pj-pages").value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (!pages.length && /\.html$/.test(url)) pages = [url];
    if (!PL.safeUrl(url)) return status("The link must be a page on this site, such as my-demo.html (letters, numbers, - and _).", true);
    if (pages.some(function (x) { return !PL.safePage(x); })) return status("Each page must be a file name ending in .html.", true);
    var next = PL.validate({ projects: projEdit.concat([{ title: title, url: url, pages: pages, summary_html: PL.esc(summary), llms: $("pj-llms").checked ? summary : null, hidden: false }]) });
    if (!next || next.projects.length !== projEdit.length + 1) return status("That project could not be added. Check the title and link.", true);
    projEdit = next.projects; this.reset(); $("pj-llms").checked = true; renderProjects(); status("Added to the list. Press Save changes to publish it.");
  });
  // Write projects.json first (the source of truth), then the pages generated from it
  function publishProjects() {
    var data = PL.validate({ note: projNote, projects: projEdit });
    if (!data) return status("The project list is not valid.", true);
    status("Saving…");
    return Promise.all([getFile("projects.html"), getFile("llms.txt"), getFile("robots.txt")]).then(function (r) {
      var html = r[0] && PL.applyHtml(r[0].text, data.projects), llms = r[1] && PL.applyLlms(r[1].text, data.projects), robots = r[2] ? PL.applyRobots(r[2].text, data.projects) : null;
      if (!html) throw new Error("projects.html has lost its <!-- projects:start --> markers, so nothing was changed.");
      if (!llms) throw new Error("llms.txt has lost its <!-- projects:llms:start --> markers, so nothing was changed.");
      var msg = "Admin: projects (" + PL.describe(projBase, data.projects) + ")", json = JSON.stringify(data, null, 2) + "\n", steps = [];
      if (projDirty()) steps.push(function () { return putText("projects.json", json, msg, projSha); });
      if (html !== r[0].text) steps.push(function () { return putText("projects.html", html, msg, r[0].sha); });
      if (llms !== r[1].text) steps.push(function () { return putText("llms.txt", llms, msg, r[1].sha); });
      if (robots != null && robots !== r[2].text) steps.push(function () { return putText("robots.txt", robots, msg, r[2].sha); });
      return steps.reduce(function (p, s) { return p.then(s); }, Promise.resolve()).then(function () { return steps.length; });
    }).then(function (n) { status(n ? "Saved. The site updates in a minute or two." : "Everything is already up to date."); return loadProjects(); })
      .catch(function (e) { status(e.message, true); });
  }
  $("proj-save").addEventListener("click", publishProjects);
  $("proj-sync").addEventListener("click", publishProjects);

  // ---------- analytics
  var OWNER = REPO.split("/")[0];
  var AI_REFERRERS = /^(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|gemini\.google\.com|bard\.google\.com|chat\.deepseek\.com|deepseek\.com|grok\.com|meta\.ai|chat\.mistral\.ai|poe\.com|phind\.com|you\.com)$/i;
  var EVENT_NAMES = { WatchEvent: "star", ForkEvent: "fork", IssuesEvent: "issue", IssueCommentEvent: "comment", PushEvent: "push", PullRequestEvent: "pull request", CreateEvent: "create", DeleteEvent: "delete", ReleaseEvent: "release" };
  var lastTraffic = null;

  function pages(path, max) {
    var out = [];
    function next(p) {
      return gh(path + (path.indexOf("?") < 0 ? "?" : "&") + "per_page=100&page=" + p).then(function (batch) {
        out = out.concat(batch);
        return batch.length === 100 && p < max ? next(p + 1) : out;
      });
    }
    return next(1);
  }
  // Reads the "Posted-by / Agent / Model / Consent" disclosure lines, wherever they sit in the body.
  function disclosure(body) {
    var d = {};
    (body || "").replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
      var m = /^\s*(Posted-by|Agent|Model|Consent|Operator)\s*:\s*(.*?)\s*$/i.exec(line);
      if (m && !d[m[1].toLowerCase()]) d[m[1].toLowerCase()] = /^(\.\.\.|<.*>)?$/.test(m[2]) ? "" : m[2];
    });
    return d;
  }
  function classify(item) {
    var d = disclosure(item.body), login = item.user ? item.user.login : "";
    // Web-form posts are filed by the Worker under the owner's token, so the disclosure line wins over the login.
    var kind = /agent/i.test(d["posted-by"] || "") ? "agent"
      : /human/i.test(d["posted-by"] || "") ? "human"
      : (item.user && item.user.type === "Bot") || /\[bot\]$/.test(login) ? "bot"
      : login === OWNER ? "you" : "human";
    return { kind: kind, d: d, login: login };
  }
  function fmtDay(iso) { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
  function num(n) { return Number(n).toLocaleString("en-US"); }
  function tiles(list) {
    var box = el("div", null, "stat-tiles");
    list.forEach(function (t) {
      var d = el("div", null, "stat-tile");
      d.appendChild(el("p", t[0], "stat-label")); d.appendChild(el("p", num(t[1]), "stat-value"));
      if (t[2]) d.appendChild(el("p", t[2], "stat-sub"));
      box.appendChild(d);
    });
    return box;
  }
  // rows: arrays of strings or DOM nodes
  function table(head, rows, empty) {
    var wrap = el("div", null, "table-wrap"), t = el("table", null, "data-table"), tr = document.createElement("tr");
    head.forEach(function (h) { tr.appendChild(el("th", h)); });
    var thead = document.createElement("thead"); thead.appendChild(tr); t.appendChild(thead);
    var tb = document.createElement("tbody");
    if (!rows.length) { var r0 = document.createElement("tr"), c0 = el("td", empty || "Nothing yet."); c0.colSpan = head.length; r0.appendChild(c0); tb.appendChild(r0); }
    rows.forEach(function (r) {
      var row = document.createElement("tr");
      r.forEach(function (c) { var td = document.createElement("td"); if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? "" : c; row.appendChild(td); });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }
  function linkTo(href, text) { var a = el("a", text); a.href = href; a.rel = "noopener"; return a; }
  function panel(id, nodes) { var p = $(id); p.textContent = ""; nodes.forEach(function (n) { p.appendChild(n); }); }

  function loadAnalytics() {
    var box = $("tab-analytics");
    if (box.dataset.loaded) box.classList.add("refreshing"); // keep the previous render while refetching
    else ["an-agents", "an-bots", "an-traffic"].forEach(function (id) { panel(id, [el("p", "Loading…")]); });
    Promise.all([loadAgents(), loadBots(), loadTraffic()]).then(function () {
      box.dataset.loaded = "1"; box.classList.remove("refreshing");
    });
  }
  $("an-refresh").addEventListener("click", loadAnalytics);

  function loadAgents() {
    return Promise.all([pages("/repos/" + REPO + "/issues?state=all", 5), pages("/repos/" + REPO + "/issues/comments", 5)]).then(function (x) {
      var posts = [];
      x[0].filter(function (i) { return !i.pull_request; }).forEach(function (i) {
        var approved = i.labels.some(function (l) { return l.name === "approved"; });
        posts.push({ c: classify(i), at: i.created_at, url: i.html_url, what: "issue", status: approved ? "approved" : i.state === "closed" ? "closed" : "pending" });
      });
      x[1].forEach(function (c) { posts.push({ c: classify(c), at: c.created_at, url: c.html_url, what: "comment", status: "comment" }); });
      var count = function (k) { return posts.filter(function (p) { return p.c.kind === k; }).length; };
      var agents = posts.filter(function (p) { return p.c.kind === "agent"; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      var groups = {};
      agents.forEach(function (p) {
        var name = p.c.d.agent || "unknown agent", model = p.c.d.model || "unknown model", k = name + "\u0000" + model;
        var g = groups[k] || (groups[k] = { name: name, model: model, n: 0, first: p.at, last: p.at, approved: 0, other: 0 });
        g.n++; if (p.at < g.first) g.first = p.at; if (p.at > g.last) g.last = p.at;
        if (p.status === "approved") g.approved++; else g.other++;
      });
      var distinct = function (key) { return Object.keys(agents.reduce(function (s, p) { s[(p.c.d[key] || "unknown").toLowerCase()] = 1; return s; }, {})).length; };
      panel("an-agents", [
        tiles([["AI agent posts", agents.length, "issues and comments with Posted-by: AI agent"], ["Distinct agents", distinct("agent")], ["Distinct models", distinct("model")],
          ["Bot-account posts", count("bot")], ["Human posts", count("human"), num(count("you")) + " more by you"]]),
        table(["Agent", "Model", "Posts", "Approved", "Pending, closed or comment", "First seen", "Last seen"],
          Object.keys(groups).map(function (k) { var g = groups[k]; return [g.name, g.model, num(g.n), num(g.approved), num(g.other), fmtDay(g.first), fmtDay(g.last)]; })
            .sort(function (a, b) { return Number(b[2].replace(/,/g, "")) - Number(a[2].replace(/,/g, "")); }),
          "No self-identified AI agents yet."),
        el("h4", "Recent agent activity"),
        table(["Date", "Agent", "Model", "Consent", "Type", "Link"],
          agents.slice(0, 15).map(function (p) { return [fmtDay(p.at), p.c.d.agent || "unknown", p.c.d.model || "unknown", p.c.d.consent || "not stated", p.what + " · " + p.status, linkTo(p.url, "Open →")]; }),
          "No agent posts yet.")
      ]);
    }).catch(function (e) { panel("an-agents", [el("p", "Could not load posts: " + e.message, "gb-error")]); });
  }

  function loadBots() {
    return pages("/repos/" + REPO + "/events", 3).then(function (events) {
      var bots = {};
      events.forEach(function (ev) {
        var login = ev.actor && ev.actor.login;
        if (!login || !/\[bot\]$/.test(login) || login === "github-actions[bot]") return;
        var b = bots[login] || (bots[login] = { types: {}, last: ev.created_at });
        var t = EVENT_NAMES[ev.type] || ev.type; b.types[t] = (b.types[t] || 0) + 1;
        if (ev.created_at > b.last) b.last = ev.created_at;
      });
      panel("an-bots", [
        el("p", "Accounts whose name ends in [bot] that starred, forked, commented on or changed the repository. Your own snapshot workflow (github-actions[bot]) is left out.", "pub-venue"),
        table(["Account", "Activity", "Last seen"], Object.keys(bots).map(function (login) {
          var b = bots[login];
          return [login, Object.keys(b.types).map(function (t) { return t + " ×" + b.types[t]; }).join(", "), fmtDay(b.last)];
        }), "No bot accounts in the last 90 days.")
      ]);
    }).catch(function (e) { panel("an-bots", [el("p", "Could not load events: " + e.message, "gb-error")]); });
  }

  function loadTraffic() {
    var base = "/repos/" + REPO + "/traffic/";
    return Promise.all([gh(base + "views"), gh(base + "clones"), gh(base + "popular/referrers"), gh(base + "popular/paths")]).then(function (x) {
      lastTraffic = { views: x[0], clones: x[1], referrers: x[2], paths: x[3] };
      renderTraffic();
    }).catch(function (e) {
      panel("an-traffic", [el("p", "Traffic is not available: " + e.message + ". Add Administration: read-only to your token to see it; the other panels work without it.", "gb-error")]);
    });
  }
  function renderTraffic() {
    var t = lastTraffic, aiVisits = 0;
    var refRows = t.referrers.map(function (r) {
      var host = String(r.referrer).toLowerCase().replace(/^www\./, ""), cell = el("span", r.referrer);
      if (AI_REFERRERS.test(host)) { aiVisits += r.count; cell.appendChild(el("span", "AI", "tag-ai")); }
      return [cell, num(r.count), num(r.uniques)];
    });
    var grid = el("div", null, "chart-grid");
    grid.appendChild(barChart("Views per day", t.views.views, "views"));
    grid.appendChild(barChart("Clones per day", t.clones.clones, "clones"));
    panel("an-traffic", [
      tiles([["Views", t.views.count, num(t.views.uniques) + " unique visitors"], ["Clones", t.clones.count, num(t.clones.uniques) + " unique cloners"],
        ["Visits from AI tools", aiVisits, "referrers such as ChatGPT, Perplexity or Claude"]]),
      grid,
      el("h4", "Top referrers"),
      table(["Referrer", "Views", "Unique"], refRows, "No referrers in the last 14 days."),
      el("h4", "Popular pages on GitHub"),
      table(["Path", "Views", "Unique"], t.paths.map(function (p) { return [linkTo("https://github.com" + p.path, p.path), num(p.count), num(p.uniques)]; }), "No page views in the last 14 days.")
    ]);
  }

  // Daily single-series column chart: inline SVG, hover/focus tooltip, table view underneath.
  function barChart(title, rows, unit) {
    var byDay = {};
    (rows || []).forEach(function (r) { byDay[r.timestamp.slice(0, 10)] = r; });
    var days = [], today = new Date();
    for (var i = 13; i >= 0; i--) {
      var d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
      days.push({ day: d, count: byDay[d] ? byDay[d].count : 0, uniques: byDay[d] ? byDay[d].uniques : 0 });
    }
    var fig = el("figure", null, "chart-fig");
    fig.appendChild(el("figcaption", title));
    var holder = el("div", null, "chart-holder"); fig.appendChild(holder);
    var tip = el("div", null, "chart-tip"); tip.hidden = true; fig.appendChild(tip);
    var short = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };

    function draw() {
      var W = Math.max(260, holder.clientWidth || 420), H = 190, m = { l: 34, r: 8, t: 20, b: 26 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
      var max = Math.max.apply(null, days.map(function (x) { return x.count; })), step = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1))));
      var top = Math.max(1, [1, 2, 5, 10].map(function (f) { return f * step; }).filter(function (v) { return v >= max; })[0]);
      var band = pw / days.length, bw = Math.min(24, Math.max(2, band * 0.62)), y = function (v) { return m.t + ph - (v / top) * ph; };
      var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", title + ", last 14 days. Table view below.");
      function node(tag, attrs, text) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; svg.appendChild(n); return n; }
      [0, top / 2, top].forEach(function (v) {
        if (v !== Math.round(v)) return;
        node("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "chart-grid-line" });
        node("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "chart-axis" }, num(v));
      });
      var peak = days.reduce(function (a, b) { return b.count > a.count ? b : a; }, days[0]);
      days.forEach(function (dd, idx) {
        var cx = m.l + band * idx + band / 2, x = cx - bw / 2, h = (dd.count / top) * ph, r = Math.min(4, bw / 2, h);
        var bar = null;
        if (h > 0) bar = node("path", { class: "chart-bar", d: "M" + x + "," + (m.t + ph) + "V" + (m.t + ph - h + r) + "Q" + x + "," + (m.t + ph - h) + " " + (x + r) + "," + (m.t + ph - h) +
          "H" + (x + bw - r) + "Q" + (x + bw) + "," + (m.t + ph - h) + " " + (x + bw) + "," + (m.t + ph - h + r) + "V" + (m.t + ph) + "Z" });
        if (dd === peak && dd.count > 0) node("text", { x: cx, y: m.t + ph - h - 6, "text-anchor": "middle", class: "chart-value" }, num(dd.count));
        if (idx === 0 || idx === 7 || idx === days.length - 1) node("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "chart-axis" }, short(dd.day));
        var hit = node("rect", { x: m.l + band * idx, y: m.t, width: band, height: ph, class: "chart-hit", tabindex: "0",
          "aria-label": short(dd.day) + ": " + dd.count + " " + unit + ", " + dd.uniques + " unique" });
        function show() {
          if (bar) bar.classList.add("on");
          tip.textContent = "";
          tip.appendChild(el("strong", num(dd.count) + " " + unit)); tip.appendChild(el("span", num(dd.uniques) + " unique · " + short(dd.day)));
          tip.hidden = false;
          var left = Math.min(Math.max(cx * holder.clientWidth / W - tip.offsetWidth / 2, 0), holder.clientWidth - tip.offsetWidth);
          tip.style.left = left + "px"; tip.style.top = (holder.offsetTop + 4) + "px";
        }
        function hide() { if (bar) bar.classList.remove("on"); tip.hidden = true; }
        hit.addEventListener("pointerenter", show); hit.addEventListener("pointerleave", hide);
        hit.addEventListener("focus", show); hit.addEventListener("blur", hide);
      });
      holder.textContent = ""; holder.appendChild(svg);
    }
    var details = el("details", null, "chart-table"); details.appendChild(el("summary", "Table view"));
    details.appendChild(table(["Date", unit.charAt(0).toUpperCase() + unit.slice(1), "Unique"], days.slice().reverse().map(function (d) { return [fmtDay(d.day + "T00:00:00Z"), num(d.count), num(d.uniques)]; })));
    fig.appendChild(details);
    fig.draw = draw;
    requestAnimationFrame(draw); // needs the holder's laid-out width
    return fig;
  }
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { Array.prototype.forEach.call(document.querySelectorAll(".chart-fig"), function (f) { if (f.draw) f.draw(); }); }, 150);
  });

  // ---------- file editor
  var curFile = null;
  function loadTree() {
    if ($("f-select").options.length > 1) return;
    gh("/repos/" + REPO + "/git/trees/" + BR + "?recursive=1").then(function (t) {
      t.tree.filter(function (n) { return n.type === "blob" && /\.(html|css|js|json|md|txt|toml|yml)$/i.test(n.path) && !/^bitbytelab\//.test(n.path); })
        .forEach(function (n) { var o = el("option", n.path); o.value = n.path; $("f-select").appendChild(o); });
    }).catch(function (e) { status(e.message, true); });
  }
  function openFile(p) {
    getFile(p).then(function (f) {
      if (!f) throw new Error("File not found: " + p);
      curFile = { path: p, sha: f.sha }; $("f-text").value = f.text; $("f-save").disabled = false;
      var s = $("f-select"), has = Array.prototype.some.call(s.options, function (o) { return o.value === p; });
      if (!has) { var o = el("option", p); o.value = p; s.appendChild(o); }
      s.value = p; $("f-text").scrollIntoView();
    }).catch(function (e) { status(e.message, true); });
  }
  $("f-select").addEventListener("change", function () { if (this.value) openFile(this.value); });
  $("f-save").addEventListener("click", function () {
    if (!curFile) return;
    var msg = $("f-msg").value.trim() || "Admin: edit " + curFile.path;
    putText(curFile.path, $("f-text").value, msg, curFile.sha).then(function (r) {
      curFile.sha = r.content.sha; status("Saved " + curFile.path + ". The site updates in a minute or two.");
    }).catch(function (e) { status(e.message, true); });
  });
})();
