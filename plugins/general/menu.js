export default {
  name: 'menu',
  description: 'Menampilkan daftar fitur berdasarkan kategori',
  async exec({ sock, m, commands }) {
    const categories = {};

    commands.forEach((cmd) => {
      const cat = cmd.category || 'uncategorized';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd.name);
    });

    let textMenu = `*━━━[ BOT DASHBOARD MENU ]━━━*\n\n`;

    for (const [category, cmds] of Object.entries(categories)) {
      textMenu += `📂 *KATEGORI: ${category.toUpperCase()}*\n`;
      cmds.forEach((c) => {
        textMenu += `  ├ .${c}\n`;
      });
      textMenu += `\n`;
    }

    textMenu += `_Auto-loaded dari folder plugins_`;

    await sock.sendMessage(m.key.remoteJid, {
      image: { url: 'https://picsum.photos/800/400' },
      caption: textMenu
    }, { quoted: m });
  }
};
