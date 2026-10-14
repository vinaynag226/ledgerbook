# LedgerBook timetable file

Paste this into the chat (Claude, Gemini or ChatGPT) that makes your race timetable:

> Give the timetable as one JSON file in exactly this shape. Times are IST, 24-hour.
> `ist_date` is the calendar date of the IST time, so a race after midnight gets the next date.
> `planner_priority` is one of TOP, HIGH, MEDIUM, WATCH.
> Fill `created_by` with your own name and `created_at` with the current IST time.

```json
{
  "ledgerbook_format": 1,
  "created_by": "FHE planner · ChatGPT",
  "created_at": "2026-10-14T09:12+05:30",
  "race_day": "2026-10-14",
  "races": [
    {
      "country": "United Kingdom",
      "track": "Kempton",
      "race_number": 7,
      "ist_time": "00:00",
      "ist_date": "2026-10-15",
      "active_runners_reported": 11,
      "race_name": "Example Handicap",
      "planner_priority": "TOP"
    }
  ]
}
```

What the app does with each part:

| Field | Used for |
|---|---|
| created_by, created_at | The line on the home screen: who made the file and when |
| race_day | Which day the races belong to (races before 05:00 IST stay on this day) |
| planner_priority | TOP and HIGH go to Focus with alerts. MEDIUM and WATCH stay folded and silent until you tap them or enter picks |
| active_runners_reported | Payout places (top 2/3/4) |
| ist_time + ist_date | Jump time; the date check catches after-midnight mistakes |

Loading a newer file for the same day updates times, runners and priorities. It never makes duplicates.
Older planner files without the header still load.
