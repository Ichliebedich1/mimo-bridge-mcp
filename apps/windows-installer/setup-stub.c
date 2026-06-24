#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <wchar.h>

#define IDR_INSTALL_PS1 101
#define IDR_PAYLOAD_ZIP 102
#define COMMAND_CAPACITY 32768

static int fail_message(const wchar_t *message) {
  fwprintf(stderr, L"%ls\n", message);
  MessageBoxW(NULL, message, L"MiMo Bridge Setup", MB_ICONERROR | MB_OK);
  return 1;
}

static int print_help(void) {
  const wchar_t *message =
    L"MiMo Bridge Setup\n\n"
    L"Usage:\n"
    L"  MiMoBridgeSetup-win10-win11-x64.exe\n"
    L"  MiMoBridgeSetup-win10-win11-x64.exe -Quiet\n"
    L"  MiMoBridgeSetup-win10-win11-x64.exe -SelfTest\n"
    L"  MiMoBridgeSetup-win10-win11-x64.exe -Uninstall [-DeleteUserData]\n\n"
    L"Options:\n"
    L"  -Quiet              Install without prompts.\n"
    L"  -NoDesktopShortcut  Do not create a desktop shortcut.\n"
    L"  -Autostart          Enable per-user logon startup.\n"
    L"  -InstallDir PATH    Override the per-user install directory.\n"
    L"  -SelfTest           Validate embedded payload without installing.\n"
    L"  -Help, --help, -h, /?  Show this help.\n";
  fwprintf(stdout, L"%ls\n", message);
  MessageBoxW(NULL, message, L"MiMo Bridge Setup", MB_OK);
  return 0;
}

static int append_text(wchar_t *buffer, size_t capacity, const wchar_t *text) {
  size_t used = wcslen(buffer);
  size_t extra = wcslen(text);
  if (used + extra + 1 >= capacity) {
    return 0;
  }
  wcscat(buffer, text);
  return 1;
}

static int append_quoted_arg(wchar_t *buffer, size_t capacity, const wchar_t *text) {
  if (!append_text(buffer, capacity, L"\"")) {
    return 0;
  }
  for (const wchar_t *cursor = text; *cursor; cursor++) {
    if (*cursor == L'"') {
      if (!append_text(buffer, capacity, L"\\\"")) {
        return 0;
      }
    } else {
      wchar_t piece[2] = { *cursor, 0 };
      if (!append_text(buffer, capacity, piece)) {
        return 0;
      }
    }
  }
  return append_text(buffer, capacity, L"\"");
}

static int write_resource_to_file(int resource_id, const wchar_t *path) {
  HRSRC resource = FindResourceW(NULL, MAKEINTRESOURCEW(resource_id), RT_RCDATA);
  if (!resource) {
    return 0;
  }
  HGLOBAL loaded = LoadResource(NULL, resource);
  if (!loaded) {
    return 0;
  }
  DWORD size = SizeofResource(NULL, resource);
  void *data = LockResource(loaded);
  if (!data || size == 0) {
    return 0;
  }

  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    return 0;
  }
  DWORD written = 0;
  BOOL ok = WriteFile(file, data, size, &written, NULL);
  CloseHandle(file);
  return ok && written == size;
}

static void cleanup_temp(const wchar_t *temp_dir, const wchar_t *install_script, const wchar_t *payload_zip) {
  DeleteFileW(install_script);
  DeleteFileW(payload_zip);
  RemoveDirectoryW(temp_dir);
}

static int is_help_argument(const wchar_t *arg) {
  return _wcsicmp(arg, L"-Help") == 0 ||
         _wcsicmp(arg, L"--help") == 0 ||
         _wcsicmp(arg, L"-h") == 0 ||
         _wcsicmp(arg, L"/?") == 0 ||
         _wcsicmp(arg, L"/help") == 0;
}

static int is_known_switch_argument(const wchar_t *arg) {
  return _wcsicmp(arg, L"-Quiet") == 0 ||
         _wcsicmp(arg, L"-NoDesktopShortcut") == 0 ||
         _wcsicmp(arg, L"-Autostart") == 0 ||
         _wcsicmp(arg, L"-Uninstall") == 0 ||
         _wcsicmp(arg, L"-DeleteUserData") == 0 ||
         _wcsicmp(arg, L"-SelfTest") == 0;
}

static int is_known_value_argument(const wchar_t *arg) {
  return _wcsicmp(arg, L"-InstallDir") == 0 ||
         _wcsicmp(arg, L"-SelfTestPort") == 0;
}

static int validate_arguments(int argc, wchar_t **argv) {
  for (int i = 1; i < argc; i++) {
    if (is_help_argument(argv[i])) {
      return 2;
    }
    if (is_known_switch_argument(argv[i])) {
      continue;
    }
    if (is_known_value_argument(argv[i])) {
      if (i + 1 >= argc) {
        wchar_t message[512];
        swprintf(message, 512, L"Missing value for setup option: %ls", argv[i]);
        return fail_message(message);
      }
      i++;
      continue;
    }

    wchar_t message[512];
    swprintf(message, 512, L"Unknown setup option: %ls\n\nUse -Help to see supported options.", argv[i]);
    return fail_message(message);
  }
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  wchar_t temp_base[MAX_PATH];
  wchar_t temp_dir[MAX_PATH];
  wchar_t install_script[MAX_PATH];
  wchar_t payload_zip[MAX_PATH];

  int validation = validate_arguments(argc, argv);
  if (validation == 2) {
    return print_help();
  }
  if (validation != 0) {
    return validation;
  }

  if (!GetTempPathW(MAX_PATH, temp_base)) {
    return fail_message(L"Cannot resolve TEMP directory.");
  }
  swprintf(temp_dir, MAX_PATH, L"%lsMiMoBridgeSetup-%lu-%lu", temp_base, GetCurrentProcessId(), GetTickCount());
  if (!CreateDirectoryW(temp_dir, NULL)) {
    return fail_message(L"Cannot create setup temp directory.");
  }
  swprintf(install_script, MAX_PATH, L"%ls\\install.ps1", temp_dir);
  swprintf(payload_zip, MAX_PATH, L"%ls\\MiMoBridge-payload.zip", temp_dir);

  if (!write_resource_to_file(IDR_INSTALL_PS1, install_script) || !write_resource_to_file(IDR_PAYLOAD_ZIP, payload_zip)) {
    cleanup_temp(temp_dir, install_script, payload_zip);
    return fail_message(L"Cannot extract embedded setup payload.");
  }

  wchar_t command[COMMAND_CAPACITY];
  command[0] = 0;
  if (!append_text(command, COMMAND_CAPACITY, L"powershell.exe -NoProfile -ExecutionPolicy Bypass -File ")) {
    cleanup_temp(temp_dir, install_script, payload_zip);
    return fail_message(L"Setup command is too long.");
  }
  if (!append_quoted_arg(command, COMMAND_CAPACITY, install_script)) {
    cleanup_temp(temp_dir, install_script, payload_zip);
    return fail_message(L"Setup command is too long.");
  }
  int has_mode_argument = 0;
  for (int i = 1; i < argc; i++) {
    if (_wcsicmp(argv[i], L"-Quiet") == 0 ||
        _wcsicmp(argv[i], L"-Uninstall") == 0 ||
        _wcsicmp(argv[i], L"-SelfTest") == 0) {
      has_mode_argument = 1;
      break;
    }
  }
  if (!has_mode_argument) {
    if (!append_text(command, COMMAND_CAPACITY, L" -Quiet")) {
      cleanup_temp(temp_dir, install_script, payload_zip);
      return fail_message(L"Setup command is too long.");
    }
  }
  for (int i = 1; i < argc; i++) {
    if (!append_text(command, COMMAND_CAPACITY, L" ") || !append_quoted_arg(command, COMMAND_CAPACITY, argv[i])) {
      cleanup_temp(temp_dir, install_script, payload_zip);
      return fail_message(L"Setup command is too long.");
    }
  }

  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&process, sizeof(process));
  startup.cb = sizeof(startup);

  if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, 0, NULL, temp_dir, &startup, &process)) {
    cleanup_temp(temp_dir, install_script, payload_zip);
    return fail_message(L"Cannot start PowerShell setup script.");
  }

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exit_code = 1;
  GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  cleanup_temp(temp_dir, install_script, payload_zip);
  return (int)exit_code;
}
