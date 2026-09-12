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

function createVCF(participants, groupName) {
    let vcf = '';
    let counter = 0;
    for (let p of participants) {
        counter++;
        const number = p.id.split('@')[0].replace(/[^0-9]/g, '');
        let name = (p.notify || p.verifiedName || number).replace(/[^a-zA-Z0-9 ]/g, '').trim();
        if (!name) name = `Contact_${counter}`;
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nN:${name};;;\n`;
        vcf += `TEL;TYPE=CELL;PREF:${number}\nTEL;TYPE=WHATSAPP:${number}\n`;
        vcf += `X-GROUP:${groupName}\nCATEGORIES:WhatsApp,${groupName}\nEND:VCARD\n\n`;
    }
    return vcf;
}

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
    console.log('====================================');
    console.log(`  ${BOT_NAME} - STARTING`);
    console.log(`  POWERED BY: ${POWERED_BY}`);
    console.log('====================================');

    // OWNER_NUMBER check
    console.log(`\n📱 OWNER_NUMBER: ${OWNER_NUMBER || 'MISSING!'}\n`);

    if (!OWNER_NUMBER) {
        console.log('❌ OWNER_NUMBER env variable set nahi hai!');
        console.log('Railway → Variables → Add OWNER_NUMBER = 923XXXXXXXXX');
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // Check if already registered
    const isRegistered = state.creds.registered;
    console.log(`🔑 Already registered: ${isRegistered}`);

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => store.loadMessage(key.remoteJid, key.id)
    });

    store.bind(sock.ev);
    let ownerJid = OWNER_NUMBER + '@s.whatsapp.net';

    // ============================================
    // 🔑 PAIR CODE — AGGRESSIVE METHOD
    // ============================================
    if (!isRegistered) {
        console.log('\n📱 Requesting pair code...\n');

        // Delay enough for socket to be ready
        await new Promise(r => setTimeout(r, 3000));

        // Try multiple times
        for (let i = 1; i <= 5; i++) {
            try {
                console.log(`Attempt ${i}: Calling requestPairingCode...`);
                const code = await sock.requestPairingCode(OWNER_NUMBER);
                console.log('\n╔════════════════════════════════════╗');
                console.log(`║   PAIR CODE:  ${code}              `);
                console.log('╚════════════════════════════════════╝');
                console.log('\n📌 WhatsApp kholo:');
                console.log('   1. Settings → Linked Devices');
                console.log('   2. Link a Device');
                console.log('   3. "Link with phone number instead"');
                console.log(`   4. Enter: ${code}\n`);
                break;
            } catch (err) {
                console.log(`❌ Attempt ${i} failed: ${err.message}`);
                if (i < 5) {
                    console.log('   Retrying in 5s...\n');
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
    } else {
        console.log('✅ Session exists, skipping pair code.\n');
    }

    // ===== CONNECTION =====
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log(`🔌 Connection status: ${connection || 'updating...'}`);

        if (qr) {
            console.log('⚠️ QR received but ignored (using pair code)');
        }

        if (connection === 'open') {
            console.log('\n✅✅✅ BOT CONNECTED! ✅✅✅');
            console.log(`📌 Commands: ${PREFIX}vcf | ${PREFIX}numbers | ${PREFIX}once | ${PREFIX}help\n`);
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection closed. Code: ${code}`);
            if (code !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting in 5s...\n');
                setTimeout(startBot, 5000);
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

            if (command === `${PREFIX}help`) {
                await sock.sendMessage(sender, {
                    text: `🤖 *${BOT_NAME}*\n_${POWERED_BY}_\n\n• ${PREFIX}vcf\n• ${PREFIX}numbers\n• ${PREFIX}once\n• ${PREFIX}help`
                });
                return;
            }

            if (command === `${PREFIX}vcf`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }
                await sock.sendMessage(sender, { text: '⏳ Creating...' });
                const group = await sock.groupMetadata(sender);
                const vcf = createVCF(group.participants, group.subject);
                const filename = `members_${Date.now()}.vcf`;
                const filePath = path.join(__dirname, filename);
                fs.writeFileSync(filePath, vcf, 'utf-8');
                await sock.sendMessage(ownerJid, {
                    document: fs.readFileSync(filePath),
                    fileName: filename,
                    mimetype: 'text/vcard',
                    caption: `✅ ${group.subject}\n👥 ${group.participants.length} members`
                });
                await sock.sendMessage(sender, { text: '✅ Sent to DM!' });
            }

            else if (command === `${PREFIX}numbers`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }
                await sock.sendMessage(sender, { text: '⏳ Extracting...' });
                const group = await sock.groupMetadata(sender);
                const list = createNumbersList(group.participants, group.subject);
                await sock.sendMessage(ownerJid, { text: list });
                await sock.sendMessage(sender, { text: '✅ Sent to DM!' });
            }

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
                        if (isImg) await sock.sendMessage(ownerJid, { image: buffer, viewOnce: true, caption: `👁️ ${BOT_NAME}` });
                        else await sock.sendMessage(ownerJid, { video: buffer, viewOnce: true, caption: `👁️ ${BOT_NAME}` });
                        await sock.sendMessage(sender, { text: '✅ Sent!' });
                        sock.ev.off('messages.upsert', handler);
                    } catch (e) { console.log(e.message); }
                };
                sock.ev.on('messages.upsert', handler);
                setTimeout(() => sock.ev.off('messages.upsert', handler), 60000);
            }

            else {
                const vo = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
                if (vo && (vo.imageMessage || vo.videoMessage)) {
                    try {
                        const buffer = await sock.downloadMediaMessage(msg);
                        if (vo.imageMessage) await sock.sendMessage(ownerJid, { image: buffer, caption: `👁️ Auto` });
                        else await sock.sendMessage(ownerJid, { video: buffer, caption: `👁️ Auto` });
                    } catch (e) { console.log(e.message); }
                }
            }
        } catch (error) {
            console.log('Handler error:', error.message);
        }
    });

    console.log(`🔄 ${BOT_NAME} running...\n`);
}

startBot().catch(err => {
    console.error('Fatal:', err);
    setTimeout(startBot, 5000);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
