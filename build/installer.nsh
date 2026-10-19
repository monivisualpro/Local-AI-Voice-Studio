; Extra installer page for Local AI Voice Studio (Windows).
; Page 1 (built in):  "Choose Install Location" - pick any folder on any drive (C:, D:, E: ...).
; Page 2 (this file): "Choose Data Folder"      - models and voice engines are large (5-40 GB): pick the drive for them.
; The choice is written to <install folder>\install-config.ini; the app reads it at first start.
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include WinMessages.nsh


!ifndef BUILD_UNINSTALLER
!insertmacro GetDrives
!insertmacro GetRoot
!insertmacro DriveSpace

Var DataDir
Var DataDirText
Var DataDirFree
Var DataDirDrives

Function DataDirUpdateFree
  ${GetRoot} "$DataDir" $R0
  ${DriveSpace} "$R0\" "/D=F /S=G" $R1
  ${If} $R1 == ""
    SendMessage $DataDirFree ${WM_SETTEXT} 0 "STR:Free space: unknown (the folder will be created)"
  ${Else}
    SendMessage $DataDirFree ${WM_SETTEXT} 0 "STR:Free space on $R0 : $R1 GB"
  ${EndIf}
FunctionEnd

Function DataDirPageCreate
  ${If} $DataDir == ""
    StrCpy $DataDir "$INSTDIR\data"
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Choose Data Folder" "Where should models and voice engines be stored?"
  ${NSD_CreateLabel} 0 0 100% 36u "Language models and the Python voice engines are large (about 5 to 40 GB). Choose a drive with enough free space, for example D: or E:. You can change this later in Settings."
  Pop $0
  ${NSD_CreateLabel} 0 42u 100% 10u "Drive:"
  Pop $0
  ${NSD_CreateDropList} 0 54u 30% 80u ""
  Pop $DataDirDrives
  ${GetDrives} "HDD" DataDirAddDrive
  ${NSD_CreateLabel} 0 76u 100% 10u "Data folder:"
  Pop $0
  ${NSD_CreateText} 0 88u 78% 12u "$DataDir"
  Pop $DataDirText
  ${NSD_CreateBrowseButton} 80% 87u 20% 14u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 DataDirBrowse
  ${NSD_OnChange} $DataDirDrives DataDirDriveChanged
  ${NSD_OnChange} $DataDirText DataDirTextChanged
  ${NSD_CreateLabel} 0 108u 100% 10u ""
  Pop $DataDirFree
  Call DataDirUpdateFree
  nsDialogs::Show
FunctionEnd

Function DataDirAddDrive
  ${NSD_CB_AddString} $DataDirDrives "$9"
  Push $0
FunctionEnd

Function DataDirDriveChanged
  ${NSD_GetText} $DataDirDrives $R0
  ${If} $R0 != ""
    StrCpy $DataDir "$R0Local AI Voice Studio"
    ${NSD_SetText} $DataDirText "$DataDir"
    Call DataDirUpdateFree
  ${EndIf}
FunctionEnd

Function DataDirTextChanged
  ${NSD_GetText} $DataDirText $DataDir
  Call DataDirUpdateFree
FunctionEnd

Function DataDirBrowse
  nsDialogs::SelectFolderDialog "Choose the data folder" "$DataDir"
  Pop $0
  ${If} $0 != error
    StrCpy $DataDir "$0"
    ${NSD_SetText} $DataDirText "$DataDir"
  ${EndIf}
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirText $DataDir
  ${If} $DataDir == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a data folder."
    Abort
  ${EndIf}
FunctionEnd
!endif

!macro customPageAfterChangeDir
  Page custom DataDirPageCreate DataDirPageLeave
!macroend

!macro customInstall
  CreateDirectory "$DataDir"
  FileOpen $0 "$INSTDIR\install-config.ini" w
  FileWrite $0 "dataDir=$DataDir$\r$\n"
  FileClose $0
!macroend
