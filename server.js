import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { readdir, stat } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

export const commands = new Map();

function sendTerminalLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('id-ID');
  io.emit('terminal-log', { message, type, timestamp });
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
}

// Auto Load Plugins (Compatible with Node 18+ dynamic imports)
async function loadPlugins() {
  commands.clear();
  const pluginsDir = path.join(__dirname, 'plugins');

  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }

  try {
    const categories = await readdir(pluginsDir);
    let totalLoaded = 0;

    for (const category of categories) {
      const categoryPath = path.join(pluginsDir, category);
      const categoryStat = await stat(categoryPath);

      if (categoryStat.isDirectory()) {
        const files = await readdir(categoryPath);

        for (const file of files) {
          if (file.endsWith('.js')) {
            const filePath = path.join(categoryPath, file);
            const fileUrl = pathToFileURL(filePath).href + `?v=${Date.now()}`;

            try {
              const pluginModule = await import(fileUrl);
              const cmd = pluginModule.default || pluginModule;

              if (cmd && cmd.name) {
                commands.set(cmd.name, { ...cmd, category });
                totalLoaded++;
              }
            } catch (err) {
              sendTerminalLog(`Gagal memuat plugin ${file}: ${err.message}`, 'error');
            }
          }
        }
      }
    }
    sendTerminalLog(`Sistem berhasil memuat ${totalLoaded} fitur dari ${categories.length} kategori folder.`, 'success');
  } catch (err) {
    sendTerminalLog(`Error membaca folder plugins: ${err.message}`, 'error');
  }
}

// Watcher untuk auto-detect folder/file baru
if (fs.existsSync(path.join(__dirname, 'plugins'))) {
  fs.watch(path.join(__dirname, 'plugins'), { recursive: true }, (eventType, filename) => {
    if (filename) {
      sendTerminalLog(`Perubahan terdeteksi: ${filename}. Memuat ulang fitur...`, 'warn');
      loadPlugins();
    }
  });
}

// WhatsApp Baileys Setup
let sock = null;

async function startBot(phoneNumber = null) {
  const sessionDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '120.0.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  if (phoneNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        let code = await sock.requestPairingCode(phoneNumber);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        io.emit('pairing-code', { code });
        sendTerminalLog(`Kode pairing berhasil dibuat: ${code}`, 'success');
      } catch (err) {
        sendTerminalLog(`Gagal meminta kode pairing: ${err.message}`, 'error');
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      sendTerminalLog(`Koneksi terputus. Menghubungkan ulang: ${shouldReconnect}`, 'warn');
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      sendTerminalLog('WhatsApp Bot BERHASIL TERHUBUNG!', 'success');
      io.emit('bot-status', { status: 'connected' });
    }
  });

  // Message Listener
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
    const prefix = '.';

    if (!text.startsWith(prefix)) return;

    const args = text.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const plugin = commands.get(commandName);
    if (plugin) {
      sendTerminalLog(`Menjalankan perintah .${commandName} dari ${m.key.remoteJid}`, 'info');
      try {
        await plugin.exec({ sock, m, args, commands, sendTerminalLog });
      } catch (err) {
        sendTerminalLog(`Error pada command .${commandName}: ${err.message}`, 'error');
        await sock.sendMessage(m.key.remoteJid, { text: `❌ Terjadi kesalahan: ${err.message}` });
      }
    }
  });
}

// Routes
app.get('/', (req, res) => res.render('index'));

app.post('/api/pair', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Nomor telepon wajib diisi!' });

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  sendTerminalLog(`Menerima permintaan pairing untuk: ${cleanPhone}`, 'info');

  await startBot(cleanPhone);
  res.json({ success: true, message: 'Proses pairing dimulai...' });
});

// Socket Events
io.on('connection', (socket) => {
  sendTerminalLog('Client terhubung ke Terminal Dashboard.', 'info');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  await loadPlugins();
  await startBot();
});
