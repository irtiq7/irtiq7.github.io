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
    loadPosts();
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
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener("click", function () {
      Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("on", x === b); });
      ["articles", "guestbook", "files"].forEach(function (t) { $("tab-" + t).hidden = t !== b.dataset.tab; });
      status("");
      if (b.dataset.tab === "guestbook") loadIssues();
      if (b.dataset.tab === "files") loadTree();
    });
  });

  // ---------- articles
  var posts = [];
  function loadPosts() {
    getFile("posts/index.json").then(function (f) {
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

  // ---------- file editor
  var curFile = null;
  function loadTree() {
    if ($("f-select").options.length > 1) return;
    gh("/repos/" + REPO + "/git/trees/" + BR + "?recursive=1").then(function (t) {
      t.tree.filter(function (n) { return n.type === "blob" && /\.(html|css|js|json|md|txt|toml|yml)$/i.test(n.path) && !/^bitbytelab\//.test(n.path); })
        .forEach(function (n) { var o = el("option", n.path); o.value = n.path; $("f-select").appendChild(o); });
    }).catch(function (e) { status(e.message, true); });
  }
  $("f-select").addEventListener("change", function () {
    var p = this.value; if (!p) return;
    getFile(p).then(function (f) { curFile = { path: p, sha: f.sha }; $("f-text").value = f.text; $("f-save").disabled = false; }).catch(function (e) { status(e.message, true); });
  });
  $("f-save").addEventListener("click", function () {
    if (!curFile) return;
    var msg = $("f-msg").value.trim() || "Admin: edit " + curFile.path;
    putText(curFile.path, $("f-text").value, msg, curFile.sha).then(function (r) {
      curFile.sha = r.content.sha; status("Saved " + curFile.path + ". The site updates in a minute or two.");
    }).catch(function (e) { status(e.message, true); });
  });
})();
