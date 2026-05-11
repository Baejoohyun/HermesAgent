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
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'llama-3.3-70b-versatile';
const WALLET_FILE = path.join(__dirname, 'wallets.json');
const MEMORY_FILE = path.join(__dirname, 'memory.json');
const MAX_HISTORY = 20;

console.log('[Hermes] Bot starting...');
console.log(`[Hermes] Owner: ${OWNER_ID}`);
console.log(`[Hermes] Model: ${DEFAULT_MODEL}`);
console.log(`[Hermes] Base URL: ${BASE_URL}`);

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
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch (e) {}
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
  try { if (fs.existsSync(WALLET_FILE)) return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8')); } catch (e) {}
  return [];
}
function saveWalletToFile(walletData) {
  const wallets = loadWallets();
  wallets.push({ ...walletData, createdAt: new Date().toISOString() });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
}

// ─── TOOL IMPLEMENTATIONS ─────────────────────────────────────────────────────
const toolImplementations = {

  async run_shell({ command }) {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 });
      return stdout || stderr || '(no output)';
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },

  async create_wallet({ label }) {
    const wallet = ethers.Wallet.createRandom();
    const data = {
      label: label || `wallet_${Date.now()}`,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase || '',
    };
    saveWalletToFile(data);
    return JSON.stringify(data);
  },

  async create_multiple_wallets({ count, prefix }) {
    const results = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      const wallet = ethers.Wallet.createRandom();
      const data = {
        label: `${prefix || 'wallet'}_${i + 1}`,
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic?.phrase || '',
      };
      saveWalletToFile(data);
      results.push(data);
    }
    return JSON.stringify(results);
  },

  async check_balance({ address, chain }) {
    const chainKey = (chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return `Chain "${chain}" tidak ditemukan.`;
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const balance = await provider.getBalance(address);
      return JSON.stringify({
        chain: chainConfig.name,
        address,
        balance: ethers.formatEther(balance),
        symbol: chainConfig.symbol,
        explorer: `${chainConfig.explorer}/address/${address}`
      });
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },

  async check_all_balances({ address, network }) {
    const isTestnet = network === 'testnet';
    const results = [];
    const chains = Object.entries(EVM_CHAINS).filter(([, v]) => isTestnet ? v.testnet : !v.testnet);
    for (const [key, chainConfig] of chains) {
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
        const balance = await Promise.race([
          provider.getBalance(address),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        const formatted = parseFloat(ethers.formatEther(balance));
        if (formatted > 0) results.push({ chain: chainConfig.name, balance: formatted.toFixed(6), symbol: chainConfig.symbol });
      } catch (e) {}
    }
    return JSON.stringify({ address, network: isTestnet ? 'testnet' : 'mainnet', balances: results });
  },

  async send_native({ private_key, to_address, amount, chain }) {
    const chainKey = (chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return `Chain "${chain}" tidak ditemukan.`;
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const wallet = new ethers.Wallet(private_key, provider);
      const tx = await wallet.sendTransaction({ to: to_address, value: ethers.parseEther(amount.toString()) });
      await tx.wait();
      return JSON.stringify({ success: true, txHash: tx.hash, chain: chainConfig.name, to: to_address, amount, symbol: chainConfig.symbol, explorer: `${chainConfig.explorer}/tx/${tx.hash}` });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },

  async get_tx_info({ tx_hash, chain }) {
    const chainKey = (chain || 'ethereum').toLowerCase();
    const chainConfig = EVM_CHAINS[chainKey];
    if (!chainConfig) return `Chain "${chain}" tidak ditemukan.`;
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const tx = await provider.getTransaction(tx_hash);
      const receipt = await provider.getTransactionReceipt(tx_hash);
      if (!tx) return 'Transaksi tidak ditemukan.';
      return JSON.stringify({
        hash: tx_hash, chain: chainConfig.name,
        status: receipt ? (receipt.status === 1 ? 'success' : 'failed') : 'pending',
        from: tx.from, to: tx.to,
        value: ethers.formatEther(tx.value), symbol: chainConfig.symbol,
        explorer: `${chainConfig.explorer}/tx/${tx_hash}`
      });
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },

  async list_wallets() {
    const wallets = loadWallets();
    if (wallets.length === 0) return 'Belum ada wallet tersimpan.';
    return JSON.stringify(wallets.map((w, i) => ({ no: i + 1, label: w.label, address: w.address, createdAt: w.createdAt })));
  },

  async claim_faucet({ url, wallet_address }) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const result = await playwright.claimFaucet(url, wallet_address);
      return JSON.stringify(result);
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },

  async batch_claim_faucet({ url }) {
    if (!playwright) return 'Playwright tidak tersedia.';
    const wallets = loadWallets();
    if (wallets.length === 0) return 'Belum ada wallet. Buat wallet dulu!';
    const addresses = wallets.map(w => w.address).filter(Boolean);
    try {
      const results = await playwright.batchClaimFaucet(url, addresses);
      const success = results.filter(r => r.success).length;
      return JSON.stringify({ total: results.length, success, failed: results.length - success });
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },

  async auto_register({ url, email }) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const result = await playwright.autoRegister(url, email || `user${Date.now()}@gmail.com`);
      return JSON.stringify(result);
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },

  async take_screenshot({ url }) {
    if (!playwright) return 'Playwright tidak tersedia.';
    try {
      const ssPath = await playwright.screenshotUrl(url);
      return JSON.stringify({ success: true, path: ssPath });
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },

  async clear_memory() {
    clearMemory();
    return 'Memory berhasil dihapus.';
  }
};

// ─── GROQ TOOLS DEFINITION ───────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Jalankan perintah bash/shell di VPS Linux. Gunakan untuk install package, cek sistem, clone repo, manage file, dll.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Perintah bash yang akan dijalankan' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_wallet',
      description: 'Buat satu wallet Ethereum/EVM baru dan simpan ke wallets.json',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Label/nama untuk wallet ini' }
        },
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
          count: { type: 'number', description: 'Jumlah wallet yang dibuat (max 50)' },
          prefix: { type: 'string', description: 'Prefix label wallet (contoh: "airdrop" → airdrop_1, airdrop_2, ...)' }
        },
        required: ['count']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_balance',
      description: 'Cek balance native token di satu chain EVM',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Alamat wallet Ethereum (0x...)' },
          chain: { type: 'string', description: 'Nama chain: ethereum, bsc, polygon, arbitrum, optimism, base, avalanche, fantom, zksync, linea, scroll, mantle, sepolia, mumbai, bsctestnet, arbitrumsepolia, basesepolia, scrollsepolia, lineasepolia, monadtestnet' }
        },
        required: ['address', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_all_balances',
      description: 'Cek balance di semua chain EVM sekaligus (mainnet atau testnet)',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Alamat wallet Ethereum (0x...)' },
          network: { type: 'string', enum: ['mainnet', 'testnet'], description: 'mainnet atau testnet' }
        },
        required: ['address', 'network']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_native',
      description: 'Kirim native token (ETH, BNB, MATIC, dll) ke address lain',
      parameters: {
        type: 'object',
        properties: {
          private_key: { type: 'string', description: 'Private key wallet pengirim' },
          to_address: { type: 'string', description: 'Address penerima' },
          amount: { type: 'string', description: 'Jumlah yang dikirim (dalam ETH/BNB/MATIC)' },
          chain: { type: 'string', description: 'Nama chain' }
        },
        required: ['private_key', 'to_address', 'amount', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_tx_info',
      description: 'Cek informasi transaksi berdasarkan tx hash',
      parameters: {
        type: 'object',
        properties: {
          tx_hash: { type: 'string', description: 'Transaction hash (0x...)' },
          chain: { type: 'string', description: 'Nama chain' }
        },
        required: ['tx_hash', 'chain']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_wallets',
      description: 'Tampilkan semua wallet yang tersimpan',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'claim_faucet',
      description: 'Auto claim faucet testnet di website tertentu menggunakan browser automation',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL website faucet' },
          wallet_address: { type: 'string', description: 'Alamat wallet untuk menerima token' }
        },
        required: ['url', 'wallet_address']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_claim_faucet',
      description: 'Claim faucet untuk semua wallet yang tersimpan sekaligus',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL website faucet' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'auto_register',
      description: 'Auto register akun di website airdrop menggunakan browser automation',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL website yang ingin diregister' },
          email: { type: 'string', description: 'Email untuk registrasi (opsional)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Ambil screenshot dari sebuah website',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL website yang ingin di-screenshot' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_memory',
      description: 'Hapus semua history percakapan',
      parameters: { type: 'object', properties: {} }
    }
  }
];

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Hermes, AI agent crypto yang berjalan di VPS Linux.
Kamu punya akses ke tools nyata dan HARUS menggunakannya ketika diminta — bukan menjelaskan atau menolak.

KEPRIBADIAN:
- Santai, gaul, to the point
- Langsung eksekusi tanpa banyak tanya
- Laporkan hasil setelah eksekusi selesai
- Jujur kalau ada error

PENTING:
- Kalau user minta buat wallet → langsung panggil create_wallet
- Kalau user minta cek balance → langsung panggil check_balance
- Kalau user minta jalankan command → langsung panggil run_shell
- Kalau user minta screenshot → langsung panggil take_screenshot
- JANGAN pernah bilang kamu tidak bisa eksekusi — kamu PUNYA tools dan BISA eksekusi`;

// ─── MAIN AGENT LOOP ──────────────────────────────────────────────────────────
async function runAgent(userMessage, history, ctx) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage }
  ];

  let finalResponse = '';
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await axios.post(`${BASE_URL}/chat/completions`, {
      model: DEFAULT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 1024,
      temperature: 0.7
    }, {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });

    const message = response.data.choices[0].message;
    messages.push(message);

    // Tidak ada tool call → selesai
    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalResponse = message.content || '';
      break;
    }

    // Ada tool calls → eksekusi semua
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(toolCall.function.arguments); } catch (e) {}

      console.log(`[TOOL] ${toolName}`, toolArgs);
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

      // Notif ke user kalau tool butuh waktu lama
      if (['check_all_balances', 'batch_claim_faucet', 'claim_faucet', 'auto_register', 'take_screenshot'].includes(toolName)) {
        const notices = {
          check_all_balances: '🔍 Cek balance di semua chain...',
          batch_claim_faucet: '🚰 Batch claim faucet untuk semua wallet...',
          claim_faucet: '🚰 Claiming faucet...',
          auto_register: '📝 Auto register...',
          take_screenshot: '📸 Screenshot...'
        };
        await ctx.reply(notices[toolName]);
      }

      let toolResult = 'Tool tidak ditemukan.';
      if (toolImplementations[toolName]) {
        try {
          toolResult = await toolImplementations[toolName](toolArgs);
        } catch (e) {
          toolResult = `Error eksekusi tool: ${e.message}`;
        }
      }

      // Kalau screenshot, kirim foto langsung
      if (toolName === 'take_screenshot') {
        try {
          const parsed = JSON.parse(toolResult);
          if (parsed.success && parsed.path && fs.existsSync(parsed.path)) {
            await ctx.replyWithPhoto({ source: parsed.path });
          }
        } catch (e) {}
      }

      console.log(`[TOOL RESULT] ${toolName}:`, toolResult.substring(0, 200));

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult
      });
    }
  }

  return { finalResponse, messages };
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(
    '👋 *Hermes Agent aktif!*\n\n' +
    '🤖 Native function calling — eksekusi real!\n\n' +
    '💬 Ngobrol langsung, contoh:\n' +
    '• "buat 5 wallet untuk airdrop monad"\n' +
    '• "cek balance 0x... di arbitrum"\n' +
    '• "screenshot https://monad.xyz"\n' +
    '• "claim faucet https://... pakai wallet pertama"\n' +
    '• "jalankan df -h"\n\n' +
    '/help — semua commands\n' +
    '/chains — list chain tersedia\n' +
    '/wallets — lihat wallet',
    { parse_mode: 'Markdown' }
  );
});

bot.command('model', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(`🤖 Model: \`${DEFAULT_MODEL}\`\n🌐 Base URL: \`${BASE_URL}\``, { parse_mode: 'Markdown' });
});

bot.command('chains', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const mainnets = Object.entries(EVM_CHAINS).filter(([, v]) => !v.testnet).map(([k, v]) => `• \`${k}\` — ${v.name}`).join('\n');
  const testnets = Object.entries(EVM_CHAINS).filter(([, v]) => v.testnet).map(([k, v]) => `• \`${k}\` — ${v.name}`).join('\n');
  ctx.reply(`*🌐 Mainnet:*\n${mainnets}\n\n*🧪 Testnet:*\n${testnets}`, { parse_mode: 'Markdown' });
});

bot.command('wallets', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const wallets = loadWallets();
  if (wallets.length === 0) return ctx.reply('📭 Belum ada wallet.');
  const list = wallets.map((w, i) =>
    `${i + 1}. *${w.label}*\n   📍 \`${w.address}\`\n   📅 ${w.createdAt}`
  ).join('\n\n');
  ctx.reply(`💼 *Wallets (${wallets.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.command('clearmemory', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  clearMemory();
  ctx.reply('🧹 Memory dihapus!');
});

bot.command('status', async (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  if (monitor) {
    const report = await monitor.getStatusReport?.() || '⚠️ Status tidak tersedia.';
    ctx.reply(report, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('⚠️ Monitor tidak aktif.');
  }
});

bot.command('help', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(
    `*Hermes Commands:*\n\n` +
    `/start — Sambutan\n` +
    `/model — Info model aktif\n` +
    `/chains — List EVM chains\n` +
    `/wallets — Lihat semua wallet\n` +
    `/clearmemory — Hapus history chat\n` +
    `/status — Health check\n` +
    `/help — Bantuan ini\n\n` +
    `*Ngobrol langsung:*\n` +
    `"buat wallet label main"\n` +
    `"buat 10 wallet prefix airdrop"\n` +
    `"cek balance 0x... di base"\n` +
    `"cek semua balance 0x... testnet"\n` +
    `"screenshot https://..."\n` +
    `"claim faucet https://... pakai 0x..."\n` +
    `"jalankan ls -la"`,
    { parse_mode: 'Markdown' }
  );
});

// ─── MAIN MESSAGE HANDLER ─────────────────────────────────────────────────────
bot.on('message', async (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return;

  console.log(`[MSG] ${text}`);
  let history = loadMemory();
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

  try {
    const { finalResponse, messages } = await runAgent(text, history, ctx);

    // Simpan ke memory (hanya user + final assistant)
    history.push({ role: 'user', content: text });
    if (finalResponse) history.push({ role: 'assistant', content: finalResponse });
    saveMemory(history);

    if (finalResponse) {
      await ctx.reply(finalResponse, { parse_mode: 'Markdown' }).catch(() => ctx.reply(finalResponse));
    }

  } catch (error) {
    console.error('[ERROR]', error.message);
    const errMsg = error.response?.data?.error?.message || error.message;
    ctx.reply(`❌ Error: ${errMsg}`);
  }
});

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
bot.launch();
console.log('[Hermes] Bot launched ✅');

if (monitor) {
  monitor.initMonitor?.(bot, OWNER_ID);
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
