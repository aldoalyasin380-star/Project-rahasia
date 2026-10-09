export default {
  name: 'tiktok',
  description: 'Download video TikTok',
  async exec({ sock, m, args }) {
    if (!args[0]) {
      return await sock.sendMessage(m.key.remoteJid, { text: '❌ Masukkan link TikTok!\nContoh: .tiktok https://vm.tiktok.com/xxx' });
    }

    await sock.sendMessage(m.key.remoteJid, { text: '⏳ Sedang memproses unduhan...' });
  }
};
