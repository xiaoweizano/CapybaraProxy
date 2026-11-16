import { runPowerShell } from "./tauri-cdp.mjs";

const INTERNET_SETTINGS_KEY =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const STARTUP_RUN_KEY =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function encodePayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export async function readWindowsStage4Registry() {
  const output = await runPowerShell(`
    function Read-Value([string]$keyPath, [string]$name) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyPath, $false);
      try {
        if ($null -eq $key -or -not ($key.GetValueNames() -contains $name)) {
          return [ordered]@{ exists = $false }
        }
        $kind = $key.GetValueKind($name).ToString();
        $value = $key.GetValue(
          $name,
          $null,
          [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        );
        return [ordered]@{
          exists = $true
          kind = $kind
          value = $value
        }
      } finally {
        if ($null -ne $key) {
          $key.Dispose()
        }
      }
    }

    [ordered]@{
      proxyEnable = Read-Value '${INTERNET_SETTINGS_KEY}' 'ProxyEnable'
      proxyServer = Read-Value '${INTERNET_SETTINGS_KEY}' 'ProxyServer'
      startup = Read-Value '${STARTUP_RUN_KEY}' 'FlowProxy'
    } | ConvertTo-Json -Depth 6 -Compress
  `);

  return JSON.parse(output);
}

export async function applyWindowsStage4Registry(state) {
  const payload = encodePayload(state);
  await runPowerShell(`
    $state = [Text.Encoding]::UTF8.GetString(
      [Convert]::FromBase64String('${payload}')
    ) | ConvertFrom-Json;

    function Set-Value(
      [string]$keyPath,
      [string]$name,
      [object]$entry
    ) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(
        $keyPath,
        $true
      );
      try {
        if (-not $entry.exists) {
          $key.DeleteValue($name, $false);
          return
        }
        $kind = [Microsoft.Win32.RegistryValueKind]::$($entry.kind);
        $key.SetValue($name, $entry.value, $kind);
      } finally {
        $key.Dispose()
      }
    }

    Set-Value '${INTERNET_SETTINGS_KEY}' 'ProxyEnable' $state.proxyEnable;
    Set-Value '${INTERNET_SETTINGS_KEY}' 'ProxyServer' $state.proxyServer;
    Set-Value '${STARTUP_RUN_KEY}' 'FlowProxy' $state.startup;
  `);
}

export function registryValuesEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
