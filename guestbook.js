(function () {
  var REPO = "irtiq7/irtiq7.github.io";
  var API = "https://api.github.com/repos/" + REPO + "/issues?state=open&per_page=100";
  var BLOCKED = /\b(casino|viagra|crypto|seo|backlink|loan|betting|escort)\b/i;

  // ---- form: open a pre-filled GitHub issue (requires a GitHub login)
  var form = document.getElementById("gb-form");
  var err = document.getElementById("gb-error");
  function fail(msg) { err.textContent = msg; err.hidden = false; }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.hidden = true;
    if (document.getElementById("gb-website").value) return; // honeypot
    var type = document.getElementById("gb-type").value;
    var title = document.getElementById("gb-title").value.trim();
    var msg = document.getElementById("gb-msg").value.trim();
    if (title.length < 3 || msg.length < 10) return fail("Please write a title and a message of at least 10 characters.");
    if ((msg.match(/https?:\/\//g) || []).length > 2) return fail("Please include at most two links, and explain them.");
    if (BLOCKED.test(title + " " + msg)) return fail("This looks like spam. Please rephrase.");
    var prefix = type === "Ask" ? "[Guestbook] Question: " : "[Guestbook] ";
    var body = msg + "\n\n---\nPosted-by: human via irtiq7.github.io/guestbook";
    var url = "https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent(prefix + title) + "&body=" + encodeURIComponent(body);
    window.open(url, "_blank", "noopener");
  });

  // ---- lists: read open issues from the public API
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function render(ul, items, empty, answerLabel) {
    ul.textContent = "";
    if (!items.length) { ul.appendChild(el("li", empty)); return; }
    items.forEach(function (i) {
      var li = document.createElement("li");
      var h = document.createElement("a");
      h.href = i.html_url; h.textContent = i.title.replace(/^\[(Guestbook|Question)\]\s*/i, "");
      h.rel = "noopener nofollow";
      var meta = el("p", "by " + i.user.login + " · " + new Date(i.created_at).toISOString().slice(0, 10) + " · " + i.comments + (i.comments === 1 ? " reply" : " replies"), "pub-venue");
      var body = el("p", (i.body || "").split("\n---\n")[0].slice(0, 400));
      li.appendChild(h); li.appendChild(meta); li.appendChild(body);
      if (answerLabel) {
        var a = el("a", answerLabel + " →", "gb-answer");
        a.href = i.html_url + "#issuecomment-new"; a.rel = "noopener";
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
  }
  fetch(API, { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (all) {
      var issues = all.filter(function (i) { return !i.pull_request; });
      var q = issues.filter(function (i) { return /^\[Question\]/i.test(i.title); });
      var m = issues.filter(function (i) { return /^\[Guestbook\]/i.test(i.title); });
      render(document.getElementById("gb-questions"), q, "No open questions right now.", "Answer");
      render(document.getElementById("gb-messages"), m, "No messages yet. Be the first!");
    })
    .catch(function () {
      var msg = "Could not load entries right now. You can read them on GitHub.";
      ["gb-questions", "gb-messages"].forEach(function (id) {
        var ul = document.getElementById(id); ul.textContent = "";
        var li = el("li", msg + " ");
        var a = el("a", "Open issues →"); a.href = "https://github.com/" + REPO + "/issues";
        li.appendChild(a); ul.appendChild(li);
      });
    });
})();
