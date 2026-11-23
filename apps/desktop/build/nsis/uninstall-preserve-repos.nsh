; Preserves user Git repositories unconditionally. AppData cache removal is opt-in only.
!macro customUninstall
  MessageBox MB_YESNO "Remove cached EF Harness AppData (logs, components cache)? Your Git repositories are never deleted." /SD IDNO IDYES clear_cache IDNO keep_cache
  clear_cache:
    RMDir /r "$LOCALAPPDATA\EFHarness\cache"
    Goto done
  keep_cache:
  done:
!macroend