require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    makeInMemoryStore,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const BOT_NAME = 'NAZIK-MD';
const POWERED_BY = 'nazuXhacker';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const PREFIX = '.';

const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent' })
});

// ===== VCF CREATOR =====
function createVCF(participants, groupName) {
    let vcf = '';
    let counter = 0;
    for (let p of participants) {
        counter++;
        const number = p.id.split('@')[0].replace(/[^0-9]/g, '');
        let name = (p.notify || p.verifiedName || number)
            .replace(/[^a-zA-Z0-9 ]/g, '').trim();
        if (!name) name = `Contact_${counter}`;
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nN:${name};;;\n`;
        vcf += `TEL;TYPE=CELL;PREF:${number}\n`;
        vcf += `TEL;TYPE=WHATSAPP:${number}\n`;
        vcf += `X-GROUP:${groupName}\nCATEGORIES:WhatsApp,${groupName}\nEND:VCARD\n\n`;
    }
    return vcf;
}

// ===== NUMBERS LIST =====
function createNumbersList(participants, groupName) {
    let text = `╔══════════════════════════════╗\n`;
    text += `║   ${BOT_NAME} - MEMBERS LIST\n`;
    text += `║   Group: ${groupName}\n`;
    text += `║   Total: ${participants.length}\n`;
    text += `╚══════════════════════════════╝\n\n`;
    let c = 1;
    for (let p of participants) {
        text += `${c}. ${p.id.split('@')[0].replace(/[^0-9]/g, '')}\n`;
        c++;
    }
    text += `\n_Powered by ${POWERED_BY}_`;
    return text;
}

async function startBot() {
    console.log(`\n╔═══════════════════════════════════╗`);
    console.log(`║     ${BOT_NAME} - BOT STARTING      ║`);
    console.log(`║     POWERED BY: ${POWERED_BY}      ║`);
    console.log(`╚═══════════════════════════════════╝\n`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => store.loadMessage(key.remoteJid, key.id)
    });

    store.bind(sock.ev);
    let ownerJid = OWNER_NUMBER ? OWNER_NUMBER + '@s.whatsapp.net' : null;

    // ============================================
    // 🔑 PAIR CODE REQUEST — THE FIX
    // ============================================
    if (!sock.authState.creds.registered) {
        if (!OWNER_NUMBER) {
            console.log('❌ OWNER_NUMBER env variable missing!');
        } else {
            setTimeout(async () => {
                try {
                    console.log(`📱 Requesting pair code for ${OWNER_NUMBER}...\n`);
                    const code = await sock.requestPairingCode(OWNER_NUMBER);
                    console.log(`🔑 ======================================`);
                    console.log(`🔑  PAIR CODE:  ${code}`);
                    console.log(`🔑 ======================================`);
                    console.log(`\n📌 WhatsApp > Settings > Linked Devices`);
                    console.log(`📌 Tap "Link a Device"`);
                    console.log(`📌 Tap "Link with phone number instead"`);
                    console.log(`📌 Enter: ${code}\n`);
                } catch (err) {
                    console.log('❌ Pair code error:', err.message);
                    console.log('🔄 Retrying in 10 seconds...');
                    setTimeout(async () => {
                        try {
                            const code2 = await sock.requestPairingCode(OWNER_NUMBER);
                            console.log(`🔑 PAIR CODE (retry): ${code2}\n`);
                        } catch (e2) {
                            console.log('❌ Retry failed:', e2.message);
                        }
                    }, 10000);
                }
            }, 5000);
        }
    } else {
        console.log('✅ Session already registered. Skipping pair code.');
    }

    // ===== CONNECTION =====
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`\n✅ ${BOT_NAME} CONNECTED!`);
            console.log(`📌 Commands: ${PREFIX}vcf | ${PREFIX}numbers | ${PREFIX}once | ${PREFIX}help\n`);
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting in 5s...');
                setTimeout(startBot, 5000);
            } else {
                console.log('🗑️ Logged out. Delete auth_info folder.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ===== MESSAGES =====
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const text = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';
            const command = text.toLowerCase().trim();

            if (!ownerJid) ownerJid = sender;

            // .help
            if (command === `${PREFIX}help`) {
                await sock.sendMessage(sender, {
                    text: `🤖 *${BOT_NAME}*\n_${POWERED_BY}_\n\n` +
                        `• ${PREFIX}vcf — Group VCF file\n` +
                        `• ${PREFIX}numbers — Members list\n` +
                        `• ${PREFIX}once — View once media\n` +
                        `• ${PREFIX}help — Help`
                });
                return;
            }

            // .vcf
            if (command === `${PREFIX}vcf`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }
                await sock.sendMessage(sender, { text: '⏳ Creating VCF...' });
                const group = await sock.groupMetadata(sender);
                const members = group.participants;
                const vcf = createVCF(members, group.subject);
                const filename = `members_${Date.now()}.vcf`;
                const filePath = path.join(__dirname, filename);
                fs.writeFileSync(filePath, vcf, 'utf-8');
                if (ownerJid) {
                    await sock.sendMessage(ownerJid, {
                        document: fs.readFileSync(filePath),
                        fileName: filename,
                        mimetype: 'text/vcard',
                        caption: `✅ ${group.subject}\n👥 ${members.length} members`
                    });
                }
                await sock.sendMessage(sender, { text: '✅ VCF sent to DM!' });
            }

            // .numbers
            else if (command === `${PREFIX}numbers`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }
                await sock.sendMessage(sender, { text: '⏳ Extracting...' });
                const group = await sock.groupMetadata(sender);
                const members = group.participants;
                const list = createNumbersList(members, group.subject);
                if (ownerJid) {
                    await sock.sendMessage(ownerJid, { text: list });
                }
                await sock.sendMessage(sender, { text: '✅ Sent to DM!' });
            }

            // .once
            else if (command === `${PREFIX}once`) {
                await sock.sendMessage(sender, { text: '📤 Send image/video (60s)' });
                const handler = async (payload) => {
                    const m2 = payload.messages[0];
                    if (!m2.message || m2.key.remoteJid !== sender) return;
                    const isImg = !!m2.message.imageMessage;
                    const isVid = !!m2.message.videoMessage;
                    if (!isImg && !isVid) return;
                    try {
                        const buffer = await sock.downloadMediaMessage(m2);
                        if (ownerJid) {
                            if (isImg) await sock.sendMessage(ownerJid, { image: buffer, viewOnce: true, caption: `👁️ View Once\n_${BOT_NAME}_` });
                            else await sock.sendMessage(ownerJid, { video: buffer, viewOnce: true, caption: `👁️ View Once\n_${BOT_NAME}_` });
                        }
                        await sock.sendMessage(sender, { text: '✅ Sent!' });
                        sock.ev.off('messages.upsert', handler);
                    } catch (e) { console.log('Media err:', e.message); }
                };
                sock.ev.on('messages.upsert', handler);
                setTimeout(() => sock.ev.off('messages.upsert', handler), 60000);
            }

            // AUTO VIEW-ONCE
            else {
                const vo = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
                if (vo && (vo.imageMessage || vo.videoMessage)) {
                    try {
                        const buffer = await sock.downloadMediaMessage(msg);
                        if (ownerJid) {
                            if (vo.imageMessage) await sock.sendMessage(ownerJid, { image: buffer, caption: `👁️ Auto from ${sender.split('@')[0]}\n_${BOT_NAME}_` });
                            else await sock.sendMessage(ownerJid, { video: buffer, caption: `👁️ Auto from ${sender.split('@')[0]}\n_${BOT_NAME}_` });
                        }
                    } catch (e) { console.log('Auto VO err:', e.message); }
                }
            }
        } catch (error) {
            console.log('Handler err:', error.message);
        }
    });

    console.log(`🔄 ${BOT_NAME} running...`);
}

startBot().catch(err => {
    console.error('Fatal:', err);
    setTimeout(startBot, 5000);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
