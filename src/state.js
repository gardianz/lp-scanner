import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "./notify.js";

// State polling + cooldown disimpan ke disk. Tanpa ini, tiap restart VPS mengirim
// ulang semua kartu yang baru saja dikirim.
const VERSION = 1;

export function createPollState(filePath) {
  let seen = new Map();      // address -> array boolean scan terakhir
  let lastAlert = new Map(); // address -> epoch ms

  if (filePath) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      if (raw?.version === VERSION) {
        seen = new Map(Object.entries(raw.seen ?? {}));
        lastAlert = new Map(Object.entries(raw.lastAlert ?? {}));
        log("info", `state dimuat dari ${filePath} (${lastAlert.size} token dalam cooldown)`);
      } else if (raw) {
        log("warn", `state ${filePath} versi ${raw.version} tidak cocok — mulai dari kosong`);
      }
    } catch (err) {
      if (err.code !== "ENOENT") log("warn", `state ${filePath} tidak terbaca (${err.message}) — mulai dari kosong`);
    }
  }

  let warnedPersist = false;
  const persist = (cooldownMinutes) => {
    if (!filePath) return;
    // Buang jejak lama supaya file tidak tumbuh tanpa batas di proses 24 jam.
    const horizon = Date.now() - Math.max(cooldownMinutes * 60000 * 3, 86400000);
    for (const [addr, ts] of lastAlert) if (ts < horizon) lastAlert.delete(addr);
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({
        version: VERSION,
        updatedAt: new Date().toISOString(),
        seen: Object.fromEntries(seen),
        lastAlert: Object.fromEntries(lastAlert),
      }));
      renameSync(tmp, filePath); // rename atomik: file tidak pernah setengah tertulis
    } catch (err) {
      // Proses 24 jam: cukup sekali diberi tahu, jangan satu baris error tiap scan.
      if (!warnedPersist) {
        warnedPersist = true;
        const hint = err.code === "EACCES" || err.code === "EPERM"
          ? ` — buat direktorinya dan beri izin tulis, atau arahkan stateFile ke path lain`
          : "";
        log("error", `gagal menyimpan state ke ${filePath}: ${err.message}${hint}. Cooldown tidak akan bertahan setelah restart.`);
      }
    }
  };

  return {
    // `scope` membatasi pembaruan ke satu chain: scan chain A tidak boleh dihitung
    // sebagai "tidak muncul" untuk token chain B yang belum discan pada siklus ini.
    record(keys, windowSize, scope = null) {
      const present = new Set(keys);
      const inScope = (k) => scope === null || k.startsWith(`${scope}:`);
      for (const addr of new Set([...[...seen.keys()].filter(inScope), ...present])) {
        const arr = seen.get(addr) ?? [];
        arr.push(present.has(addr));
        while (arr.length > windowSize) arr.shift();
        if (arr.some(Boolean)) seen.set(addr, arr);
        else seen.delete(addr);
      }
    },
    hits(addr) {
      return (seen.get(addr) ?? []).filter(Boolean).length;
    },
    shouldAlert(addr, o) {
      if (this.hits(addr) < o.confirm) return false;
      const last = lastAlert.get(addr) ?? 0;
      if (Date.now() - last < o.cooldown * 60000) return false;
      lastAlert.set(addr, Date.now());
      return true;
    },
    persist,
  };
}
