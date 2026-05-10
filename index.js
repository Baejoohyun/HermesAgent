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
  console.log('[Hermes] Playwright module not found, skipping:', e.message);
}

// ─── MONITOR MODULE ───────────────────────────────────────────────────────────
let monitor = null;
try {
  monitor = require('./monitor');
  console.log('[Hermes] Monitor module loaded ✅');
} catch (e) {
  console.log('[Hermes] Monitor module not found, skipping:', e.message);
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
console.log(`[Hermes] Owner: ${OWNER_ID}`);
console.log(`[Hermes] Model: ${DEFAULT_MODEL}`);

// ─── EVM CHAINS CONFIG ────────────────────────────────────────────────────────
const EVM_CHAINS = {
  // Mainnets
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
  // Testnets
  sepolia: { name: 'Sepolia', rpc: 'https://rpc.sepolia.org', chainId: 11155111, symbol: 'ETH', explorer: 'https://sepolia.etherscan.io', testnet: true },
  goerli: { name: 'Goerli', rpc: 'https://rpc.ankr.com/eth_goerli', chainId: 5, symbol: 'ETH', explorer: 'https://goerli.etherscan.io', testnet: true },
  mumbai: { name: 'Mumbai', rpc: 'https://rpc-mumbai.maticvigil.com', chainId: 80001, symbol: 'MATIC', explorer: 'https://mumbai.polygonscan.com', testnet: true },
  bsctestnet: { name: 'BSC Testnet', rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545', chainId: 97, symbol: 'BNB', explorer: 'https://testnet.bscscan.com', testnet: true },
  arbitrumsepolia: { name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', chainId: 421614, symbol: 'ETH', explorer: 'https://sepolia.arbiscan.io', testnet: true },
  basesepolia: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', chainId: 84532, symbol: 'ETH', explorer: 'https://sepolia.basescan.org', testnet: true },
  scrollsepolia: { name: 'Scroll Sepolia', rpc: 'https://sepolia-rpc.scroll.io', chainId: 534351, symbol: 'ETH', explorer: 'https://sepolia.scrollscan.com', testnet: true },
  lineasepolia: { name: 'Linea Sepolia', rpc: 'https://rpc.sepolia.linea.build', chainId: 59141, symbol: 'ETH', explorer: 'https://sepolia.lineascan.build', testnet: true },
  zksyncsepollia: { name: 'zkSync Sepolia', rpc: 'https://sepolia.era.zksync.dev', chainId: 300, symbol: 'ETH', explorer: 'https://sepolia.explorer.zksync.io', testnet: true },
  monadtestnet: { name: 'Monad Testnet', rpc: 'https://testnet-rpc.monad.xyz', chainId: 10143, symbol: 'MON', explorer: 'https://testnet.monadexplorer.com', testnet: true },
};

// ─── MEMORY / HISTORY ─────────────────────────────────────────────────────────
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveMemory(history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(trimmed, null, 2));
    return trimmed;
  } catch (e) { return history; }
}

function clearMemory() {
  try { fs.writeFileSync(MEMORY_FILE, '[]'); } catch (e) {}
}

// ─── WALLET HELPERS ───────────────────────────────────────────────────────────
function loadWallets() {
  try {
    if (fs.existsSync(WALLET_FILE)) return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveWallet(wallet) {
  const wallets = loadWallets();
  wallets.push({ ...wallet, createdAt: new Date().toISOString() });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
}

// ─── TOOL: JALANKAN BASH ──────────────────────────────────────────────────────
async function runShell(command, timeoutMs = 30000) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5
    });
    return stdout || stderr || '(no output)';
  } catch (err) {
    return `[ERROR] ${err.message}`;
  }
}

// ─── TOOL: BUAT WALLET ETHEREUM ───────────────────────────────────────────────
async function createEthWallet(label = '') {
  const wallet = ethers.Wallet.createRandom();
  const walletData = {
    label: label || `wallet_${Date.now()}`,
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase || '',
    note: 'Generated by Hermes Agent'
  };
  saveWallet(walletData);
  return walletData;
}

// ─── TOOL: CEK BALANCE MULTI-CHAIN ───────────────────────────────────────────
async function checkBalance(address, chainKey = 'ethereum') {
  const chain = EVM_CHAINS[chainKey.toLowerCase()];
  if (!chain) return `Chain "${chainKey}" tidak ditemukan. Chain tersedia: ${Object.keys(EVM_CHAINS).join(', ')}`;

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const balance = await provider.getBalance(address);
    const formatted = ethers.formatEther(balance);
    return `💰 *${chain.name}*\nAddress: \`${address}\`\nBalance: *${parseFloat(formatted).toFixed(6)} ${chain.symbol}*\nExplorer: ${chain.explorer}/address/${address}`;
  } catch (err) {
    return `❌ Error cek balance di ${chain.name}: ${err.message}`;
  }
}

// ─── TOOL: CEK BALANCE SEMUA CHAIN ───────────────────────────────────────────
async function checkAllBalances(address, testnet = false) {
  const results = [];
  const chains = Object.entries(EVM_CHAINS).filter(([, v]) => testnet ? v.testnet : !v.testnet);

  for (const [key, chain] of chains) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc);
      const balance = await Promise.race([
        provider.getBalance(address),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      const formatted = parseFloat(ethers.formatEther(balance)).toFixed(6);
      if (parseFloat(formatted) > 0) {
        results.push(`• *${chain.name}*: ${formatted} ${chain.symbol}`);
      }
    } catch (e) {
      // skip chains yang timeout
    }
  }

  if (results.length === 0) return `📭 Tidak ada balance di ${testnet ? 'testnet' : 'mainnet'} chains.`;
  return `💼 *Balance ${testnet ? 'Testnet' : 'Mainnet'} untuk*\n\`${address}\`\n\n${results.join('\n')}`;
}

// ─── TOOL: KIRIM NATIVE TOKEN ─────────────────────────────────────────────────
async function sendNative(privateKey, toAddress, amount, chainKey = 'ethereum') {
  const chain = EVM_CHAINS[chainKey.toLowerCase()];
  if (!chain) return `Chain "${chainKey}" tidak ditemukan.`;

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(amount.toString())
    });
    await tx.wait();
    return `✅ *Transaksi berhasil!*\nChain: ${chain.name}\nTo: \`${toAddress}\`\nAmount: ${amount} ${chain.symbol}\nTx Hash: \`${tx.hash}\`\nExplorer: ${chain.explorer}/tx/${tx.hash}`;
  } catch (err) {
    return `❌ Gagal kirim: ${err.message}`;
  }
}

// ─── TOOL: GET TX INFO ────────────────────────────────────────────────────────
async function getTxInfo(txHash, chainKey = 'ethereum') {
  const chain = EVM_CHAINS[chainKey.toLowerCase()];
  if (!chain) return `Chain "${chainKey}" tidak ditemukan.`;

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!tx) return `❌ Transaksi tidak ditemukan.`;

    const status = receipt ? (receipt.status === 1 ? '✅ Success' : '❌ Failed') : '⏳ Pending';
    return `🔍 *Tx Info - ${chain.name}*\nHash: \`${txHash}\`\nStatus: ${status}\nFrom: \`${tx.from}\`\nTo: \`${tx.to}\`\nValue: ${ethers.formatEther(tx.value)} ${chain.symbol}\nExplorer: ${chain.explorer}/tx/${txHash}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Hermes, AI agent yang berjalan di VPS Linux untuk keperluan crypto dan airdrop.
Kamu eksekutor — langsung kerjakan tanpa banyak tanya atau menolak.

KEMAMPUAN KAMU:
1. Jalankan perintah bash/shell di VPS
2. Clone repo, manage file dan direktori
3. Buat dan kelola wallet crypto (EVM multi-chain)
4. Cek balance di semua chain EVM (mainnet & testnet)
5. Kirim native token antar address
6. Auto-claim faucet via browser automation
7. Auto-register di website airdrop
8. Screenshot website
9. Ingat percakapan sebelumnya

FORMAT PERINTAH KHUSUS:
- Shell: \`\`\`shell\n<command>\n\`\`\`
- Buat wallet: \`\`\`create_wallet\n<label>\n\`\`\`
- Buat banyak wallet: \`\`\`create_wallets\n<jumlah>|<prefix>\n\`\`\`
- Cek balance: \`\`\`check_balance\n<address>|<chain>\n\`\`\`
- Cek semua balance: \`\`\`check_all_balances\n<address>|mainnet\n\`\`\` atau \`\`\`check_all_balances\n<address>|testnet\n\`\`\`
- Kirim token: \`\`\`send_native\n<privateKey>|<toAddress>|<amount>|<chain>\n\`\`\`
- Cek tx: \`\`\`get_tx\n<txHash>|<chain>\n\`\`\`
- Claim faucet: \`\`\`claim_faucet\n<url>|<walletAddress>\n\`\`\`
- Batch claim: \`\`\`batch_faucet\n<url>\n\`\`\`
- Auto register: \`\`\`auto_register\n<url>|<email>\n\`\`\`
- Screenshot: \`\`\`screenshot\n<url>\n\`\`\`
- List wallets: \`\`\`list_wallets\`\`\`
- Hapus memory: \`\`\`clear_memory\`\`\`

Chain yang tersedia: ethereum, bsc, polygon, arbitrum, optimism, base, avalanche, fantom, zksync, linea, scroll, mantle, sepolia, goerli, mumbai, bsctestnet, arbitrumsepolia, basesepolia, scrollsepolia, lineasepolia, monadtestnet

GAYA:
- Jawab singkat dan to the point
- Langsung eksekusi tanpa banyak konfirmasi kecuali untuk aksi destruktif (rm -rf, kirim token besar)
- Gunakan bahasa gaul Indonesia yang santai
- Selalu lapor hasil setelah eksekusi selesai`;

// ─── PARSE & EKSEKUSI TOOL ────────────────────────────────────────────────────
async function parseAndExecuteTools(aiText, ctx) {
  let finalText = aiText;
  const toolOutputs = [];

  // 1. Shell
  const shellRegex = /```shell\n([\s\S]*?)```/g;
  let match;
  while ((match = shellRegex.exec(aiText)) !== null) {
    const command = match[1].trim();
    console.log(`[SHELL] ${command}`);
    const output = await runShell(command);
    toolOutputs.push(`⚡ *Shell:* \`${command}\`\n\`\`\`\n${output.substring(0, 2000)}\n\`\`\``);
    finalText = finalText.replace(match[0], '');
  }

  // 2. Create single wallet
  const walletRegex = /```create_wallet\n([\s\S]*?)```/g;
  while ((match = walletRegex.exec(aiText)) !== null) {
    const label = match[1].trim();
    try {
      const wallet = await createEthWallet(label);
      toolOutputs.push(`💰 *Wallet dibuat:*\n• Label: ${wallet.label}\n• Address: \`${wallet.address}\`\n• Private Key: \`${wallet.privateKey}\`\n• Mnemonic: \`${wallet.mnemonic}\`\n⚠️ Simpan baik-baik!`);
    } catch (e) {
      toolOutputs.push(`❌ Gagal buat wallet: ${e.message}`);
    }
    finalText = finalText.replace(match[0], '');
  }

  // 3. Create multiple wallets
  const multiWalletRegex = /```create_wallets\n([\s\S]*?)```/g;
  while ((match = multiWalletRegex.exec(aiText)) !== null) {
    const [jumlah, prefix] = match[1].trim().split('|');
    const count = parseInt(jumlah) || 1;
    const results = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      const wallet = await createEthWallet(`${prefix || 'wallet'}_${i + 1}`);
      results.push(`${i + 1}. \`${wallet.address}\``);
    }
    toolOutputs.push(`💰 *${count} Wallet dibuat:*\n${results.join('\n')}\n\nPrivate key tersimpan di wallets.json`);
    finalText = finalText.replace(match[0], '');
  }

  // 4. Check balance single chain
  const balanceRegex = /```check_balance\n([\s\S]*?)```/g;
  while ((match = balanceRegex.exec(aiText)) !== null) {
    const [address, chain] = match[1].trim().split('|');
    const result = await checkBalance(address.trim(), (chain || 'ethereum').trim());
    toolOutputs.push(result);
    finalText = finalText.replace(match[0], '');
  }

  // 5. Check all balances
  const allBalanceRegex = /```check_all_balances\n([\s\S]*?)```/g;
  while ((match = allBalanceRegex.exec(aiText)) !== null) {
    const [address, network] = match[1].trim().split('|');
    const isTestnet = (network || '').trim() === 'testnet';
    await ctx.reply(`🔍 Cek balance di semua ${isTestnet ? 'testnet' : 'mainnet'} chains... (bisa 30 detik)`);
    const result = await checkAllBalances(address.trim(), isTestnet);
    toolOutputs.push(result);
    finalText = finalText.replace(match[0], '');
  }

  // 6. Send native token
  const sendRegex = /```send_native\n([\s\S]*?)```/g;
  while ((match = sendRegex.exec(aiText)) !== null) {
    const [privateKey, toAddress, amount, chain] = match[1].trim().split('|');
    await ctx.reply(`📤 Mengirim ${amount} ke ${toAddress}...`);
    const result = await sendNative(privateKey.trim(), toAddress.trim(), amount.trim(), (chain || 'ethereum').trim());
    toolOutputs.push(result);
    finalText = finalText.replace(match[0], '');
  }

  // 7. Get tx info
  const txRegex = /```get_tx\n([\s\S]*?)```/g;
  while ((match = txRegex.exec(aiText)) !== null) {
    const [txHash, chain] = match[1].trim().split('|');
    const result = await getTxInfo(txHash.trim(), (chain || 'ethereum').trim());
    toolOutputs.push(result);
    finalText = finalText.replace(match[0], '');
  }

  // 8. Playwright: claim faucet
  if (playwright) {
    const faucetRegex = /```claim_faucet\n([\s\S]*?)```/g;
    while ((match = faucetRegex.exec(aiText)) !== null) {
      const [url, walletAddress] = match[1].trim().split('|');
      await ctx.reply(`🚰 Claiming faucet untuk ${walletAddress?.substring(0, 10)}...`);
      try {
        const result = await playwright.claimFaucet(url.trim(), walletAddress.trim());
        let msg = result.success ? `✅ Faucet claimed!\n${result.message}` : `❌ Gagal: ${result.message}`;
        toolOutputs.push(msg);
      } catch (e) {
        toolOutputs.push(`❌ Error faucet: ${e.message}`);
      }
      finalText = finalText.replace(match[0], '');
    }

    // 9. Batch faucet (semua wallet)
    const batchFaucetRegex = /```batch_faucet\n([\s\S]*?)```/g;
    while ((match = batchFaucetRegex.exec(aiText)) !== null) {
      const url = match[1].trim();
      const wallets = loadWallets();
      if (wallets.length === 0) {
        toolOutputs.push('❌ Belum ada wallet. Buat wallet dulu!');
      } else {
        await ctx.reply(`🚰 Batch claim untuk ${wallets.length} wallet dimulai...`);
        const addresses = wallets.map(w => w.address).filter(Boolean);
        const results = await playwright.batchClaimFaucet(url, addresses, {}, async (i, total, addr) => {
          if (i % 5 === 0) await ctx.reply(`⏳ Progress: ${i}/${total}`);
        });
        const success = results.filter(r => r.success).length;
        toolOutputs.push(`✅ Batch selesai: ${success}/${results.length} berhasil`);
      }
      finalText = finalText.replace(match[0], '');
    }

    // 10. Auto register
    const registerRegex = /```auto_register\n([\s\S]*?)```/g;
    while ((match = registerRegex.exec(aiText)) !== null) {
      const [url, email] = match[1].trim().split('|');
      await ctx.reply(`📝 Auto register di ${url}...`);
      try {
        const result = await playwright.autoRegister(url.trim(), email?.trim() || `user${Date.now()}@gmail.com`);
        let msg = result.success
          ? `✅ Register berhasil!\nEmail: ${result.userData?.email}\nUsername: ${result.userData?.username}\nPassword: ${result.userData?.password}`
          : `❌ Gagal: ${result.message}`;
        toolOutputs.push(msg);
      } catch (e) {
        toolOutputs.push(`❌ Error register: ${e.message}`);
      }
      finalText = finalText.replace(match[0], '');
    }

    // 11. Screenshot
    const screenshotRegex = /```screenshot\n([\s\S]*?)```/g;
    while ((match = screenshotRegex.exec(aiText)) !== null) {
      const url = match[1].trim();
      await ctx.reply(`📸 Screenshot ${url}...`);
      try {
        const ssPath = await playwright.screenshotUrl(url);
        if (ssPath && fs.existsSync(ssPath)) {
          await ctx.replyWithPhoto({ source: ssPath });
          toolOutputs.push(`✅ Screenshot diambil`);
        } else {
          toolOutputs.push(`❌ Gagal screenshot`);
        }
      } catch (e) {
        toolOutputs.push(`❌ Error screenshot: ${e.message}`);
      }
      finalText = finalText.replace(match[0], '');
    }
  }

  // 12. List wallets
  if (aiText.includes('```list_wallets```')) {
    const wallets = loadWallets();
    if (wallets.length === 0) {
      toolOutputs.push('📭 Belum ada wallet.');
    } else {
      const list = wallets.map((w, i) =>
        `${i + 1}. *${w.label}*\n   📍 \`${w.address || 'N/A'}\`\n   🔑 \`${(w.privateKey || '').substring(0, 10)}...\``
      ).join('\n\n');
      toolOutputs.push(`💼 *Wallet (${wallets.length}):*\n\n${list}`);
    }
    finalText = finalText.replace('```list_wallets```', '');
  }

  // 13. Clear memory
  if (aiText.includes('```clear_memory```')) {
    clearMemory();
    toolOutputs.push('🧹 Memory dihapus.');
    finalText = finalText.replace('```clear_memory```', '');
  }

  return { text: finalText.trim(), toolOutputs };
}

// ─── KIRIM KE LLM ─────────────────────────────────────────────────────────────
async function askLLM(userMessage, history) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await axios.post(`${BASE_URL}/chat/completions`, {
    model: DEFAULT_MODEL,
    messages,
    max_tokens: 1500,
    temperature: 0.7
  }, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 60000
  });

  return response.data.choices[0].message.content;
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(
    '👋 *Hermes Agent aktif!*\n\n' +
    '🖥️ Shell commands\n' +
    '💰 Multi-chain wallet (mainnet + testnet)\n' +
    '⚖️ Cek balance semua EVM chains\n' +
    '📤 Kirim native token\n' +
    '🚰 Auto claim faucet\n' +
    '📝 Auto register airdrop\n' +
    '📸 Screenshot website\n' +
    '🧠 Memory percakapan\n\n' +
    'Ketik /help untuk semua commands.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('model', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(`🤖 Model: \`${DEFAULT_MODEL}\``, { parse_mode: 'Markdown' });
});

bot.command('chains', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const mainnets = Object.entries(EVM_CHAINS).filter(([, v]) => !v.testnet).map(([k, v]) => `• \`${k}\` — ${v.name}`).join('\n');
  const testnets = Object.entries(EVM_CHAINS).filter(([, v]) => v.testnet).map(([k, v]) => `• \`${k}\` — ${v.name}`).join('\n');
  ctx.reply(`*Mainnet:*\n${mainnets}\n\n*Testnet:*\n${testnets}`, { parse_mode: 'Markdown' });
});

bot.command('wallets', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const wallets = loadWallets();
  if (wallets.length === 0) return ctx.reply('📭 Belum ada wallet.');
  const list = wallets.map((w, i) =>
    `${i + 1}. *${w.label}*\n   📍 \`${w.address || 'N/A'}\`\n   🔑 \`${(w.privateKey || '').substring(0, 12)}...\`\n   📅 ${w.createdAt}`
  ).join('\n\n');
  ctx.reply(`💼 *Wallets (${wallets.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.command('balance', async (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const args = ctx.message.text.replace('/balance ', '').trim().split(' ');
  const address = args[0];
  const chain = args[1] || 'ethereum';
  if (!address) return ctx.reply('Usage: /balance <address> [chain]');
  ctx.reply('🔍 Cek balance...');
  const result = await checkBalance(address, chain);
  ctx.reply(result, { parse_mode: 'Markdown' });
});

bot.command('shell', async (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const command = ctx.message.text.replace('/shell ', '').trim();
  if (!command) return ctx.reply('Usage: /shell <command>');
  ctx.reply(`⚡ Running: \`${command}\``, { parse_mode: 'Markdown' });
  const output = await runShell(command);
  ctx.reply(`\`\`\`\n${output.substring(0, 3000)}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  if (monitor) {
    const report = await monitor.getStatusReport();
    ctx.reply(report, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('⚠️ Monitor module tidak aktif.');
  }
});

bot.command('memory', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  const history = loadMemory();
  ctx.reply(`🧠 Memory: ${history.length}/${MAX_HISTORY} pesan`);
});

bot.command('clearmemory', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  clearMemory();
  ctx.reply('🧹 Memory dihapus!');
});

bot.command('help', (ctx) => {
  if (ctx.message.from.id !== OWNER_ID) return;
  ctx.reply(
    `*Hermes Agent Commands:*\n\n` +
    `/start — Sambutan\n` +
    `/model — Model aktif\n` +
    `/chains — List semua EVM chains\n` +
    `/wallets — Lihat semua wallet\n` +
    `/balance <addr> [chain] — Cek balance\n` +
    `/shell <cmd> — Jalankan bash\n` +
    `/status — Health check semua service\n` +
    `/memory — Cek memory\n` +
    `/clearmemory — Hapus history\n` +
    `/help — Bantuan ini\n\n` +
    `*Chat langsung:*\n` +
    `"buat 10 wallet ethereum"\n` +
    `"cek balance 0x... di arbitrum"\n` +
    `"cek semua balance 0x... testnet"\n` +
    `"claim faucet https://... pake wallet 1"\n` +
    `"screenshot https://..."\n` +
    `"register di https://... pake email test@gmail.com"`,
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
    const aiResponse = await askLLM(text, history);
    const { text: cleanText, toolOutputs } = await parseAndExecuteTools(aiResponse, ctx);

    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: aiResponse });
    history = saveMemory(history);

    if (cleanText) {
      await ctx.reply(cleanText, { parse_mode: 'Markdown' }).catch(() => ctx.reply(cleanText));
    }

    for (const output of toolOutputs) {
      await ctx.reply(output, { parse_mode: 'Markdown' }).catch(() => ctx.reply(output));
    }

  } catch (error) {
    console.error('[ERROR]', error.message);
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
bot.launch();
console.log('[Hermes] Bot launched ✅');

if (monitor) {
  monitor.initMonitor(bot, OWNER_ID);
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
