-- Starts Safari with the locally built Kepuli-TV extension on, and opens the player.
-- Safari forgets "Allow unsigned extensions" when it quits, and reads an extension's files only when it starts.
on tick(win, want)
  tell application "System Events" to tell process "Safari"
    set all_ to entire contents of window win
    repeat with c in all_
      try
        if (role of c) is "AXCheckBox" then
          if (title of c) contains want then
            if (value of c) is 0 then click c
            delay 1
            return (title of c) & " = " & (value of c)
          end if
        end if
      end try
    end repeat
    return want & ": not found"
  end tell
end tick

on pressButton(win, want)
  tell application "System Events" to tell process "Safari"
    set all_ to entire contents of window win
    repeat with c in all_
      try
        if (role of c) is "AXButton" then
          if (title of c) is want then
            click c
            return true
          end if
        end if
      end try
    end repeat
    return false
  end tell
end pressButton

on run argv
  -- "unsigned": the extension is signed ad hoc, and Safari's switch for such is ticked first (it asks the user's password).
  set adhoc to ((count of argv) > 0 and (item 1 of argv) is "unsigned")
  set said to ""
  tell application "Safari" to activate
  delay 3
  tell application "System Events" to tell process "Safari"
    click menu item "Developer Settings…" of menu 1 of menu bar item "Develop" of menu bar 1
  end tell
  delay 2
  if adhoc then set said to said & my tick("Developer", "unsigned") & "; "
  set said to said & my tick("Developer", "Apple Events") & "; "
  my pressButton("Developer", "Extensions")
  delay 3
  -- The extension's own checkbox: the one beside its name.
  tell application "System Events" to tell process "Safari"
    set all_ to entire contents of window "Extensions"
    set lastBox to missing value
    set done to false
    repeat with c in all_
      try
        if (role of c) is "AXCheckBox" then set lastBox to c
        if (role of c) is "AXStaticText" and not done then
          if (value of c) starts with "Kepuli-TV" then
            if (value of lastBox) is 0 then click lastBox
            delay 1
            set said to said & "extension = " & (value of lastBox) & "; "
            set done to true
          end if
        end if
      end try
    end repeat
    if not done then set said to said & "extension: not listed; "
    -- The settings window closed, the toolbar button pressed.
    click (first button of window "Extensions" whose subrole is "AXCloseButton")
    delay 1
    set bw to window 1
    set all_ to entire contents of bw
    repeat with c in all_
      try
        if (role of c) is "AXButton" then
          if (description of c) contains "Kepuli" then
            click c
            set said to said & "toolbar button pressed"
            exit repeat
          end if
        end if
      end try
    end repeat
  end tell
  return said
end run
