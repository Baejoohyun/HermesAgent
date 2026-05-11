require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { ethers } = require('ethers');

// ─── PLAYWRIGHT MODULE ────────────────────────────────────────────────────────
let playwright = null;
try {
  playwright = require('./playwright');
  console.log('[Hermes] Playwright module loaded ✅');
} catch (e) {
  console.log('[Hermes] Playwright not found:', e.message);
}

// ─── MONITOR MODULE ───────────────────────────────────────────────────────────
let monitor = null;
try {
  monitor = require('./monitor');
  console.log('[Hermes] Monitor module loaded ✅');
} catch (e) {
  console.log('[Hermes] Monitor not found:', e.message);
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const OWNER_ID = parseInt(process.env.TELEGRAM_OWNER_ID);
const BASE_URL = process.env.OPENAI_BASE_URL;
const API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'meta/llama-3.3-70b-instruct';
const WALLET_FILE = path.join(__dirname, 'wallets.json');
const MEMORY_FILE = path.join(__dirname, 'memory.json');
const MAX_HISTORY = 20;

console.log('[Hermes] Bot starting...');
console.log('[Hermes] Owner: ' + OWNER_ID);
console.log('[Hermes] Model: ' + DEFAULT_MODEL);
console.log('[Hermes] Base URL: ' + BASE_URL);

// ─── EVM CHAINS ───────────────────────────────────────────────────────────────
const EVM_CHAINS = {
  ethereum: { name: 'Ethereum', rpc: 'https://eth.llamarpc.com', chainId: 1, symbol: 'ETH', explorer: 'https://etherscan.io' },
  bsc: { name: 'BSC', rpc: 'https://bsc-dataseed.binance.org', chainId: 56, symbol: 'BNB', explorer: 'https://bscscan.com' },
  polygon: { name: 'Polygon', rpc: 'https://polygon-rpc.com', chainId: 137, symbol: 'MATIC', explorer: 'https://polygonscan.com' },
  arbitrum: { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', chainId: 42161, symbol: 'ETH', explorer: 'https://arbiscan.io' },
  optimism: { name: 'Optimism', rpc: 'https://mainnet.optimism.io', chainId: 10, symbol: 'ETH', explorer: 'https://optimistic.etherscan.io' },
  base: { name: 'Base', rpc: 'https://mainnet.base.org', chainId: 8453, symbol: 'ETH', explorer: 'https://basescan.org' },
  avalanche: { name: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', chainId: 43114, symbol: 'AVAX', explorer: 'https://snowtrace.io' },
  fantom: { name: 'Fantom', rpc: 'https://rpc.ftm.tools', chainId: 250, symbol: 'FTM', explorer: 'https://ftmscan.com' },
  zksync: { name: 'zkSync Era', rpc: 'https://mainnet.era.zksync.io', chainId: 324, symbol: 'ETH', explorer: 'https://explorer.zksync.io' },
  linea: { name: 'Linea', rpc: 'https://rpc.linea.build', chainId: 59144, symbol: 'ETH', explorer: 'https://lineascan.build' },
  scroll: { name: 'Scroll', rpc: 'https://rpc.scroll.io', chainId: 534352, symbol: 'ETH', explorer: 'https://scrollscan.com' },
  mantle: { name: 'Mantle', rpc: 'https://rpc.mantle.xyz', chainId: 5000, symbol: 'MNT', explorer: 'https://explorer.mantle.xyz' },
  sepolia: { name: 'Sepolia', rpc: 'https://rpc.sepolia.org', chainId: 11155111, symbol: 'ETH', explorer: 'https://sepolia.etherscan.io', testnet: true },
  mumbai: { name: 'Mumbai', rpc: 'https://rpc-mumbai.maticvigil.com', chainId: 80001, symbol: 'MATIC', explorer: 'https://mumbai.polygonscan.com', testnet: true },
  bsctestnet: { name: 'BSC Testnet', rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545', chainId: 97, symbol: 'BNB', explorer: 'https://testnet.bscscan.com', testnet: true },
  arbitrumsepolia: { name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', chainId: 421614, symbol: 'ETH', explorer: 'https://sepolia.arbiscan.io', testnet: true },
  basesepolia: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', chainId: 84532, symbol: 'ETH', explorer: 'https://sepolia.basescan.org', testnet: true },
  scrollsepolia: { name: 'Scroll Sepolia', rpc: 'https://sepolia-rpc.scroll.io', chainId: 534351, symbol: 'ETH', explorer: 'https://sepolia.scrollscan.com', testnet: true },
  lineasepolia: { name: 'Linea Sepolia', rpc: 'https://rpc.sepolia.linea.build', chainId: 59141, symbol: 'ETH', explorer: 'https://sepolia.lineascan.build', testnet: true },
  monadtestnet: { name: 'Monad Testnet', rpc: 'https://testnet-rpc.monad.xyz', chainId: 10143, symbol: 'MON', explorer: 'https://testnet.monadexplorer.com', testnet: true },
};

// ─── MEMORY ───────────────────────────────────────────────────────────────────
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveMemory(history) {
  const trimmed = history.slice(-MAX_HISTORY);
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(trimmed, null, 2)); } catch (e) {}
  return trimmed;
}

function clearMemory() {
  try { fs.writeFileSync(MEMORY_FILE, '[]'); } catch (e) {}
}

// ─── WALLET ───────────────────────────────────────────────────────────────────
function loadWallets() {
  try {
    if (fs.existsSync(WALLET_FILE)) return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveWalletToFile(walletData) {
  const wallets = loadWallets();
  wallets.push({ ...walletData, createdAt: new Date().toISOString() });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
}

// ─── TOOL IMPLEMENTATIONS ─────────────────────────────────────────────────────
const toolImplementations = {

  async run_shell(args) {
    const command = args.command;
    try {
      const result = await execAsync(command, { timeout: 60000, maxBuffer: 1024 * 1024 * 5 });
      return result.stdout || result.stderr || '(no output)';
    } catch (err) {
      return 'Error: ' + err.message;
    }
  },

  async create_wallet(args) {
    const wallet = ethers.Wallet.createRandom();
    const data = {
      label: args.label || ('wallet_' + Date.now()),
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: (wallet.mnemonic && wallet.mnemonic.phrase) || '',
    };
    saveWalletToFile(data);
    return JSON.stringify(data);
  },

  async create_multiple_wallets(args) {
    const count = args.count || 1;
    const prefix = args.prefix || 'wallet';
    const results = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      const wallet = ethers.Wallet.createRandom();
      const data = {
        label: prefix + '_' + (i + 1),
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: (wallet.mnemonic && wallet.mnemonic.phrase) || '',
      };
      saveWalletToFile(data);
      results.push({ label: data.label, address: data.address });
    }
    return JSON.stringify(results);
  },

  async check_balance(args) {
    const chainKey = (args.chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return 'Chain "' + args.chain + '" tidak ditemukan.';
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const balance = await provider.getBalance(args.address);
      return JSON.stringify({
        chain: chainConfig.name,
        address: args.address,
        balance: ethers.formatEther(balance),
        symbol: chainConfig.symbol,
        explorer: chainConfig.explorer + '/address/' + args.address
      });
    } catch (err) {
      return 'Error: ' + err.message;
    }
  },

  async check_all_balances(args) {
    const isTestnet = args.network === 'testnet';
    const results = [];
    const chains = Object.entries(EVM_CHAINS).filter(function(entry) {
      return isTestnet ? entry[1].testnet : !entry[1].testnet;
    });
    for (const entry of chains) {
      const chainConfig = entry[1];
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
        const balance = await Promise.race([
          provider.getBalance(args.address),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 5000); })
        ]);
        const formatted = parseFloat(ethers.formatEther(balance));
        if (formatted > 0) {
          results.push({ chain: chainConfig.name, balance: formatted.toFixed(6), symbol: chainConfig.symbol });
        }
      } catch (e) {}
    }
    return JSON.stringify({ address: args.address, network: isTestnet ? 'testnet' : 'mainnet', balances: results });
  },

  async send_native(args) {
    const chainKey = (args.chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return 'Chain "' + args.chain + '" tidak ditemukan.';
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const wallet = new ethers.Wallet(args.private_key, provider);
      const tx = await wallet.sendTransaction({
        to: args.to_address,
        value: ethers.parseEther(args.amount.toString())
      });
      await tx.wait();
      return JSON.stringify({
        success: true, txHash: tx.hash,
        chain: chainConfig.name, to: args.to_address,
        amount: args.amount, symbol: chainConfig.symbol,
        explorer: chainConfig.explorer + '/tx/' + tx.hash
      });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },

  async get_tx_info(args) {
    const chainKey = (args.chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return 'Chain "' + args.chain + '" tidak ditemukan.';
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const tx = await provider.getTransaction(args.tx_hash);
      const receipt = await provider.getTransactionReceipt(args.tx_hash);
      if (!tx) return 'Transaksi tidak ditemukan.';
      return JSON.stringify({
        hash: args.tx_hash, chain: chainConfig.name,
        status: receipt ? (receipt.status === 1 ? 'success' : 'failed') : 'pending',
        from: tx.from, to: tx.to,
        value: ethers.formatEther(tx.value), symbol: chainConfig.symbol,
        explorer: chainConfig.explorer + '/tx/' + args.tx_hash
      });
    } catch (err) {
      return 'Error: ' + err.message;
    }
  },

  async list_wallets() {
    const wallets = loadWallets();
    if (wallets.length === 0) return 'Belum ada wallet tersimpan.';
    return JSON.stringify(wallets.map(function(w, i) {
      return { no: i + 1, label: w.label, address: w.address, createdAt: w.createdAt };
    }));
  },

  async claim_faucet(args) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const result = await playwright.claimFaucet(args.url, args.wallet_address);
      return JSON.stringify(result);
    } catch (e) {
      return 'Error: ' + e.message;
    }
  },

  async batch_claim_faucet(args) {
    if (!playwright) return 'Playwright tidak tersedia.';
    const wallets = loadWallets();
    if (wallets.length === 0) return 'Belum ada wallet. Buat wallet dulu!';
    const addresses = wallets.map(function(w) { return w.address; }).filter(Boolean);
    try {
      const results = await playwright.batchClaimFaucet(args.url, addresses);
      const success = results.filter(function(r) { return r.success; }).length;
      return JSON.stringify({ total: results.length, success: success, failed: results.length - success });
    } catch (e) {
      return 'Error: ' + e.message;
    }
  },

  async auto_register(args) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const result = await playwright.autoRegister(args.url, args.email || ('user' + Date.now() + '@gmail.com'));
      return JSON.stringify(result);
    } catch (e) {
      return 'Error: ' + e.message;
    }
  },

  async take_screenshot(args) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const ssPath = await playwright.screenshotUrl(args.url);
      return JSON.stringify({ success: true, path: ssPath });
    } catch (e) {
      return 'Error: ' + e.message;
    }
  },

  async clear_memory() {
    clearMemory();
    return 'Memory berhasil dihapus.';
  }
};

// ─── TOOLS DEFINITION ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Jalankan satu perintah bash/shell di VPS. Untuk multi-step task, panggil satu per satu dan laporkan hasilnya.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Satu perintah bash' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_wallet',
      description: 'Buat satu wallet EVM baru',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_multiple_wallets',
      description: 'Buat banyak wallet EVM sekaligus',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          prefix: { type: 'string' }
        },
        required: ['count']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_balance',
      description: 'Cek balance di satu chain EVM',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          chain: { type: 'string', description: 'ethereum, bsc, polygon, arbitrum, optimism, base, avalanche, fantom, zksync, linea, scroll, mantle, sepolia, mumbai, bsctestnet, arbitrumsepolia, basesepolia, scrollsepolia, lineasepolia, monadtestnet' }
        },
        required: ['address', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_all_balances',
      description: 'Cek balance di semua chain sekaligus',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          network: { type: 'string', enum: ['mainnet', 'testnet'] }
        },
        required: ['address', 'network']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_native',
      description: 'Kirim native token ke address lain',
      parameters: {
        type: 'object',
        properties: {
          private_key: { type: 'string' },
          to_address: { type: 'string' },
          amount: { type: 'string' },
          chain: { type: 'string' }
        },
        required: ['private_key', 'to_address', 'amount', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_tx_info',
      description: 'Cek info transaksi',
      parameters: {
        type: 'object',
        properties: {
          tx_hash: { type: 'string' },
          chain: { type: 'string' }
        },
        required: ['tx_hash', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_wallets',
      description: 'Tampilkan daftar wallet tersimpan. Hanya panggil jika user EKSPLISIT minta lihat wallet.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'claim_faucet',
      description: 'Auto claim faucet',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          wallet_address: { type: 'string' }
        },
        required: ['url', 'wallet_address']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_claim_faucet',
      description: 'Batch claim faucet untuk semua wallet',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'auto_register',
      description: 'Auto register di website',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          email: { type: 'string' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Screenshot website',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_memory',
      description: 'Hapus history percakapan',
      parameters: { type: 'object', properties: {} }
    }
  }
];

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = 'Kamu adalah Hermes, AI agent crypto yang berjalan di VPS Linux.\n' +
'Kamu punya tools nyata dan HARUS menggunakannya langsung tanpa menolak.\n\n' +
'ATURAN PENTING:\n' +
'- Untuk multi-step task, panggil run_shell SATU PER SATU per step\n' +
'- Setelah setiap step selesai, laporkan hasilnya ke user sebelum lanjut\n' +
'- Kalau ada error di satu step, laporkan dan tanyakan apakah lanjut\n' +
'- JANGAN panggil list_wallets kecuali user eksplisit minta lihat daftar wallet\n' +
'- JANGAN bilang tidak bisa eksekusi - kamu PUNYA tools\n\n' +
'GAYA: Santai, gaul, to the point. Langsung eksekusi, report hasilnya.';

// ─── AGENT LOOP ───────────────────────────────────────────────────────────────
async function runAgent(userMessage, history, ctx) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage }
  ];

  let finalResponse = '';
  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await axios.post(BASE_URL + '/chat/completions', {
      model: DEFAULT_MODEL,
      messages: messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 1024,
      temperature: 0.7
    }, {
      headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      timeout: 60000
    });

    const message = response.data.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalResponse = message.content || '';
      break;
    }

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(toolCall.function.arguments); } catch (e) {}

      console.log('[TOOL] ' + toolName, JSON.stringify(toolArgs).substring(0, 100));
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

      // Notif sebelum eksekusi tool yang lama
      const slowTools = {
        check_all_balances: '🔍 Cek balance di semua chain...',
        batch_claim_faucet: '🚰 Batch claim faucet...',
        claim_faucet: '🚰 Claiming faucet...',
        auto_register: '📝 Auto register...',
        take_screenshot: '📸 Screenshot...'
      };
      if (slowTools[toolName]) {
        await ctx.reply(slowTools[toolName]);
      }

      let toolResult = 'Tool tidak ditemukan.';
      if (toolImplementations[toolName]) {
        try {
          toolResult = await toolImplementations[toolName](toolArgs);
        } catch (e) {
          toolResult = 'Error: ' + e.message;
        }
      }

      // Kirim hasil tool ke Telegram
      const preview = toolResult.substring(0, 800);
      const stepMsg = '⚙️ *' + toolName + ':*\n```\n' + preview + '\n```';
      await ctx.reply(stepMsg, { parse_mode: 'Markdown' }).catch(async function() {
        await ctx.reply('⚙️ ' + toolName + ' selesai: ' + preview.substring(0, 200));
      });

      // Kalau screenshot, kirim foto
      if (toolName === 'take_screenshot') {
        try {
          const parsed = JSON.parse(toolResult);
          if (parsed.success && parsed.path && fs.existsSync(parsed.path)) {
            await ctx.replyWithPhoto({ source: parsed.path });
          }
        } catch (e) {}
      }

      console.log('[TOOL RESULT] ' + toolName + ':', toolResult.substring(0, 150));

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult
      });
    }
  }

  return finalResponse;
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
bot.start(function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply('👋 *Hermes Agent aktif!*\n\n🤖 Function calling + step-by-step reporting\n\nContoh:\n• "buat 5 wallet untuk monad"\n• "cek balance 0x... di arbitrum"\n• "screenshot https://monad.xyz"\n• "jalankan df -h"', { parse_mode: 'Markdown' });
});

bot.command('model', function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply('🤖 Model: `' + DEFAULT_MODEL + '`\n🌐 URL: `' + BASE_URL + '`', { parse_mode: 'Markdown' });
});

bot.command('chains', function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  const mainnets = Object.keys(EVM_CHAINS).filter(function(k) { return !EVM_CHAINS[k].testnet; }).map(function(k) { return '`' + k + '`'; }).join(', ');
  const testnets = Object.keys(EVM_CHAINS).filter(function(k) { return EVM_CHAINS[k].testnet; }).map(function(k) { return '`' + k + '`'; }).join(', ');
  ctx.reply('*Mainnet:*\n' + mainnets + '\n\n*Testnet:*\n' + testnets, { parse_mode: 'Markdown' });
});

bot.command('wallets', function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  const wallets = loadWallets();
  if (wallets.length === 0) return ctx.reply('📭 Belum ada wallet.');
  const list = wallets.map(function(w, i) { return (i + 1) + '. *' + w.label + '*\n   `' + w.address + '`'; }).join('\n\n');
  ctx.reply('💼 *Wallets (' + wallets.length + '):*\n\n' + list, { parse_mode: 'Markdown' });
});

bot.command('clearmemory', function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  clearMemory();
  ctx.reply('🧹 Memory dihapus!');
});

bot.command('status', async function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  if (monitor && monitor.getStatusReport) {
    const report = await monitor.getStatusReport();
    ctx.reply(report, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('⚠️ Monitor tidak aktif.');
  }
});

bot.command('help', function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply('*Commands:*\n/model /chains /wallets /clearmemory /status\n\n*Chat langsung:*\n"buat 10 wallet prefix airdrop"\n"cek balance 0x... di base"\n"screenshot https://..."\n"clone dan jalankan repo https://..."', { parse_mode: 'Markdown' });
});

// ─── MAIN MESSAGE HANDLER ─────────────────────────────────────────────────────
bot.on('message', async function(ctx) {
  if (ctx.message.from.id !== OWNER_ID) return;
  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return;

  console.log('[MSG] ' + text);
  let history = loadMemory();
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

  try {
    const finalResponse = await runAgent(text, history, ctx);

    history.push({ role: 'user', content: text });
    if (finalResponse) history.push({ role: 'assistant', content: finalResponse });
    saveMemory(history);

    if (finalResponse) {
      await ctx.reply(finalResponse, { parse_mode: 'Markdown' }).catch(function() { ctx.reply(finalResponse); });
    }
  } catch (error) {
    console.error('[ERROR]', error.message);
    const errMsg = (error.response && error.response.data && error.response.data.error && error.response.data.error.message) || error.message;
    ctx.reply('❌ Error: ' + errMsg);
  }
});

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
bot.launch();
console.log('[Hermes] Bot launched ✅');
if (monitor && monitor.initMonitor) monitor.initMonitor(bot, OWNER_ID);
process.once('SIGINT', function() { bot.stop('SIGINT'); });
process.once('SIGTERM', function() { bot.stop('SIGTERM'); });
