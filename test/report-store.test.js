const test = require("node:test");
const assert = require("node:assert/strict");
const RS = require("../report-store.js");

const SITES = [
  { id: "cs2", name: "7A & 8A Charles Street", count: 3 },
  { id: "cs3", name: "1-9 & 14 Charles Street", count: 10 },
  { id: "saani", name: "Saani Medical", count: 6, fire: true }
];

function base(current, reports) {
  return {
    engineer: "Stewart Rawson",
    client: "Wingetts",
    clientLogo: "logo",
    metaRev: 0,
    sites: JSON.parse(JSON.stringify(SITES)),
    current: current,
    reports: reports || []
  };
}

function doneReport(month, note, id) {
  return {
    id: id || ("id-" + month),
    month: month,
    type: "monthly",
    rev: 0,
    done: true,
    engineer: "Stewart Rawson",
    date: month + "-28",
    sig: "data:image/png," + month,
    savedAt: month + "-28T18:00:00.000Z",
    carry: [],
    results: {
      cs2: {
        checked: true,
        fire: "",
        fireNote: "",
        note: "",
        faults: note ? [{ ref: "All fittings", status: "dim", note: note, photo: "" }] : []
      }
    }
  };
}

test("an untouched shell is not filed just by saving", () => {
  let db = base(RS.newReport("2026-11", "monthly", [
    { site: "cs2", ref: "All fittings", status: "dim", note: "seed", since: "May 2026" }
  ]));
  db.engineer = "Stewart Rawson";
  db = RS.persistCurrent(db);
  assert.equal(db.current.rev, 0);
  assert.equal(RS.isDurable(db.current), false);
  assert.equal(db.reports.length, 0);
});

test("signing a month archives it before the next month is started", () => {
  let db = base(RS.newReport("2026-10", "monthly", []));
  db.current.results.cs2 = {
    checked: true, faults: [{ ref: "All fittings", status: "dim", note: "October dim", photo: "" }],
    fire: "", fireNote: "", note: ""
  };
  db.current.done = true;
  db.current.engineer = "Stewart Rawson";
  db.current.date = "2026-10-31";
  db.current.sig = "data:image/png,oct";
  db = RS.persistCurrent(db);
  assert.ok(RS.monthsIn(db).indexOf("2026-10|monthly") >= 0);
  const archived = db.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(archived.done, true);
  assert.equal(archived.results.cs2.faults[0].note, "October dim");
  assert.equal(RS.previousReports(db).length, 0, "the open month stays out of the previous list");
});

test("starting later months keeps every previous month and reopening restores it", () => {
  let db = base(doneReport("2026-09", "September lamp"));
  db.current = doneReport("2026-09", "September lamp");
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-10", "monthly", { sinceLabel: "September 2026" });
  db.current.results.cs2 = {
    checked: true,
    faults: [{ ref: "All fittings", status: "dim", note: "October dim", photo: "" }],
    fire: "", fireNote: "", note: ""
  };
  db.current.done = true;
  db.current.engineer = "Stewart Rawson";
  db.current.date = "2026-10-31";
  db.current.sig = "data:image/png,oct";
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-11", "monthly", { sinceLabel: "October 2026" });
  db.current.results.cs3 = { checked: true, faults: [], fire: "", fireNote: "", note: "November note" };
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-08", "monthly", { sinceLabel: "November 2026", advancing: false });
  db.current.results.saani = { checked: true, faults: [], fire: "ok", fireNote: "", note: "" };
  db = RS.persistCurrent(db);

  const months = RS.monthsIn(db);
  ["2026-08|monthly", "2026-09|monthly", "2026-10|monthly", "2026-11|monthly"].forEach(function (m) {
    assert.ok(months.indexOf(m) >= 0, "missing " + m + " in " + months.join(","));
  });

  const prev = RS.previousReports(db).map(function (r) { return r.month; });
  assert.ok(prev.indexOf("2026-10") >= 0);
  assert.ok(prev.indexOf("2026-11") >= 0);
  assert.ok(prev.indexOf("2026-09") >= 0);
  assert.equal(prev.indexOf("2026-08"), -1);

  db = RS.activateMonth(db, "2026-10", "monthly");
  assert.equal(db.current.month, "2026-10");
  assert.equal(db.current.results.cs2.faults[0].note, "October dim");
  assert.equal(db.current.done, true);
  assert.ok(RS.monthsIn(db).indexOf("2026-11|monthly") >= 0);
  assert.ok(RS.monthsIn(db).indexOf("2026-08|monthly") >= 0);
});

test("later edits to the open round do not rewrite an archived month", () => {
  let db = base(doneReport("2026-10", "October dim"));
  db.current = doneReport("2026-10", "October dim", "oct");
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-11", "monthly", { sinceLabel: "October 2026" });
  db.current.results.cs2 = {
    checked: true,
    faults: [{ ref: "Bulkhead", status: "fail", note: "November only", photo: "" }],
    fire: "", fireNote: "", note: ""
  };
  db = RS.persistCurrent(db);
  const oct = db.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(oct.results.cs2.faults[0].note, "October dim");
  assert.notEqual(oct, db.current);
});

test("a stale cloud snapshot that omitted October cannot delete it", () => {
  const october = doneReport("2026-10", "October dim", "oct");
  const september = doneReport("2026-09", "September lamp", "sep");
  let local = base(RS.newReport("2026-11", "monthly", []), [september, october]);
  local.current.results.cs3 = { checked: true, faults: [], fire: "", fireNote: "", note: "" };
  local.current.rev = 4;
  local.current.savedAt = "2026-11-05T09:00:00.000Z";
  local = RS.persistCurrent(local);

  const stale = base({
    id: "nov-blank",
    month: "2026-11",
    type: "monthly",
    rev: 9,
    done: false,
    engineer: "",
    date: "",
    sig: "",
    carry: [],
    results: {}
  }, [september]);

  const merged = RS.mergeDb(local, stale);
  const months = RS.monthsIn(merged);
  ["2026-09|monthly", "2026-10|monthly", "2026-11|monthly"].forEach(function (m) {
    assert.ok(months.indexOf(m) >= 0, m);
  });
  const oct = merged.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(oct.results.cs2.faults[0].note, "October dim");
  assert.equal(oct.done, true);
  const nov = merged.reports.filter(function (r) { return r.month === "2026-11"; })[0];
  assert.equal(nov.results.cs3.checked, true, "a blank newer shell must not wipe the checked November round");
});

test("October held only as the open round is kept when a remote snapshot replaces current", () => {
  const october = doneReport("2026-10", "October dim", "oct");
  const local = base(october, [doneReport("2026-09", "", "sep")]);
  const remote = base({
    id: "nov",
    month: "2026-11",
    type: "monthly",
    rev: 3,
    done: false,
    engineer: "Stewart Rawson",
    date: "2026-11-02",
    sig: "",
    carry: [],
    savedAt: "2026-11-02T10:00:00.000Z",
    results: { cs2: { checked: true, faults: [], fire: "", fireNote: "", note: "" } }
  }, [doneReport("2026-09", "", "sep")]);
  const merged = RS.mergeDb(local, remote);
  assert.ok(RS.monthsIn(merged).indexOf("2026-10|monthly") >= 0);
  const oct = merged.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(oct.sig, october.sig);
  assert.equal(oct.results.cs2.faults[0].note, "October dim");
});

test("a blank local month does not replace a completed remote report for that month", () => {
  let local = base(RS.newReport("2026-11", "monthly", [{ site: "cs2", ref: "x", status: "dim", note: "seed", since: "May 2026" }]));
  local = RS.persistCurrent(local);
  assert.equal(RS.isShell(local.current), true);
  const remote = base(doneReport("2026-11", "Real November", "real-nov"), [doneReport("2026-10", "October dim", "oct")]);
  const merged = RS.mergeDb(local, remote);
  const nov = merged.reports.filter(function (r) { return r.month === "2026-11"; })[0];
  assert.equal(nov.results.cs2.faults[0].note, "Real November");
  assert.equal(merged.current.results.cs2.faults[0].note, "Real November");
  assert.ok(RS.monthsIn(merged).indexOf("2026-10|monthly") >= 0);
});

test("Firebase object maps and dropped empty arrays still list every month", () => {
  const remote = {
    sites: { 0: SITES[0], 1: SITES[1] },
    current: doneReport("2026-11", "", "nov"),
    reports: {
      0: doneReport("2026-09", "September lamp", "sep"),
      2: doneReport("2026-10", "October dim", "oct")
    }
  };
  remote.reports[2].results.cs2.faults = { 0: remote.reports[2].results.cs2.faults[0] };
  delete remote.current.results.cs2.faults;
  const merged = RS.mergeDb(base(RS.newReport("2026-08", "monthly", [])), remote);
  ["2026-09|monthly", "2026-10|monthly", "2026-11|monthly"].forEach(function (m) {
    assert.ok(RS.monthsIn(merged).indexOf(m) >= 0, m);
  });
  const oct = merged.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.ok(Array.isArray(oct.results.cs2.faults));
  assert.equal(oct.results.cs2.faults[0].note, "October dim");
  const nov = merged.reports.filter(function (r) { return r.month === "2026-11"; })[0];
  assert.ok(Array.isArray(nov.results.cs2.faults));
});

test("offline queue snapshots are merged and never replayed as a replacement", () => {
  const local = base(doneReport("2026-11", "November", "nov"), [doneReport("2026-09", "", "sep")]);
  const queuedOctober = {
    m: "PUT",
    p: "",
    b: base(doneReport("2026-10", "October dim", "oct"), [doneReport("2026-09", "", "sep")])
  };
  const salvaged = RS.salvageQueue(local, [queuedOctober, { m: "PUT", p: "", b: null }, "junk"]);
  ["2026-09|monthly", "2026-10|monthly", "2026-11|monthly"].forEach(function (m) {
    assert.ok(RS.monthsIn(salvaged).indexOf(m) >= 0, m);
  });
  const oct = salvaged.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(oct.results.cs2.faults[0].note, "October dim");
});

test("a stale pull response is ignored", () => {
  let local = base(doneReport("2026-10", "October dim", "oct"), [doneReport("2026-09", "", "sep")]);
  local = RS.ensureArchived(local);
  local.current = doneReport("2026-11", "November", "nov");
  local = RS.ensureArchived(local);
  const remote = base(RS.newReport("2026-11", "monthly", []), []);
  const ignored = RS.acceptRemote(local, remote, 1, 2);
  assert.equal(ignored.stale, true);
  assert.equal(ignored.push, false);
  assert.ok(RS.monthsIn(ignored.db).indexOf("2026-10|monthly") >= 0);
  assert.equal(ignored.db.reports.filter(function (r) { return r.month === "2026-10"; })[0].results.cs2.faults[0].note, "October dim");
  const applied = RS.acceptRemote(RS.persistCurrent(local), remote, 2, 2);
  assert.equal(applied.stale, false);
  assert.equal(applied.push, true);
  assert.ok(RS.monthsIn(applied.db).indexOf("2026-10|monthly") >= 0);
});

test("a cloud read-back with Firebase's empty-array and map shape does not need another write", () => {
  let db = base(doneReport("2026-10", "October dim", "oct"), [doneReport("2026-09", "", "sep")]);
  db = RS.ensureArchived(db);
  db.current = doneReport("2026-11", "", "nov");
  db.current.results.cs3 = { checked: true, faults: [], fire: "", fireNote: "", note: "" };
  db.current.rev = 2;
  db = RS.ensureArchived(db);
  const remote = RS.clone(RS.snapshot(db));
  const mapped = {};
  remote.reports.forEach(function (r, i) {
    if (r.carry && !r.carry.length) delete r.carry;
    Object.keys(r.results).forEach(function (k) {
      if (r.results[k].faults && !r.results[k].faults.length) delete r.results[k].faults;
    });
    mapped[String(i)] = r;
  });
  remote.reports = mapped;
  const res = RS.acceptRemote(db, remote, 3, 3);
  assert.equal(res.push, false);
  assert.ok(RS.monthsIn(res.db).indexOf("2026-10|monthly") >= 0);
});

test("an identical cloud snapshot does not need another write", () => {
  let db = base(doneReport("2026-10", "October dim", "oct"), [doneReport("2026-09", "", "sep")]);
  db.current = doneReport("2026-11", "", "nov");
  db.current.results.cs3 = { checked: true, faults: [], fire: "", fireNote: "", note: "" };
  db.current.rev = 2;
  db = RS.ensureArchived(db);
  const remote = RS.snapshot(db);
  const res = RS.acceptRemote(db, remote, 5, 5);
  assert.equal(res.stale, false);
  assert.equal(res.push, false, "sync would loop if an unchanged snapshot asked for another write");
  assert.deepEqual(RS.monthsIn(res.db).sort(), RS.monthsIn(db).sort());
});

test("annual and monthly reports for the same month are both kept", () => {
  const monthly = doneReport("2026-10", "Monthly", "m");
  const annual = doneReport("2026-10", "Annual", "a");
  annual.type = "annual";
  let db = base(monthly, []);
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-10", "annual");
  db.current.results.cs2 = {
    checked: true,
    faults: [{ ref: "All fittings", status: "dim", note: "Annual duration", photo: "" }],
    fire: "", fireNote: "", note: ""
  };
  db.current.done = true;
  db.current.sig = "data:image/png,annual";
  db = RS.persistCurrent(db);
  const months = RS.monthsIn(db);
  assert.ok(months.indexOf("2026-10|monthly") >= 0);
  assert.ok(months.indexOf("2026-10|annual") >= 0);
  db = RS.activateMonth(db, "2026-10", "monthly");
  assert.equal(db.current.type, "monthly");
  assert.equal(db.current.results.cs2.faults[0].note, "Monthly");
});

test("carry-forward notes follow a later month and a backdated month stays blank", () => {
  let db = base(doneReport("2026-10", "October dim", "oct"));
  db.current = doneReport("2026-10", "October dim", "oct");
  db.current.results.saani = {
    checked: true, fire: "fault", fireNote: "ZONE 1", note: "",
    faults: []
  };
  db = RS.activateMonth(db, "2026-11", "monthly", { sinceLabel: "October 2026" });
  const refs = db.current.carry.map(function (c) { return c.site + ":" + c.ref; });
  assert.ok(refs.indexOf("cs2:All fittings") >= 0);
  assert.ok(refs.indexOf("saani:Fire panel") >= 0);
  assert.equal(db.current.carry[0].since, "October 2026");
  db = RS.activateMonth(db, "2026-07", "monthly", { sinceLabel: "November 2026", advancing: false });
  assert.equal(db.current.month, "2026-07");
  assert.deepEqual(db.current.carry, []);
  assert.ok(RS.monthsIn(db).indexOf("2026-10|monthly") >= 0);
  assert.ok(RS.monthsIn(db).indexOf("2026-11|monthly") >= 0);
});

test("a newer site list can remove a site and an equal revision keeps both", () => {
  const local = base(doneReport("2026-10", "October dim", "oct"));
  local.metaRev = 2;
  local.sites = [SITES[0]];
  const remote = base(doneReport("2026-10", "October dim", "oct"));
  remote.metaRev = 1;
  let merged = RS.mergeDb(local, remote);
  assert.deepEqual(merged.sites.map(function (s) { return s.id; }), ["cs2"]);
  local.metaRev = 1;
  remote.metaRev = 1;
  local.sites = [SITES[0]];
  remote.sites = SITES.slice();
  merged = RS.mergeDb(local, remote);
  assert.deepEqual(merged.sites.map(function (s) { return s.id; }).sort(), ["cs2", "cs3", "saani"]);
  assert.ok(RS.monthsIn(merged).indexOf("2026-10|monthly") >= 0);
});

test("merging a backup adds its months and keeps a newer local October", () => {
  const localOct = doneReport("2026-10", "Amended October", "oct");
  localOct.rev = 4;
  const oldOct = doneReport("2026-10", "Original October", "oct-old");
  oldOct.rev = 1;
  const local = base(doneReport("2026-11", "", "nov"), [localOct]);
  const backup = base(oldOct, [doneReport("2026-05", "May", "may"), oldOct]);
  const merged = RS.mergeDb(local, backup);
  const oct = merged.reports.filter(function (r) { return r.month === "2026-10"; })[0];
  assert.equal(oct.results.cs2.faults[0].note, "Amended October");
  assert.ok(RS.monthsIn(merged).indexOf("2026-05|monthly") >= 0);
  assert.ok(RS.monthsIn(merged).indexOf("2026-11|monthly") >= 0);
});

test("a site note is saved with the month before sign-off and survives opening another month", () => {
  let db = base(RS.newReport("2026-10", "monthly", []));
  db.current.results.cs2 = {
    checked: false, faults: [], fire: "", fireNote: "", note: "Gate code 1234", noteSet: true
  };
  db = RS.persistCurrent(db);
  assert.equal(db.current.done, false);
  assert.ok(RS.monthsIn(db).indexOf("2026-10|monthly") >= 0);
  const rev = db.current.rev;
  db = RS.activateMonth(db, "2026-11", "monthly", { sinceLabel: "October 2026" });
  db.current.results.cs3 = {
    checked: false, faults: [], fire: "", fireNote: "ZONE 1 lamp", fireNoteSet: true, note: ""
  };
  db = RS.persistCurrent(db);
  db = RS.activateMonth(db, "2026-10", "monthly");
  assert.equal(db.current.results.cs2.note, "Gate code 1234");
  assert.equal(db.current.rev, rev, "reopening an unchanged month must not outrank the saved notes");
  const nov = db.reports.filter(function (r) { return r.month === "2026-11"; })[0];
  assert.equal(nov.results.cs3.fireNote, "ZONE 1 lamp");
  assert.equal(nov.done, false);
  db = RS.activateMonth(db, "2026-11", "monthly");
  assert.equal(db.current.results.cs3.fireNote, "ZONE 1 lamp");
  assert.ok(RS.monthsIn(db).indexOf("2026-10|monthly") >= 0);
});

test("a newer cloud copy that never stored the note does not drop it", () => {
  let local = base(RS.newReport("2026-11", "monthly", []));
  local.current.results.cs2 = {
    checked: true, faults: [], fire: "", fireNote: "", note: "Ryan: loft key in the office", noteSet: true
  };
  local.current.results.saani = {
    checked: true,
    faults: [{ ref: "Bulkhead", status: "dim", note: "Left of the door", photo: "" }],
    fire: "fault", fireNote: "Zone 1", fireNoteSet: true, note: ""
  };
  local = RS.persistCurrent(local);
  const remote = base({
    id: "nov-switch",
    month: "2026-11",
    type: "monthly",
    rev: 9,
    done: false,
    engineer: "Ryan Harper",
    date: "2026-11-05",
    sig: "",
    carry: [],
    savedAt: "2026-11-05T12:00:00.000Z",
    results: {
      cs2: { checked: true, faults: [], fire: "", fireNote: "", note: "" },
      saani: { checked: true, faults: [], fire: "", fireNote: "", note: "" }
    }
  });
  const merged = RS.mergeDb(local, remote);
  assert.equal(merged.current.month, "2026-11");
  assert.equal(merged.current.results.cs2.note, "Ryan: loft key in the office");
  assert.equal(merged.current.results.saani.fireNote, "Zone 1");
  assert.equal(merged.current.results.saani.fire, "fault");
  assert.equal(merged.current.results.saani.faults[0].note, "Left of the door");
  const again = RS.mergeDb(merged, remote);
  assert.equal(again.current.results.cs2.note, "Ryan: loft key in the office");
  assert.equal(again.current.results.cs2.note.indexOf("\n"), -1);
  const signed = doneReport("2026-10", "October dim", "oct");
  const withSigned = RS.mergeDb(again, base(signed, [signed]));
  assert.equal(withSigned.reports.filter(function (r) { return r.month === "2026-10"; })[0].done, true);
  assert.equal(withSigned.current.results.cs2.note, "Ryan: loft key in the office");
});

test("a longer note is kept and an explicit clear on a newer save stays cleared", () => {
  const older = doneReport("2026-07", "July fault", "jul");
  older.results.cs2.note = "Call before arrival";
  older.rev = 2;
  const longer = doneReport("2026-07", "July fault", "jul");
  longer.results.cs2.note = "Call before arrival. Gate code 1234";
  longer.results.cs2.noteSet = true;
  longer.rev = 3;
  let merged = RS.mergeDb(base(longer, [longer]), base(older, [older]));
  let jul = merged.reports.filter(function (r) { return r.month === "2026-07"; })[0];
  assert.equal(jul.results.cs2.note, "Call before arrival. Gate code 1234");
  assert.equal(jul.results.cs2.faults[0].note, "July fault");

  const cleared = doneReport("2026-07", "July fault", "jul");
  cleared.results.cs2.note = "";
  cleared.results.cs2.noteSet = true;
  cleared.rev = 6;
  merged = RS.mergeDb(base(cleared, [cleared]), base(longer, [longer]));
  jul = merged.reports.filter(function (r) { return r.month === "2026-07"; })[0];
  assert.equal(jul.results.cs2.note, "");
  assert.equal(jul.results.cs2.faults[0].note, "July fault");
  assert.equal(jul.done, true);
});

test("switching month without an edit does not bump the revision", () => {
  let db = base(doneReport("2026-10", "October dim", "oct"));
  db.current = doneReport("2026-10", "October dim", "oct");
  db = RS.persistCurrent(db);
  const rev = db.reports.filter(function (r) { return r.month === "2026-10"; })[0].rev;
  db = RS.activateMonth(db, "2026-11", "monthly", { sinceLabel: "October 2026" });
  db = RS.activateMonth(db, "2026-10", "monthly");
  assert.equal(db.current.rev, rev);
  assert.equal(db.current.results.cs2.faults[0].note, "October dim");
  db = RS.persistCurrent(db);
  assert.equal(db.current.rev, rev);
});
