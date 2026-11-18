-- Safari's permission dialog: says its text, and clicks the button named if one is given.
on run argv
  set want to ""
  if (count of argv) > 0 then set want to (item 1 of argv) as text
  with timeout of 20 seconds
    tell application "System Events" to tell process "Safari"
      repeat with w in windows
        if (subrole of w) is "AXDialog" then
          set out to ""
          set all_ to entire contents of w
          repeat with c in all_
            try
              if (role of c) is "AXStaticText" then set out to out & (value of c) & " "
            end try
          end repeat
          if want is "" then return "dialog: " & (text 1 thru 90 of out)
          repeat with c in all_
            try
              if (role of c) is "AXButton" then
                if (title of c) is want then
                  click c
                  return "clicked " & want
                end if
              end if
            end try
          end repeat
          return "no button " & want
        end if
      end repeat
      return "no dialog"
    end tell
  end timeout
end run
