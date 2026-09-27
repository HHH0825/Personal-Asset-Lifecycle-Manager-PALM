; The data directory is deliberately outside {app} and is never removed here.
#ifndef AppVersion
  #error AppVersion must be supplied as /DAppVersion=1.2.3
#endif
#ifndef BundleDir
  #error BundleDir must point at the PyInstaller PALM directory
#endif
#ifndef OutputDir
  #error OutputDir must be supplied
#endif
#ifndef IconFile
  #error IconFile must be supplied
#endif

[Setup]
AppId={{D923C2A8-44F7-49B2-AC33-C86B18B4895F}
AppName=PALM 个人物品资产生命周期管理平台
AppVersion={#AppVersion}
AppPublisher=HHH0825
AppPublisherURL=https://github.com/HHH0825/Personal-Asset-Lifecycle-Manager-PALM
DefaultDirName={localappdata}\Programs\PALM
DefaultGroupName=PALM
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=PALM-Setup-v{#AppVersion}-windows-x64
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\PALM.exe

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "start.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\启动 PALM"; Filename: "{app}\start.cmd"; IconFilename: "{app}\PALM.exe"; WorkingDir: "{app}"
Name: "{group}\迁移旧数据"; Filename: "{app}\start.cmd"; Parameters: "--migrate"; IconFilename: "{app}\PALM.exe"; WorkingDir: "{app}"
Name: "{group}\卸载 PALM"; Filename: "{uninstallexe}"
