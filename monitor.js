// monitor.js — Self-Healing Monitor for Hermes Agent
// Cek semua service setiap 10 menit, auto-fix & lapor via Telegram

const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);

const MONITOR_INTERVAL = 10 * 60 * 1000; // 10 menit
const LOG_FILE = path.join(__dirname, 'monitor.log');

let botInstance = null;
let ownerChatId = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initMonitor(bot, ownerId) {
  botInstance = bot;
  ownerChatId = ownerId;
  console.log('[Monitor] Self-healing monitor aktif — interval 10 menit');
  
  // Cek pertama langsung saat startup (delay 30 detik biar bot ready dulu)
  setTimeout(() => runAllChecks(), 30 * 1000);
  
  // Lalu setiap 10 menit
  setInterval(() => runAllChecks(), MONITOR_INTERVAL);
}

// ─── LOGGER ───────────────────────────────────────────────────────────────────
function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log('[Monitor]', msg);
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
}

// ─── KIRIM NOTIF KE TELEGRAM ──────────────────────────────────────────────────
async function notify(message) {
  if (!botInstance || !ownerChatId) return;
  try {
    await botInstance.telegram.sendMessage(ownerChatId, message, { parse_mode: 'Markdown' });
  } catch (e) {
    log(`Gagal kirim notif: ${e.message}`);
  }
}

// ─── HELPER: JALANKAN SHELL ───────────────────────────────────────────────────
async function shell(cmd, timeoutMs = 15000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
    return { ok: true, output: (stdout || stderr || '').trim() };
  } catch (err) {
    return { ok: false, output: err.message };
  }
}

// ─── CHECK 1: 9ROUTER ─────────────────────────────────────────────────────────
async function check9Router() {
  log('Cek 9Router...');
  
  // Cek apakah port 20128 listening
  const portCheck = await shell('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:20128/');
  
  if (portCheck.ok && ['200','301','302','303','307','308'].includes(portCheck.output)) {
    log('9Router: OK');
    return { status: 'ok', name: '9Router' };
  }

  // Port tidak respond — coba restart
  log('9Router: DOWN — mencoba restart...');
  
  // Cari proses 9router
  const findProc = await shell('pgrep -f "9router" | head -1');
  if (findProc.ok && findProc.output) {
    await shell(`kill ${findProc.output}`);
    await sleep(2000);
  }
  
  // Restart 9router
  const restart = await shell('nohup 9router > /tmp/9router.log 2>&1 &');
  await sleep(5000);
  
  // Cek lagi
  const recheck = await shell('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:20128/');
  if (recheck.ok && (recheck.output === '200' || recheck.output === '301' || recheck.output === '302')) {
    log('9Router: berhasil di-restart');
    return { status: 'fixed', name: '9Router', action: 'Restart berhasil ✅' };
  }
  
  log('9Router: gagal restart');
  return { status: 'error', name: '9Router', action: 'Gagal restart — perlu cek manual ❌' };
}

// ─── CHECK 2: NVIDIA API ──────────────────────────────────────────────────────
async function checkNvidiaAPI() {
  log('Cek NVIDIA API...');
  
  const apiKey = process.env.NVIDIA_API_KEY || '';
  if (!apiKey) {
    // Coba baca dari 9router config
    return { status: 'skip', name: 'NVIDIA API', action: 'API key tidak ditemukan di env' };
  }

  try {
    const response = await axios.get('https://integrate.api.nvidia.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000
    });
    
    if (response.status === 200) {
      log('NVIDIA API: OK');
      return { status: 'ok', name: 'NVIDIA API' };
    }
  } catch (err) {
    const status = err.response?.status;
    
    if (status === 401) {
      log('NVIDIA API: Key expired/invalid');
      return { status: 'error', name: 'NVIDIA API', action: 'API key expired atau invalid — perlu generate key baru di build.nvidia.com ❌' };
    }
    
    if (status === 429) {
      log('NVIDIA API: Rate limit');
      return { status: 'warn', name: 'NVIDIA API', action: 'Rate limit hit — 9Router akan auto-fallback ke model lain ⚠️' };
    }
    
    log(`NVIDIA API: Error ${status || err.message}`);
    return { status: 'warn', name: 'NVIDIA API', action: `Error: ${err.message} ⚠️` };
  }
}

// ─── CHECK 3: VPS DISK ────────────────────────────────────────────────────────
async function checkDisk() {
  log('Cek disk usage...');
  
  const result = await shell("df / --output=pcent | tail -1 | tr -d ' %'");
  if (!result.ok) return { status: 'skip', name: 'Disk' };
  
  const usagePercent = parseInt(result.output);
  log(`Disk: ${usagePercent}% terpakai`);
  
  if (usagePercent >= 90) {
    // Kritis — hapus log lama
    log('Disk kritis — membersihkan log lama...');
    await shell('find /tmp -name "*.log" -mtime +3 -delete 2>/dev/null');
    await shell('journalctl --vacuum-time=2d 2>/dev/null || true');
    
    const afterClean = await shell("df / --output=pcent | tail -1 | tr -d ' %'");
    const newUsage = parseInt(afterClean.output || usagePercent);
    
    return {
      status: 'fixed',
      name: 'Disk',
      action: `Disk ${usagePercent}% → ${newUsage}% setelah bersih-bersih log lama 🧹`
    };
  }
  
  if (usagePercent >= 75) {
    return { status: 'warn', name: 'Disk', action: `Disk ${usagePercent}% — mulai penuh, pantau terus ⚠️` };
  }
  
  return { status: 'ok', name: 'Disk', action: `${usagePercent}% terpakai` };
}

// ─── CHECK 4: RAM ─────────────────────────────────────────────────────────────
async function checkRAM() {
  log('Cek RAM...');
  
  const result = await shell("free | awk '/Mem:/ {printf \"%.0f\", $3/$2 * 100}'");
  if (!result.ok) return { status: 'skip', name: 'RAM' };
  
  const usagePercent = parseInt(result.output);
  log(`RAM: ${usagePercent}% terpakai`);
  
  if (usagePercent >= 90) {
    // Coba clear cache
    log('RAM kritis — membersihkan cache...');
    await shell('sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true');
    
    const afterClean = await shell("free | awk '/Mem:/ {printf \"%.0f\", $3/$2 * 100}'");
    const newUsage = parseInt(afterClean.output || usagePercent);
    
    return {
      status: 'fixed',
      name: 'RAM',
      action: `RAM ${usagePercent}% → ${newUsage}% setelah clear cache 🧹`
    };
  }
  
  if (usagePercent >= 80) {
    return { status: 'warn', name: 'RAM', action: `RAM ${usagePercent}% — tinggi ⚠️` };
  }
  
  return { status: 'ok', name: 'RAM', action: `${usagePercent}% terpakai` };
}

// ─── CHECK 5: KONEKSI INTERNET ────────────────────────────────────────────────
async function checkInternet() {
  log('Cek koneksi internet...');
  
  const result = await shell('curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://api.telegram.org');
  
  if (result.ok && ['200','301','302','303','307','308'].includes(result.output)) {
    log('Internet: OK');
    return { status: 'ok', name: 'Internet' };
  }
  
  log('Internet: tidak bisa reach Telegram API');
  return { status: 'error', name: 'Internet', action: 'Tidak bisa reach Telegram API — cek koneksi VPS ❌' };
}

// ─── RUN SEMUA CHECKS ─────────────────────────────────────────────────────────
async function runAllChecks() {
  log('=== Mulai health check ===');
  
  const results = await Promise.all([
    check9Router(),
    checkNvidiaAPI(),
    checkDisk(),
    checkRAM(),
    checkInternet()
  ]);
  
  // Filter yang perlu dilaporkan (bukan 'ok')
  const issues = results.filter(r => r.status !== 'ok' && r.status !== 'skip');
  const fixed = results.filter(r => r.status === 'fixed');
  const errors = results.filter(r => r.status === 'error');
  const warns = results.filter(r => r.status === 'warn');
  
  log(`Health check selesai: ${errors.length} error, ${warns.length} warning, ${fixed.length} fixed`);
  
  // Kalau semua OK, tidak perlu notif (biar tidak spam)
  if (issues.length === 0) {
    log('Semua service OK — tidak ada notif');
    return;
  }
  
  // Buat laporan
  let report = `🔍 *Health Check Report*\n`;
  report += `🕐 ${new Date().toLocaleString('id-ID')}\n\n`;
  
  if (fixed.length > 0) {
    report += `✅ *Auto-fixed:*\n`;
    fixed.forEach(r => report += `• *${r.name}*: ${r.action}\n`);
    report += '\n';
  }
  
  if (errors.length > 0) {
    report += `❌ *Perlu perhatian:*\n`;
    errors.forEach(r => report += `• *${r.name}*: ${r.action}\n`);
    report += '\n';
  }
  
  if (warns.length > 0) {
    report += `⚠️ *Warning:*\n`;
    warns.forEach(r => report += `• *${r.name}*: ${r.action}\n`);
  }
  
  await notify(report);
}

// ─── COMMAND: /STATUS ─────────────────────────────────────────────────────────
async function getStatusReport() {
  log('Manual status check diminta...');
  
  const results = await Promise.all([
    check9Router(),
    checkNvidiaAPI(),
    checkDisk(),
    checkRAM(),
    checkInternet()
  ]);
  
  const emoji = { ok: '✅', fixed: '🔧', error: '❌', warn: '⚠️', skip: '⏭️' };
  
  let report = `📊 *Status Report*\n`;
  report += `🕐 ${new Date().toLocaleString('id-ID')}\n\n`;
  
  results.forEach(r => {
    report += `${emoji[r.status] || '❓'} *${r.name}*`;
    if (r.action) report += `: ${r.action}`;
    report += '\n';
  });
  
  report += `\n🔄 Monitor interval: setiap 10 menit`;
  
  return report;
}

// ─── HELPER ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
module.exports = { initMonitor, runAllChecks, getStatusReport };
