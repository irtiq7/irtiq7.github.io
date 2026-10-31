// "My outlook": the private tab of the admin page. Personal forecasts and advice, worked out in this browser
// from the public data in news/ and numbers typed in here. The numbers are kept only in this browser's storage
// and are never sent anywhere or committed: this repository is public, so nothing personal may enter it.
(function (root) {
  "use strict";
  var STORE = "myoutlook.v1";
  // Rules of thumb, all in one place so they can be questioned and changed.
  var RULES = {
    runwayTemporary: 9, runwayPermanent: 6, // months of expenses to keep in cash
    expensiveDebt: 7,                       // % interest: above this, repaying beats expected investing returns
    crash: 40,                              // % fall in stocks to plan for
    shareByYears: function (y) { return y < 3 ? 0 : y < 5 ? 30 : y < 10 ? 60 : 90; }, // % in stocks by years until the money is needed
    forecastBar: { resolved: 50 }           // questions needed, and beating the benchmark, before forecasts may change advice
  };
  function kr(n) { return Math.round(n).toLocaleString("en-US") + " kr"; }
  function pos(x) { x = Number(x); return Number.isFinite(x) && x > 0 ? x : 0; }
  function monthsUntil(date, now) {
    var d = new Date(date + "T00:00:00Z"); if (isNaN(d)) return null;
    return (d - now) / (30.44 * 864e5);
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  // me: the typed-in numbers. items: outlook items by id. Returns ordered advice: [{title, body, why}].
  function advise(me, items, now) {
    now = now || new Date();
    var out = [], expenses = pos(me.expenses), cash = pos(me.cash), debt = pos(me.debt), debtRate = pos(me.debtRate), invested = pos(me.invested),
      save = pos(me.save), goal = pos(me.goal), goalYears = pos(me.goalYears), years = pos(me.years), comfort = pos(me.comfort) || 35;
    if (!expenses) return [{ title: "Start with your monthly expenses", body: "Fill in at least your monthly expenses and savings, and your advice appears here.", why: "Almost every recommendation is measured in months of expenses." }];
    var temporary = me.contract === "temporary", left = me.contractEnd ? monthsUntil(me.contractEnd, now) : null;
    var target = (temporary ? RULES.runwayTemporary : RULES.runwayPermanent) * expenses;
    var runway = cash / expenses, gap = Math.max(0, target - cash), blocked = false;
    var time = function (amount) { return save ? " At " + kr(save) + " a month that takes about " + Math.ceil(amount / save) + " months." : " Set a monthly amount to get there."; };

    if (debt && debtRate >= RULES.expensiveDebt) {
      blocked = true;
      out.push({ title: "First: repay your " + kr(debt) + " of debt at " + debtRate + "%", body: "Keep about one month of expenses in cash and put everything else towards this debt before investing." + time(debt),
        why: "Repaying is a guaranteed " + debtRate + "% return. Stocks are not guaranteed to beat that, and this debt costs about " + kr(debt * debtRate / 100) + " a year." });
    }
    if (gap) {
      blocked = true;
      out.push({ title: (out.length ? "Next" : "First") + ": build your cash reserve by " + kr(gap), body: "You have " + round1(runway) + " months of expenses in cash. Aim for " + kr(target) + " (" + (temporary ? RULES.runwayTemporary : RULES.runwayPermanent) + " months)." + time(gap),
        why: temporary ? "A temporary contract has a known end and the next job may not start straight away, so you need a larger reserve." : "This covers a job loss or a large bill without selling investments at a bad time." });
    } else {
      out.push({ title: "Your cash reserve is enough", body: round1(runway) + " months of expenses in cash meets the " + (temporary ? RULES.runwayTemporary : RULES.runwayPermanent) + "-month target." + (cash - target > expenses ? " About " + kr(cash - target) + " above it could go towards your goal or investing." : ""), why: "Holding far more than this usually loses value to inflation over time." });
    }
    if (goal) {
      if (goalYears && goalYears < 5) {
        blocked = true;
        out.push({ title: "Keep your " + kr(goal) + " goal out of stocks", body: "You need it in " + goalYears + " year" + (goalYears === 1 ? "" : "s") + ". Save for it about " + kr(goal / (goalYears * 12)) + " a month, in savings or short-term bonds." + (save && goal / (goalYears * 12) > save ? " That is more than the " + kr(save) + " you can save each month, even before debt and your reserve, so plan to move the date, lower the goal or save more." : ""), why: "Stocks can take several years to recover from a large fall, and this money could not wait." });
      } else if (goalYears) {
        out.push({ title: "Your " + kr(goal) + " goal has time to grow", body: "With " + goalYears + " years to go, it can follow the investing mix below, moving to safer holdings in the last 3 to 5 years. Without any growth it needs about " + kr(goal / (goalYears * 12)) + " a month.", why: "A long horizon gives time to recover from falls, but only if you reduce risk as the date nears." });
      }
    }
    if (temporary && left !== null) {
      var d = items["dk-unemployment"], sw = items["indeed-software"], mood = (d ? " Danish unemployment is " + d.latest.value + "%, moving " + d.direction + "." : "") + (sw ? " US software postings are at " + round1(sw.latest.value) + " on Indeed's index, moving " + sw.direction + "." : "");
      if (left < 0) out.push({ title: "Your contract end date has passed", body: "Update the date if it was renewed.", why: "The job advice depends on it." });
      else out.push({ title: left <= 12 ? "Start your job search now: " + Math.round(left) + " months left" : left <= 18 ? "Prepare your next move: " + Math.round(left) + " months left" : "Keep your options open: " + Math.round(left) + " months left",
        body: (left <= 12 ? "Apply actively and tell your network, including both academic and industry routes." : left <= 18 ? "Update your CV and publication list, contact people who could hire you, and note application deadlines." : "Keep publishing and stay in touch with your network; no urgent step is needed.") + mood,
        why: "Academic and research hiring often takes many months, so starting about a year ahead avoids a gap. The job figures are context only: they describe whole markets rather than your field." });
    }
    var share = Math.min(RULES.shareByYears(years || 0), Math.floor(comfort / RULES.crash * 100 / 5) * 5, 100);
    if (years) {
      var hit = invested * share / 100 * RULES.crash / 100, y = items["us-10y-yield"], inf = items["us-inflation"];
      out.push({ title: (blocked ? "After that: " : "") + "aim for about " + share + "% stocks, " + (100 - share) + "% bonds and savings", body: "Use a low-cost, broadly diversified global index fund for the stock part, and pay in the same amount every month." + (save && !blocked ? " That is about " + kr(save * share / 100) + " to stocks and " + kr(save * (100 - share) / 100) + " to safer holdings each month." : "") + (invested ? " A " + RULES.crash + "% stock fall would cost about " + kr(hit) + " on paper, or " + round1(hit / expenses) + " months of expenses." : ""),
        why: "You need this money in about " + years + " years and said you could sit through a " + comfort + "% fall without selling." + (y && inf ? " US bonds pay about " + round1(y.latest.value - inf.latest.value) + "% above inflation now, though that is a US figure rather than a Danish one." : "") });
    }
    out.push({ title: "Check Danish account and tax options before you invest", body: "Compare an aktiesparekonto, your pension and a normal investment account, using current limits and tax rates from Skat or your bank.", why: "Tax can change the result as much as fees do. These rules do not model tax." });
    return out;
  }
  // Whether the scoreboard has earned the right to change the advice.
  function verdict(summary) {
    var ind = (summary.by_model || {})["indicator-v1"] || { resolved: 0, mean_brier: null }, bar = RULES.forecastBar.resolved;
    var earned = ind.resolved >= bar && ind.mean_brier !== null && ind.mean_brier < summary.benchmark_brier;
    return { earned: earned, resolved: ind.resolved, brier: ind.mean_brier, benchmark: summary.benchmark_brier, bar: bar };
  }
  root.MyOutlookRules = { advise: advise, verdict: verdict, RULES: RULES };
  if (typeof document === "undefined") return;

  // ---------- the tab
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ["expenses", "cash", "debt", "debtRate", "invested", "save", "goal", "goalYears", "years", "comfort", "contract", "contractEnd"];
  var data = null;
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function read() { var me = {}; try { me = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) {} return me; }
  function current() { var me = {}; FIELDS.forEach(function (f) { me[f] = $("me-" + f).value; }); return me; }
  function render() {
    if (!data) return;
    var list = $("me-advice"); list.textContent = "";
    advise(current(), data.items).forEach(function (a) {
      var li = el("li"); li.appendChild(el("strong", a.title)); li.appendChild(el("p", a.body)); li.appendChild(el("p", "Why: " + a.why, "pub-venue")); list.appendChild(li);
    });
    var v = verdict(data.summary), note = $("me-verdict");
    note.textContent = v.earned
      ? "These forecasts have beaten the 50% benchmark over " + v.resolved + " questions, so treat them as weak evidence. The advice above still does not use them."
      : "These forecasts are not yet good enough to act on, so the advice above ignores them. The economic method has " + v.resolved + " resolved questions (error score " + (v.brier === null ? "n/a" : v.brier) + " against " + v.benchmark + " for always saying 50%; lower is better). They need at least " + v.bar + " and a better score than the benchmark.";
    var fc = $("me-forecasts"); fc.textContent = "";
    Object.keys(data.items).map(function (k) { return data.items[k]; }).filter(function (i) { return i.next && i.section !== "research"; })
      .sort(function (a, b) { return a.next.resolves < b.next.resolves ? -1 : 1; }).forEach(function (i) {
        var li = el("li"); li.appendChild(el("strong", Math.round(i.next.p * 100) + "%")); li.appendChild(document.createTextNode(" " + i.next.question));
        li.appendChild(el("p", "Settled by " + i.next.resolves + ". " + (i.next.has_skill ? "Beat the long-run rate on past data." : "No better than the long-run rate on past data."), "pub-venue")); fc.appendChild(li);
      });
  }
  var wired = false;
  function open() {
    if (!wired) {
      wired = true;
      var me = read();
      FIELDS.forEach(function (f) {
        var n = $("me-" + f); if (me[f] != null) n.value = me[f];
        n.addEventListener("input", function () { try { localStorage.setItem(STORE, JSON.stringify(current())); } catch (e) {} render(); });
      });
      $("me-erase").addEventListener("click", function () {
        if (!confirm("Erase your numbers from this browser?")) return;
        try { localStorage.removeItem(STORE); } catch (e) {}
        FIELDS.forEach(function (f) { var n = $("me-" + f); n.value = n.tagName === "SELECT" ? n.options[n.dataset.def || 0].value : ""; }); render();
      });
    }
    if (data) { render(); return; }
    Promise.all([fetch("news/outlook.json?v=" + Date.now()).then(function (r) { return r.json(); }), fetch("news/forecasts.json?v=" + Date.now()).then(function (r) { return r.json(); })])
      .then(function (x) { var items = {}; x[0].items.forEach(function (i) { items[i.id] = i; }); data = { items: items, summary: x[1].summary }; render(); })
      .catch(function () { $("me-verdict").textContent = "Could not load the latest data."; });
  }
  root.MyOutlook = { open: open };
})(typeof window !== "undefined" ? window : globalThis);
