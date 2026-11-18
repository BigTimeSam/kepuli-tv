-- Runs JavaScript in Safari's Kepuli-TV tab (the extension's player page) and returns its result.
on run argv
  tell application "Safari"
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) starts with "safari-web-extension://" then return (do JavaScript (item 1 of argv) in t)
      end repeat
    end repeat
    return "no extension tab"
  end tell
end run
