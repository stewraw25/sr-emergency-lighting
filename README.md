# SR Emergency Lighting Checks

Mobile app for recording monthly emergency lighting function tests and the annual
3-hour duration test, to BS 5266-1.

Built for **SR Electrical & Security** (Stewart Rawson Electrical Ltd).

## Signing in

Use the same name and password as the SR Holiday Tracker. Signing in connects this
phone to the shared record the office uses. A check saved on site is written to
that shared record, and the office computer shows it once it next syncs. The
same is true in the other direction.

The shared record is the Firebase database already used by the holiday tracker
(`sr-lighting/v1`). This site is static GitHub Pages: the pages themselves do
not store reports. The browser keeps a copy so a round can be finished with no
signal, then merged into the shared record when the connection is back. The
chip in the top bar shows **Synced** or **Offline**.

Open the updated app on every phone and on the office computer. An old copy of
the page can still replace the shared record with whatever that browser last
had. After every device is on this version, a save merges months together, so
one phone's older snapshot cannot delete a month that another phone still has.

## Use it on a phone

Open:

**https://stewraw25.github.io/sr-emergency-lighting/**

Then **Share → Add to Home Screen**. It runs full screen. With no signal the
round stays on that phone and is merged up after you are back in coverage.

The round (sites, isolation notes, outstanding faults) is pre-loaded. First open
shows all 10 Wingetts sites ready to check.

## What it does

- Defaults every site to "all working" — you only record exceptions
- Shows isolation and access notes for each site
- Carries unresolved faults forward month to month until they're cleared
- Photos from the phone camera against any fault
- On-screen signature, then a branded PDF ready to email the managing agent
- Keeps every saved month (monthly and annual) and opens it again from Previous reports
- Keeps site notes and panel notes with that month, including notes written before sign-off
- Back up and restore your data as a file

## Where reports live

Each saved month is kept in two places:

1. **Shared record** (Firebase), once you are signed in. This is the copy the
   office and the phones share. It is the long-term record.
2. **This browser**, so the round is still there with no signal, and so a bad
   sync cannot wipe a month this phone has already saved. The browser copy is
   cleared if someone clears the site data, and it can fill up when many photos
   are stored. It is not the shared record.

Menu → **Back up data** downloads every saved month, including the one open now,
as a JSON file. Keep that file somewhere outside the phone (email it to the
office, or save it on the office computer). **Restore from back-up** merges the
file in: months already stored are kept, and months that exist only in the file
are added.

Previous reports lists every saved month except the one open now, which is shown
at the top of that screen. Signing a month files it immediately. Starting or
opening another month leaves the one you were on in the list.

Site notes, fire-panel notes and fault notes are part of that month. They are
not a separate list. Closing a site, logging a fault, or switching month saves
the note that is on screen. A note-only site shows "note saved" on the round.
Signed in, those notes sync with the office and the phones. A newer copy of the
same month that never had the note does not wipe it. Clearing the note on this
phone and saving the site does remove it.

## Restoring a month that disappeared before this fix

October 2026 is not stored in this repository. The app can put it back only if a
phone or the office computer still has it, including inside the old offline
queue. On each device that was used for the October round, open this updated
app **before clearing the browser or site data**. If that device still has the
month, it is merged back into Previous reports and, once you sign in, written
up to the shared record.

If no device still has it, and there is no backup file, the October report
cannot be rebuilt from the code. Complete it again, or restore a backup file
if one was downloaded at the time.

## Checks

```
npm test
npm run build
```

`npm test` checks saving, listing, reopening and keeping several months,
including a cloud snapshot that has lost October. `npm run build` repeats those
checks and loads the production page (the same `index.html` GitHub Pages
serves) to save October, November and September, list them, reopen October,
and reject a stale snapshot.
