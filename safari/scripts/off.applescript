-- Turns the Kepuli-TV extension off in Safari's settings, before its files are built again:
-- Safari reads an extension's files when the extension is turned on, not when its page is loaded again.
on run
  with timeout of 60 seconds
    tell application "System Events" to tell process "Safari"
      click menu item "Developer Settings…" of menu 1 of menu bar item "Develop" of menu bar 1
      delay 2
      set all_ to entire contents of window "Developer"
      repeat with c in all_
        try
          if (role of c) is "AXButton" and (title of c) is "Extensions" then
            click c
            exit repeat
          end if
        end try
      end repeat
      delay 3
      set said to "extension: not listed"
      set all_ to entire contents of window "Extensions"
      set lastBox to missing value
      repeat with c in all_
        try
          if (role of c) is "AXCheckBox" then set lastBox to c
          if (role of c) is "AXStaticText" then
            if (value of c) starts with "Kepuli-TV" then
              if (value of lastBox) is 1 then click lastBox
              delay 2
              set said to "extension = " & (value of lastBox)
              exit repeat
            end if
          end if
        end try
      end repeat
      click (first button of window "Extensions" whose subrole is "AXCloseButton")
      return said
    end tell
  end timeout
end run
