-- Presses, through accessibility, the element of the player's page in Safari whose name, title or value
-- contains the words given. AXPress counts as the viewer's own press, which a click made by script does not.
on run argv
  set want to (item 1 of argv) as text
  with timeout of 40 seconds
    tell application "System Events" to tell process "Safari"
      -- In front first: behind another app's window the page's elements were not in the accessibility tree at all.
      set frontmost to true
      delay 0.7
      repeat with w in windows
        if (subrole of w) is "AXStandardWindow" then
          set all_ to entire contents of w
          -- Buttons and links first: a label's own text would otherwise be pressed in their place.
          repeat with pass from 1 to 2
            repeat with c in all_
              try
                set r to (role of c)
                if (pass is 1 and (r is "AXButton" or r is "AXLink")) or (pass is 2) then
                  set label to ""
                  try
                    set label to label & (description of c)
                  end try
                  try
                    set label to label & " " & (title of c)
                  end try
                  try
                    set label to label & " " & (value of c)
                  end try
                  if label contains want then
                    perform action "AXPress" of c
                    return "pressed " & r & ": " & label
                  end if
                end if
              end try
            end repeat
          end repeat
        end if
      end repeat
      return "not found"
    end tell
  end timeout
end run
