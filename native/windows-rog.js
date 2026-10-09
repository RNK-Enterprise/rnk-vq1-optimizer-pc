/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Windows ROG host facts and administrator-boundary evidence. Detection is
 * observational; it never installs Armoury Crate or changes firmware policy.
 */

export const WINDOWS_ROG_VERSION = 1;
const COMMAND = Object.freeze([
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', [
    '$computer = Get-CimInstance Win32_ComputerSystem;',
    '$product = Get-CimInstance Win32_ComputerSystemProduct;',
    '$bios = Get-CimInstance Win32_BIOS;',
    '$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());',
    '[pscustomobject]@{ Manufacturer=$computer.Manufacturer; Model=$computer.Model; ProductName=$product.Name; BiosVersion=$bios.SMBIOSBIOSVersion; IsAdministrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress'
  ].join(' ')],
  { timeoutMs: 5000, maxOutputBytes: 8192 }
]);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function unavailable(reason) { return Object.freeze({ version: WINDOWS_ROG_VERSION, state: 'unavailable', isRog: false, isAdministrator: false, manufacturer: null, model: null, productName: null, biosVersion: null, reason }); }

export function parseWindowsRogFacts(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return unavailable('ROG host facts were not valid JSON'); }
  const manufacturer = text(parsed?.Manufacturer);
  const model = text(parsed?.Model);
  const productName = text(parsed?.ProductName);
  const identity = `${manufacturer || ''} ${model || ''} ${productName || ''}`.toLowerCase();
  const isAsus = /asus|asustek/.test(identity);
  const isRog = isAsus && /rog|zephyrus|strix|ally/.test(identity);
  return Object.freeze({
    version: WINDOWS_ROG_VERSION,
    state: 'observed',
    isRog,
    isAdministrator: parsed?.IsAdministrator === true,
    manufacturer,
    model,
    productName,
    biosVersion: text(parsed?.BiosVersion),
    reason: isRog ? 'ROG identity observed' : 'ROG identity not observed'
  });
}

export async function collectWindowsRogFacts({ commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return unavailable('command runner unavailable');
  try {
    const response = await commandRunner.run(COMMAND[0], COMMAND[1], COMMAND[2]);
    if (response?.code !== 0) return unavailable(response?.stderr || 'Windows host facts command failed');
    return parseWindowsRogFacts(response.stdout);
  } catch (error) { return unavailable(error.message); }
}

export function windowsRogCommand() { return { file: COMMAND[0], args: [...COMMAND[1]], options: { ...COMMAND[2] } }; }
