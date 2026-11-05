/*
 * Report archive for SR Emergency Lighting.
 *
 * The shared record is the Firebase document (one JSON tree the office and
 * the phones all sync). This module never drops a saved month because a
 * snapshot is older or smaller: snapshots are merged by month + test type.
 * The browser copy is a cache and an offline buffer, not the shared record.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ReportStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var nowFn = function () { return new Date(); };

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function monthOf(date) {
    var d = date || nowFn();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  function setClock(fn) { nowFn = fn || function () { return new Date(); }; }

  function uid() {
    return "x" + nowFn().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newReport(month, type, carry) {
    return {
      id: uid(),
      month: month,
      type: type || "monthly",
      results: {},
      carry: clone(carry || []),
      engineer: "",
      date: "",
      sig: "",
      done: false,
      rev: 0,
      savedAt: ""
    };
  }

  function asList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter(function (x) { return x && typeof x === "object"; });
    }
    if (typeof value === "object") {
      return Object.keys(value).sort(function (a, b) {
        var na = +a, nb = +b;
        var aNum = a !== "" && !isNaN(na), bNum = b !== "" && !isNaN(nb);
        if (aNum && bNum) return na - nb;
        return a < b ? -1 : a > b ? 1 : 0;
      }).map(function (k) { return value[k]; }).filter(function (x) {
        return x && typeof x === "object";
      });
    }
    return [];
  }

  function slotKey(rep) {
    return (rep.month || "") + "|" + (rep.type || "monthly");
  }

  function fixRep(rep) {
    if (!rep || typeof rep !== "object" || !rep.month) return null;
    if (!rep.type) rep.type = "monthly";
    if (!rep.id) rep.id = "legacy-" + rep.month + "-" + rep.type;
    if (!rep.results || typeof rep.results !== "object" || Array.isArray(rep.results)) rep.results = {};
    rep.carry = asList(rep.carry);
    Object.keys(rep.results).forEach(function (k) {
      var r = rep.results[k];
      if (!r || typeof r !== "object" || Array.isArray(r)) r = {};
      r.faults = asList(r.faults);
      if (r.checked === undefined) r.checked = false;
      if (r.fire === undefined) r.fire = "";
      if (r.fireNote === undefined) r.fireNote = "";
      if (r.note === undefined) r.note = "";
      if (r.noteSet) r.noteSet = true; else delete r.noteSet;
      if (r.fireNoteSet) r.fireNoteSet = true; else delete r.fireNoteSet;
      rep.results[k] = r;
    });
    rep.done = !!rep.done;
    rep.engineer = rep.engineer || "";
    rep.date = rep.date || "";
    rep.sig = rep.sig || "";
    rep.rev = isNaN(+rep.rev) ? 0 : +rep.rev;
    rep.savedAt = rep.savedAt || "";
    return rep;
  }

  function checkedScore(rep) {
    var n = 0;
    var results = (rep && rep.results) || {};
    Object.keys(results).forEach(function (k) {
      var r = results[k];
      if (!r) return;
      if (r.checked) n += 2;
      if (r.note) n += 1;
      if (r.fire) n += 1;
      if (r.faults) n += r.faults.length * 3;
    });
    return n;
  }

  function isShell(rep) {
    return !rep || (!rep.done && !rep.sig && checkedScore(rep) === 0);
  }

  function isDurable(rep) {
    if (!rep || !rep.month) return false;
    if ((+rep.rev || 0) > 0) return true;
    if (rep.done || rep.sig) return true;
    if (rep.engineer && rep.date) return true;
    return checkedScore(rep) > 0;
  }

  function richness(rep) {
    var n = checkedScore(rep);
    if (rep.done) n += 50;
    if (rep.sig) n += 20;
    if (rep.engineer) n += 5;
    if (rep.date) n += 2;
    return n;
  }

  function prefer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (isShell(a) && !isShell(b)) return b;
    if (isShell(b) && !isShell(a)) return a;
    var ar = +a.rev || 0, br = +b.rev || 0;
    if (ar !== br) return ar > br ? a : b;
    var ra = richness(a), rb = richness(b);
    if (ra !== rb) return ra > rb ? a : b;
    if ((a.savedAt || "") !== (b.savedAt || "")) return (a.savedAt || "") > (b.savedAt || "") ? a : b;
    return a;
  }

  function mergeText(primary, secondary) {
    primary = primary || "";
    secondary = secondary || "";
    if (!primary) return secondary;
    if (!secondary) return primary;
    if (primary.indexOf(secondary) >= 0) return primary;
    if (secondary.indexOf(primary) >= 0) return secondary;
    return primary + "\n" + secondary;
  }

  /* A newer save can clear a note on purpose (noteSet, higher rev, empty text).
     Any other empty note does not erase text that still exists on the other copy. */
  function pickSavedText(winnerSide, loserSide, winner, loser, flag) {
    var w = (winnerSide && winnerSide[flag === "noteSet" ? "note" : "fireNote"]) || "";
    var l = (loserSide && loserSide[flag === "noteSet" ? "note" : "fireNote"]) || "";
    if (!l) return w;
    if (!w && winnerSide && winnerSide[flag] && (+winner.rev > +loser.rev)) return "";
    return mergeText(w, l);
  }

  function mergeFaults(primary, secondary) {
    var out = asList(primary).map(clone);
    asList(secondary).forEach(function (f) {
      if (!f) return;
      var idx = -1;
      for (var i = 0; i < out.length; i++) {
        if ((out[i].ref || "") === (f.ref || "") && (out[i].status || "") === (f.status || "")) {
          idx = i;
          break;
        }
      }
      if (idx < 0) { out.push(clone(f)); return; }
      if (!out[idx].note && f.note) out[idx].note = f.note;
      if (!out[idx].photo && f.photo) out[idx].photo = f.photo;
    });
    return out;
  }

  function mergeCarry(primary, secondary) {
    var out = asList(primary).map(clone);
    asList(secondary).forEach(function (c) {
      if (!c) return;
      var found = out.some(function (x) {
        return x.site === c.site && x.ref === c.ref && (x.note || "") === (c.note || "") && (x.since || "") === (c.since || "");
      });
      if (!found) out.push(clone(c));
    });
    return out;
  }

  function mergeReportBody(winner, loser) {
    if (!winner) return loser ? fixRep(clone(loser)) : null;
    if (!loser) return fixRep(clone(winner));
    var out = clone(winner);
    out.results = clone(winner.results || {});
    var loserResults = loser.results || {};
    Object.keys(loserResults).forEach(function (id) {
      var l = loserResults[id];
      if (!l) return;
      if (!out.results[id]) { out.results[id] = clone(l); return; }
      var w = out.results[id];
      w.note = pickSavedText(w, l, winner, loser, "noteSet");
      w.fireNote = pickSavedText(w, l, winner, loser, "fireNoteSet");
      if (w.note) w.noteSet = true;
      if (w.fireNote) w.fireNoteSet = true;
      w.faults = mergeFaults(w.faults, l.faults);
      if (!w.fire && l.fire) w.fire = l.fire;
      if (!w.checked && l.checked && !((+winner.rev || 0) > (+loser.rev || 0))) w.checked = true;
    });
    out.carry = mergeCarry(out.carry, loser.carry);
    if (!out.sig && loser.sig) out.sig = loser.sig;
    if (!out.done && loser.done && (loser.sig || loser.engineer)) out.done = true;
    if (!out.engineer && loser.engineer) out.engineer = loser.engineer;
    if (!out.date && loser.date) out.date = loser.date;
    return fixRep(out);
  }

  function combineReports(a, b) {
    if (!a) return b;
    if (!b) return a;
    var winner = prefer(a, b);
    var loser = winner === a ? b : a;
    return mergeReportBody(winner, loser);
  }

  function contentStamp(rep) {
    rep = fixRep(clone(rep));
    if (!rep) return "";
    return JSON.stringify(stable({
      month: rep.month, type: rep.type, done: rep.done,
      engineer: rep.engineer, date: rep.date, sig: rep.sig,
      results: rep.results, carry: rep.carry
    }));
  }

  function replaceSlot(list, rep) {
    rep = fixRep(clone(rep));
    var out = [];
    var placed = false;
    asList(list).forEach(function (raw) {
      var r = fixRep(clone(raw));
      if (!r) return;
      if (r.id === rep.id || slotKey(r) === slotKey(rep)) {
        if (!placed) { out.push(clone(rep)); placed = true; }
        return;
      }
      out.push(r);
    });
    if (!placed) out.push(clone(rep));
    return sortReports(out);
  }

  function sortReports(list) {
    return list.slice().sort(function (a, b) {
      if (a.month !== b.month) return a.month < b.month ? 1 : -1;
      return (a.type === "annual" ? 1 : 0) - (b.type === "annual" ? 1 : 0);
    });
  }

  function mergeReportLists(lists, priority) {
    var bySlot = {};
    (lists || []).forEach(function (list) {
      asList(list).forEach(function (raw) {
        var rep = fixRep(clone(raw));
        if (!rep || !isDurable(rep)) return;
        var k = slotKey(rep);
        bySlot[k] = combineReports(bySlot[k], rep);
      });
    });
    if (priority && isDurable(priority)) {
      var p = fixRep(clone(priority));
      var k = slotKey(p);
      var cur = bySlot[k];
      if (!cur) bySlot[k] = p;
      else if (isShell(p) && !isShell(cur)) bySlot[k] = mergeReportBody(cur, p);
      else if ((+p.rev || 0) >= (+cur.rev || 0)) bySlot[k] = mergeReportBody(p, cur);
      else bySlot[k] = mergeReportBody(cur, p);
    }
    return sortReports(Object.keys(bySlot).map(function (k) { return bySlot[k]; }));
  }

  function touch(rep) {
    rep = fixRep(clone(rep));
    rep.rev = (+rep.rev || 0) + 1;
    rep.savedAt = nowFn().toISOString();
    return rep;
  }

  function collectReports(snap) {
    if (!snap) return [];
    var list = asList(snap.reports).map(function (r) { return fixRep(clone(r)); }).filter(Boolean);
    if (snap.current) {
      var c = fixRep(clone(snap.current));
      if (c) list.push(c);
    }
    return list.filter(isDurable);
  }

  function siteScore(s) {
    var n = +(s.count || 0);
    ["name", "addr", "kinds", "iso", "acc"].forEach(function (k) {
      if (s[k]) n += String(s[k]).length;
    });
    if (s.fire) n += 5;
    return n;
  }

  function mergeSites(localSites, remoteSites, localRev, remoteRev) {
    localRev = localRev || 0;
    remoteRev = remoteRev || 0;
    /* A newer site list wins outright so a deleted site stays deleted.
       Equal revisions are unioned so an untouched phone cannot drop a site. */
    if (localRev > remoteRev) return asList(localSites).map(clone);
    if (remoteRev > localRev) return asList(remoteSites).map(clone);
    var chosen = {};
    function consider(s, rev, tieWins) {
      if (!s || !s.id) return;
      var prev = chosen[s.id];
      var score = siteScore(s);
      if (!prev || rev > prev._srcRev ||
          (rev === prev._srcRev && (score > prev._score || (score === prev._score && tieWins)))) {
        var n = clone(s);
        n._srcRev = rev;
        n._score = score;
        chosen[s.id] = n;
      }
    }
    asList(localSites).forEach(function (s) { consider(s, localRev || 0, false); });
    asList(remoteSites).forEach(function (s) { consider(s, remoteRev || 0, true); });
    var seen = {}, out = [];
    function push(s) {
      if (!s || !s.id || seen[s.id] || !chosen[s.id]) return;
      seen[s.id] = 1;
      var n = chosen[s.id];
      delete n._srcRev;
      delete n._score;
      out.push(n);
    }
    asList(localSites).forEach(push);
    asList(remoteSites).forEach(push);
    return out;
  }

  function pickStr(local, remote, key) {
    var lr = +(local && local.metaRev) || 0;
    var rr = +(remote && remote.metaRev) || 0;
    var lv = (local && local[key]) || "";
    var rv = (remote && remote[key]) || "";
    if (lr > rr) return lv || rv;
    if (rr > lr) return rv || lv;
    return rv || lv;
  }

  function chooseCurrent(localCur, remoteCur) {
    var l = localCur ? fixRep(clone(localCur)) : null;
    var r = remoteCur ? fixRep(clone(remoteCur)) : null;
    if (!l) return r;
    if (!r) return l;
    if (!isDurable(l) && isDurable(r)) return r;
    if (slotKey(l) === slotKey(r)) {
      if (isShell(l) && !isShell(r)) return r;
      if (isShell(r) && !isShell(l)) return l;
      if ((+l.rev || 0) >= (+r.rev || 0)) return l;
      return r;
    }
    if (isDurable(l)) return l;
    return isDurable(r) ? r : l;
  }

  function normaliseDb(db) {
    db = db && typeof db === "object" ? db : {};
    var current = db.current ? fixRep(clone(db.current)) : null;
    if (!current) current = newReport(monthOf(nowFn()), "monthly", []);
    var reports = mergeReportLists([asList(db.reports)], null);
    return {
      engineer: db.engineer || "",
      client: db.client || "",
      clientLogo: db.clientLogo || "",
      metaRev: +db.metaRev || 0,
      sites: asList(db.sites).map(clone).filter(function (s) { return s && s.id; }),
      current: current,
      reports: reports
    };
  }

  function mergeDb(local, remote) {
    local = normaliseDb(local);
    remote = remote && typeof remote === "object" ? remote : {};
    var reports = mergeReportLists([
      collectReports(local),
      collectReports(remote)
    ], local.current);
    var current = chooseCurrent(local.current, remote.current);
    if (current && isDurable(current)) {
      reports = mergeReportLists([reports, [current]], current);
      var openIdx = findReport(reports, current.month, current.type);
      if (openIdx >= 0) current = clone(reports[openIdx]);
    }
    var lr = +local.metaRev || 0;
    var rr = +remote.metaRev || 0;
    var sites = mergeSites(local.sites, remote.sites, lr, rr);
    if (!sites.length) sites = local.sites;
    return {
      engineer: pickStr(local, remote, "engineer"),
      client: pickStr(local, remote, "client"),
      clientLogo: pickStr(local, remote, "clientLogo"),
      metaRev: Math.max(lr, rr),
      sites: sites,
      current: current || local.current,
      reports: reports
    };
  }

  function ensureArchived(db) {
    db = normaliseDb(db);
    if (db.current && isDurable(db.current)) {
      db.reports = mergeReportLists([db.reports, [db.current]], db.current);
    }
    return db;
  }

  function persistCurrent(db) {
    db = normaliseDb(db);
    if (!db.current) return db;
    /* An untouched shell (fresh install, no checks yet) must not become a
       saved month. Signing in saves the engineer name and must not push a
       blank current month over the shared record. */
    if (!isDurable(db.current)) return db;
    var idx = findReport(db.reports, db.current.month, db.current.type);
    var prev = idx >= 0 ? db.reports[idx] : null;
    /* Saving again with the same checks and notes must not invent a newer
       revision. A month switch on another device was outranking the copy
       that actually held the notes. */
    if (prev && contentStamp(prev) === contentStamp(db.current)) {
      db.current.rev = prev.rev;
      db.current.savedAt = prev.savedAt || db.current.savedAt;
      if (prev.id) db.current.id = prev.id;
      return db;
    }
    db.current = touch(db.current);
    db.reports = replaceSlot(db.reports, db.current);
    return db;
  }

  function findReport(reports, month, type) {
    type = type || "monthly";
    var list = asList(reports);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].month === month && (list[i].type || "monthly") === type) return i;
    }
    return -1;
  }

  function carryFrom(rep, sites, sinceLabel) {
    var carry = [];
    var lab = sinceLabel || (rep && rep.month) || "";
    asList(sites).forEach(function (s) {
      var r = rep && rep.results ? rep.results[s.id] : null;
      if (!r) return;
      asList(r.faults).forEach(function (f) {
        carry.push({ site: s.id, ref: f.ref, status: f.status, note: f.note, since: lab });
      });
      if (r.fire === "fault") {
        carry.push({ site: s.id, ref: "Fire panel", status: "fail", note: r.fireNote || "Fault showing", since: lab });
      }
    });
    asList(rep && rep.carry).forEach(function (c) { carry.push(clone(c)); });
    return carry;
  }

  function activateMonth(db, month, type, opts) {
    opts = opts || {};
    db = ensureArchived(normaliseDb(db));
    type = type || "monthly";
    var leaving = db.current ? fixRep(clone(db.current)) : null;
    if (leaving && leaving.month === month && (leaving.type || "monthly") === type) return db;
    if (leaving) {
      var parked = findReport(db.reports, leaving.month, leaving.type);
      var prev = parked >= 0 ? db.reports[parked] : null;
      if (!prev) {
        leaving = touch(leaving);
        db.reports = replaceSlot(db.reports, leaving);
      } else if (contentStamp(prev) !== contentStamp(leaving)) {
        var merged = mergeReportBody(leaving, prev);
        if (contentStamp(merged) !== contentStamp(prev)) {
          leaving = touch(merged);
          db.reports = replaceSlot(db.reports, leaving);
        }
      }
    }
    var idx = findReport(db.reports, month, type);
    if (idx >= 0) {
      db.current = clone(db.reports[idx]);
      return db;
    }
    var advancing = opts.advancing;
    if (advancing == null && leaving) advancing = month > leaving.month;
    var carry = advancing && leaving ? carryFrom(leaving, db.sites, opts.sinceLabel || leaving.month) : [];
    var fresh = touch(newReport(month, type, carry));
    db.current = fresh;
    db.reports = mergeReportLists([db.reports, [fresh]], fresh);
    return db;
  }

  function previousReports(db) {
    db = normaliseDb(db);
    var cur = db.current;
    return db.reports.filter(function (r) {
      if (!cur) return true;
      if (r.id && cur.id && r.id === cur.id) return false;
      return slotKey(r) !== slotKey(cur);
    });
  }

  function reportById(db, id) {
    db = normaliseDb(db);
    if (db.current && db.current.id === id) return clone(db.current);
    for (var i = 0; i < db.reports.length; i++) {
      if (db.reports[i].id === id) return clone(db.reports[i]);
    }
    return null;
  }

  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).sort().forEach(function (k) {
        if (v[k] !== undefined) o[k] = stable(v[k]);
      });
      return o;
    }
    return v;
  }

  function canonReport(rep) {
    rep = fixRep(clone(rep || {}));
    if (!rep) return "";
    return JSON.stringify(stable({
      id: rep.id, month: rep.month, type: rep.type, rev: rep.rev, done: rep.done,
      engineer: rep.engineer, date: rep.date, sig: rep.sig,
      results: rep.results, carry: rep.carry
    }));
  }

  function canonSites(sites) {
    var list = asList(sites).map(function (s) { return stable(clone(s)); });
    list.sort(function (a, b) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return JSON.stringify(list);
  }

  function reportSet(snap) {
    var merged = mergeReportLists([collectReports(snap)], snap && snap.current);
    return merged.map(canonReport).sort().join("\n");
  }

  function remoteCovers(remote, merged) {
    if (!remote || !asList(remote.sites).length) return false;
    if (reportSet(remote) !== reportSet(merged)) return false;
    if (canonReport(remote.current) !== canonReport(merged.current)) return false;
    if (canonSites(remote.sites) !== canonSites(merged.sites)) return false;
    if ((remote.engineer || "") !== (merged.engineer || "")) return false;
    if ((remote.client || "") !== (merged.client || "")) return false;
    if ((remote.clientLogo || "") !== (merged.clientLogo || "")) return false;
    return true;
  }

  function acceptRemote(local, remote, requestGen, currentGen) {
    local = normaliseDb(local);
    if (requestGen !== currentGen) return { db: local, push: false, stale: true };
    var empty = !remote || !asList(remote.sites).length;
    if (empty) return { db: local, push: !!(local.sites && local.sites.length), stale: false, empty: true };
    var merged = mergeDb(local, remote);
    return { db: merged, push: !remoteCovers(remote, merged), stale: false, empty: false };
  }

  function salvageQueue(local, ops) {
    var db = normaliseDb(local);
    asList(ops).forEach(function (op) {
      if (!op || typeof op !== "object") return;
      var body = op.b || op.body || null;
      if (!body && (op.reports || op.current || op.sites)) body = op;
      if (!body || typeof body !== "object") return;
      db = mergeDb(db, body);
    });
    return ensureArchived(db);
  }

  function hasDurable(db) {
    return collectReports(db).length > 0;
  }

  function snapshot(db) {
    db = ensureArchived(normaliseDb(db));
    return {
      sites: db.sites,
      current: db.current,
      reports: db.reports,
      engineer: db.engineer || "",
      client: db.client || "",
      clientLogo: db.clientLogo || "",
      metaRev: db.metaRev || 0
    };
  }

  function monthsIn(db) {
    var out = [];
    ensureArchived(db).reports.forEach(function (r) {
      out.push(r.month + "|" + (r.type || "monthly"));
    });
    return out;
  }

  return {
    setClock: setClock,
    clone: clone,
    newReport: newReport,
    asList: asList,
    fixRep: fixRep,
    isShell: isShell,
    isDurable: isDurable,
    slotKey: slotKey,
    normaliseDb: normaliseDb,
    mergeDb: mergeDb,
    ensureArchived: ensureArchived,
    persistCurrent: persistCurrent,
    findReport: findReport,
    carryFrom: carryFrom,
    activateMonth: activateMonth,
    previousReports: previousReports,
    reportById: reportById,
    acceptRemote: acceptRemote,
    remoteCovers: remoteCovers,
    salvageQueue: salvageQueue,
    hasDurable: hasDurable,
    snapshot: snapshot,
    monthsIn: monthsIn,
    canonReport: canonReport
  };
});
