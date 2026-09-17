!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.papermotion.engine" "" "$INSTDIR\com.papermotion.engine.json"
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.papermotion.engine" "" "$INSTDIR\com.papermotion.engine.json"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.papermotion.engine"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.papermotion.engine"
!macroend