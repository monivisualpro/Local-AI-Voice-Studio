; Inno Setup Script (.iss) for Local AI Voice Studio
; Generated for Moni Visual Pro
; Requires Inno Setup 6 (https://jrsoftware.org/isdl.php)

#define MyAppName "Local AI Voice Studio"
#define MyAppVersion "0.20.0"
#define MyAppPublisher "Moni Visual Pro"
#define MyAppURL "https://github.com/monivisualpro/local-ai-voice-studio"
#define MyAppExeName "Local AI Voice Studio.exe"

[Setup]
; Basic Application Identification
AppId={{E65B9F42-8D99-4A73-A33B-E1A4795C60B4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Default Install Locations
DefaultDirName={autopf}\{#MyAppPublisher}\{#MyAppName}
DefaultGroupName={#MyAppPublisher}\{#MyAppName}
DisableProgramGroupPage=auto

; Privileges and Modern Windows Settings
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputBaseFilename=Local_AI_Voice_Studio_Setup_v0.20.0
OutputDir=installer_output
; Compression and modern Windows settings
; Both values can be overridden for quick test builds, e.g.:
;   ISCC.exe /DCompressionMode=none /DSolidMode=no installer.iss
#ifndef CompressionMode
  #define CompressionMode "lzma2/ultra64"
#endif
#ifndef SolidMode
  #define SolidMode "yes"
#endif
Compression={#CompressionMode}
SolidCompression={#SolidMode}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

; Icon references (uses bundled favicon or icon.ico if present)
SetupIconFile=build\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; Version information in binary metadata
VersionInfoVersion=0.20.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Local AI Voice Studio Setup - Develop by Moni Visual Pro
VersionInfoCopyright=Copyright (C) 2026 {#MyAppPublisher}
VersionInfoProductName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The Electron application bundle produced by electron-builder.
; Build it first with:  build-inno-installer.bat
;   (or: npm run build  then  npx electron-builder --win --dir --config electron-builder.json -c.directories.output=release/windows)
; Compile-time guard so the compiler fails with a clear message instead of
; silently producing an installer that cannot start the app.
#if !DirExists(AddBackslash(SourcePath) + "release\windows\win-unpacked")
  #error release\windows\win-unpacked is missing. Run build-inno-installer.bat (or "npm run build" then "npx electron-builder --win --dir --config electron-builder.json -c.directories.output=release/windows") before compiling this installer.
#endif

Source: "release\windows\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall skipifsilent

