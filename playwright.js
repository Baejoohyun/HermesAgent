// playwright.js — Web Automation Module for Hermes Agent
// Fitur: isi form, claim faucet, auto register, screenshot, stealth mode

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Aktifkan stealth plugin
chromium.use(StealthPlugin());

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const TASKS_FILE = path.join(__dirname, 'tasks.json');

// Buat folder screenshots kalau belum ada
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

// ─── RANDOM HELPERS ───────────────────────────────────────────────────────────
function randomString(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}

function randomUsername() {
  const prefixes = ['crypto', 'defi', 'web3', 'moon', 'hodl', 'based', 'alpha', 'degen'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${prefix}_${randomString(5)}`;
}

function randomName() {
  const first = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery'];
  const last = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── TASK STORAGE ─────────────────────────────────────────────────────────────
function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

// ─── BROWSER LAUNCH ───────────────────────────────────────────────────────────
async function launchBrowser(headless = true) {
  return await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
  });
}

// ─── SCREENSHOT ───────────────────────────────────────────────────────────────
async function takeScreenshot(page, name = 'screenshot') {
  const filename = `${name}_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

// ─── TASK 1: ISI FORM WEB ─────────────────────────────────────────────────────
async function fillForm(url, fields, options = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  const result = { success: false, message: '', screenshot: null };
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(randomInt(1000, 2000));
    
    // Isi setiap field
    for (const [selector, value] of Object.entries(fields)) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        await page.waitForTimeout(randomInt(200, 500));
        await page.fill(selector, '');
        
        // Ketik pelan-pelan biar natural
        for (const char of value) {
          await page.type(selector, char, { delay: randomInt(50, 150) });
        }
        await page.waitForTimeout(randomInt(300, 700));
      } catch (e) {
        console.log(`[Playwright] Field ${selector} tidak ditemukan, skip`);
      }
    }
    
    // Screenshot sebelum submit
    result.screenshot = await takeScreenshot(page, 'before_submit');
    
    // Submit form kalau ada submit button
    if (options.submitSelector) {
      await page.click(options.submitSelector);
      await page.waitForTimeout(3000);
      result.screenshot = await takeScreenshot(page, 'after_submit');
    }
    
    result.success = true;
    result.message = 'Form berhasil diisi';
    
    // Cek success message
    if (options.successText) {
      const content = await page.content();
      if (content.includes(options.successText)) {
        result.message = `Form berhasil! Ditemukan: "${options.successText}"`;
      }
    }
    
  } catch (err) {
    result.message = `Error: ${err.message}`;
    try { result.screenshot = await takeScreenshot(page, 'error'); } catch (e) {}
  } finally {
    await browser.close();
  }
  
  return result;
}

// ─── TASK 2: CLAIM FAUCET ─────────────────────────────────────────────────────
async function claimFaucet(url, walletAddress, options = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  const result = { success: false, message: '', screenshot: null, wallet: walletAddress };
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(randomInt(2000, 4000));
    
    // Screenshot awal
    result.screenshot = await takeScreenshot(page, 'faucet_start');
    
    // Cari input field untuk wallet address
    const walletSelectors = [
      'input[placeholder*="address"]',
      'input[placeholder*="wallet"]',
      'input[placeholder*="0x"]',
      'input[name*="address"]',
      'input[name*="wallet"]',
      'input[type="text"]',
      ...(options.walletSelector ? [options.walletSelector] : [])
    ];
    
    let walletInput = null;
    for (const selector of walletSelectors) {
      try {
        walletInput = await page.waitForSelector(selector, { timeout: 3000 });
        if (walletInput) break;
      } catch (e) {}
    }
    
    if (!walletInput) {
      result.message = 'Tidak bisa menemukan input wallet address';
      result.screenshot = await takeScreenshot(page, 'faucet_no_input');
      await browser.close();
      return result;
    }
    
    // Isi wallet address
    await walletInput.click();
    await page.waitForTimeout(randomInt(300, 600));
    await walletInput.fill(walletAddress);
    await page.waitForTimeout(randomInt(500, 1000));
    
    // Cari tombol claim/request
    const claimSelectors = [
      'button:has-text("Claim")',
      'button:has-text("Request")',
      'button:has-text("Send")',
      'button:has-text("Get")',
      'button[type="submit"]',
      ...(options.claimSelector ? [options.claimSelector] : [])
    ];
    
    let claimBtn = null;
    for (const selector of claimSelectors) {
      try {
        claimBtn = await page.waitForSelector(selector, { timeout: 3000 });
        if (claimBtn) break;
      } catch (e) {}
    }
    
    if (!claimBtn) {
      result.message = 'Tidak bisa menemukan tombol claim';
      result.screenshot = await takeScreenshot(page, 'faucet_no_button');
      await browser.close();
      return result;
    }
    
    await claimBtn.click();
    await page.waitForTimeout(5000);
    
    result.screenshot = await takeScreenshot(page, 'faucet_after_claim');
    result.success = true;
    result.message = `Claim submitted untuk wallet ${walletAddress.substring(0, 10)}...`;
    
  } catch (err) {
    result.message = `Error: ${err.message}`;
    try { result.screenshot = await takeScreenshot(page, 'faucet_error'); } catch (e) {}
  } finally {
    await browser.close();
  }
  
  return result;
}

// ─── TASK 3: BATCH CLAIM (banyak wallet) ─────────────────────────────────────
async function batchClaimFaucet(url, wallets, options = {}, onProgress = null) {
  const results = [];
  
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`[Playwright] Batch claim ${i + 1}/${wallets.length}: ${wallet.substring(0, 10)}...`);
    
    if (onProgress) await onProgress(i + 1, wallets.length, wallet);
    
    const result = await claimFaucet(url, wallet, options);
    results.push(result);
    
    // Delay antar claim biar tidak kena rate limit
    if (i < wallets.length - 1) {
      const delay = randomInt(5000, 15000);
      console.log(`[Playwright] Tunggu ${delay}ms sebelum claim berikutnya...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  return results;
}

// ─── TASK 4: AUTO REGISTER ────────────────────────────────────────────────────
async function autoRegister(url, email, options = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  const result = { success: false, message: '', screenshot: null, email };
  
  // Generate data random untuk registrasi
  const userData = {
    email,
    username: options.username || randomUsername(),
    name: options.name || randomName(),
    password: options.password || `Pass${randomString(8)}!`,
    twitterUsername: options.twitterUsername || `@${randomUsername()}`
  };
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(randomInt(1500, 3000));
    
    result.screenshot = await takeScreenshot(page, 'register_start');
    
    // Map field selectors ke values
    const fieldMap = {
      'input[type="email"]': userData.email,
      'input[name="email"]': userData.email,
      'input[placeholder*="email" i]': userData.email,
      'input[type="text"][name*="user" i]': userData.username,
      'input[placeholder*="username" i]': userData.username,
      'input[placeholder*="twitter" i]': userData.twitterUsername,
      'input[name*="twitter" i]': userData.twitterUsername,
      'input[type="password"]': userData.password,
      'input[placeholder*="name" i]': userData.name,
    };
    
    // Kalau ada custom fields dari options, override
    if (options.fields) {
      Object.assign(fieldMap, options.fields);
    }
    
    for (const [selector, value] of Object.entries(fieldMap)) {
      try {
        const el = await page.$(selector);
        if (!el) continue;
        await el.click();
        await page.waitForTimeout(randomInt(200, 400));
        await el.fill('');
        for (const char of String(value)) {
          await page.type(selector, char, { delay: randomInt(40, 120) });
        }
        await page.waitForTimeout(randomInt(200, 500));
      } catch (e) {}
    }
    
    result.screenshot = await takeScreenshot(page, 'register_filled');
    
    // Submit
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Register")',
      'button:has-text("Sign up")',
      'button:has-text("Join")',
      'button:has-text("Submit")',
      ...(options.submitSelector ? [options.submitSelector] : [])
    ];
    
    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch (e) {}
    }
    
    await page.waitForTimeout(4000);
    result.screenshot = await takeScreenshot(page, 'register_done');
    result.success = true;
    result.message = `Registrasi submitted!\nEmail: ${email}\nUsername: ${userData.username}\nPassword: ${userData.password}`;
    result.userData = userData;
    
  } catch (err) {
    result.message = `Error: ${err.message}`;
    try { result.screenshot = await takeScreenshot(page, 'register_error'); } catch (e) {}
  } finally {
    await browser.close();
  }
  
  return result;
}

// ─── TASK 5: SCREENSHOT URL ───────────────────────────────────────────────────
async function screenshotUrl(url) {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  
  let screenshotPath = null;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    screenshotPath = await takeScreenshot(page, 'url_screenshot');
  } catch (err) {
    console.log(`[Playwright] Screenshot error: ${err.message}`);
  } finally {
    await browser.close();
  }
  
  return screenshotPath;
}

// ─── PARSE INSTRUKSI NATURAL LANGUAGE ────────────────────────────────────────
// Dipanggil dari index.js ketika AI response mengandung playwright action
async function executePlaywrightAction(action) {
  const { type, url, fields, wallet, wallets, email, emails, options } = action;
  
  switch (type) {
    case 'fill_form':
      return await fillForm(url, fields || {}, options || {});
      
    case 'claim_faucet':
      return await claimFaucet(url, wallet, options || {});
      
    case 'batch_faucet':
      return await batchClaimFaucet(url, wallets || [], options || {});
      
    case 'register':
      return await autoRegister(url, email, options || {});
      
    case 'screenshot':
      const ss = await screenshotUrl(url);
      return { success: !!ss, screenshot: ss, message: ss ? 'Screenshot diambil' : 'Gagal screenshot' };
      
    default:
      return { success: false, message: `Action tidak dikenal: ${type}` };
  }
}

module.exports = {
  fillForm,
  claimFaucet,
  batchClaimFaucet,
  autoRegister,
  screenshotUrl,
  executePlaywrightAction,
  randomUsername,
  randomName
};
