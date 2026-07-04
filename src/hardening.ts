// Security hardening — imported first in main.tsx so it runs before any
// spreadsheet is parsed.
//
// The app parses externally-sourced .xlsx files with SheetJS (xlsx) 0.18.5,
// which is affected by CVE-2023-30533 (prototype pollution). The patched
// SheetJS build is only published on cdn.sheetjs.com (npm is frozen at
// 0.18.5), so until that upgrade lands we neutralize the prototype-pollution
// vector by freezing Object.prototype. Verified not to affect normal xlsx
// read/write.
Object.freeze(Object.prototype);

export {};
