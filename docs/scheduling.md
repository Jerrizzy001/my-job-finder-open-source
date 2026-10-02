# Running it on a schedule

`jobfinder run` is safe to run as often as you like: boards are only re-read when their cadence (six hours by default) has passed, matches already current are skipped, and jobs that already have a draft are not drafted again.

## cron (Linux, macOS)

`crontab -e`, then, every morning at 7:

```cron
0 7 * * * cd "$HOME/job-search" && /usr/local/bin/node /path/to/my-job-finder-open-source/packages/cli/bin/jobfinder.js run >> "$HOME/job-search/run.log" 2>&1
```

Use the absolute path to `node` from `which node`; cron has a short PATH.

## launchd (macOS)

Save as `~/Library/LaunchAgents/local.jobfinder.run.plist`, fixing the paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.jobfinder.run</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/my-job-finder-open-source/packages/cli/bin/jobfinder.js</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/job-search</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/you/job-search/run.log</string>
  <key>StandardErrorPath</key><string>/Users/you/job-search/run.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/local.jobfinder.run.plist
```

## Or leave the UI running

`jobfinder serve` re-reads due boards every minute it is running, so with the UI open you do not need a schedule at all.
