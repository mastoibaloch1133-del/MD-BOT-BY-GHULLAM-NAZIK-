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
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';
const PREFIX = '.';

const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent' })
});

// ==============================
// VCF CREATOR — Original Format
// ==============================
function createVCF(participants, groupName) {
    let vcf = '';
    let counter = 0;
    for (let p of participants) {
        counter++;
        const number = p.id.split('@')[0].replace(/[^0-9]/g, '');
        let name = (p.notify || p.verifiedName || number)
            .replace(/[^a-zA-Z0-9 ]/g, '')
            .trim();
        if (!name) name = `Contact_${counter}`;

        vcf += `BEGIN:VCARD\n`;
        vcf += `VERSION:3.0\n`;
        vcf += `FN:${name}\n`;
        vcf += `N:${name};;;\n`;
        vcf += `TEL;TYPE=CELL;PREF:${number}\n`;
        vcf += `TEL;TYPE=WHATSAPP:${number}\n`;
        vcf += `X-GROUP:${groupName}\n`;
        vcf += `CATEGORIES:WhatsApp,${groupName}\n`;
        vcf += `END:VCARD\n\n`;
    }
    return vcf;
}

// ==============================
// NUMBERS LIST CREATOR — Original Format
// ==============================
function createNumbersList(participants, groupName) {
    let text = `╔══════════════════════════════╗\n`;
    text += `║   ${BOT_NAME} - MEMBERS LIST\n`;
    text += `║   Group: ${groupName}\n`;
    text += `║   Total: ${participants.length}\n`;
    text += `╚══════════════════════════════╝\n\n`;

    let counter = 1;
    for (let p of participants) {
        const number = p.id.split('@')[0].replace(/[^0-9]/g, '');
        text += `${counter}. ${number}\n`;
        counter++;
    }

    text += `\n_Powered by ${POWERED_BY}_`;
    return text;
}

// ==============================
// GET PROFILE PICTURE
// ==============================
async function getProfilePicture(sock, jid) {
    try {
        return await sock.profilePictureUrl(jid, 'image');
    } catch {
        return null;
    }
}

// ==============================
// MAIN BOT
// ==============================
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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, pairCode } = update;

        if (pairCode) {
            console.log(`\n🔑 PAIR CODE: ${pairCode}`);
            console.log(`📌 WhatsApp > Linked Devices > Link a Device\n`);
        }

        if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} CONNECTED!`);
            console.log(`📌 Commands: ${PREFIX}vcf | ${PREFIX}numbers | ${PREFIX}once | ${PREFIX}help\n`);
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
            else console.log('🗑️ Logged out.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';
            const command = text.toLowerCase().trim();

            if (!ownerJid) {
                ownerJid = sender;
                console.log(`👑 Owner: ${sender}`);
            }

            // ==============================
            // .help
            // ==============================
            if (command === `${PREFIX}help`) {
                const help =
                    `🤖 *${BOT_NAME}*\n_${POWERED_BY}_\n\n` +
                    `📌 *Commands:*\n` +
                    `• ${PREFIX}vcf — Group members VCF file\n` +
                    `• ${PREFIX}numbers — Members numbers list\n` +
                    `• ${PREFIX}once — Send view-once media\n` +
                    `• ${PREFIX}help — Show help\n\n` +
                    `💡 All results sent to DM.`;
                await sock.sendMessage(sender, { text: help });
                return;
            }

            // ==============================
            // .vcf
            // ==============================
            if (command === `${PREFIX}vcf`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }

                await sock.sendMessage(sender, { text: '⏳ Creating VCF file...' });

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
                        caption:
                            `✅ *${BOT_NAME}*\n` +
                            `📁 Group: ${group.subject}\n` +
                            `👥 Members: ${members.length}`
                    });
                }

                await sock.sendMessage(sender, { text: '✅ VCF sent to DM!' });
                console.log(`✅ VCF: ${members.length} members`);
            }

            // ==============================
            // .numbers
            // ==============================
            else if (command === `${PREFIX}numbers`) {
                if (!sender.endsWith('@g.us')) {
                    await sock.sendMessage(sender, { text: '❌ Only in groups!' });
                    return;
                }

                await sock.sendMessage(sender, { text: '⏳ Extracting numbers...' });

                const group = await sock.groupMetadata(sender);
                const members = group.participants;
                const numbersText = createNumbersList(members, group.subject);

                if (ownerJid) {
                    await sock.sendMessage(ownerJid, { text: numbersText });
                }

                await sock.sendMessage(sender, { text: '✅ Numbers sent to DM!' });
                console.log(`✅ Numbers list: ${members.length}`);
            }

            // ==============================
            // .once — Manual view-once
            // ==============================
            else if (command === `${PREFIX}once`) {
                await sock.sendMessage(sender, {
                    text: `📤 *${BOT_NAME}*\nSend image/video now — I'll forward as view-once.\n⏱️ 60 seconds.`
                });

                const mediaHandler = async (payload) => {
                    const m2 = payload.messages[0];
                    if (!m2.message || m2.key.remoteJid !== sender) return;

                    const isImage = !!m2.message.imageMessage;
                    const isVideo = !!m2.message.videoMessage;
                    if (!isImage && !isVideo) return;

                    try {
                        const buffer = await sock.downloadMediaMessage(m2);

                        if (ownerJid) {
                            if (isImage) {
                                await sock.sendMessage(ownerJid, {
                                    image: buffer,
                                    viewOnce: true,
                                    caption: `👁️ View Once\n_${BOT_NAME}_`
                                });
                            } else {
                                await sock.sendMessage(ownerJid, {
                                    video: buffer,
                                    viewOnce: true,
                                    caption: `👁️ View Once\n_${BOT_NAME}_`
                                });
                            }
                        }

                        await sock.sendMessage(sender, { text: '✅ Sent to DM!' });
                        sock.ev.off('messages.upsert', mediaHandler);
                    } catch (e) {
                        console.log('Media error:', e.message);
                    }
                };

                sock.ev.on('messages.upsert', mediaHandler);
                setTimeout(() => sock.ev.off('messages.upsert', mediaHandler), 60000);
            }

            // ==============================
            // AUTO VIEW-ONCE DETECTION
            // ==============================
            else {
                const msgData = msg.message;
                const viewOnceMsg =
                    msgData.viewOnceMessageV2?.message ||
                    msgData.viewOnceMessage?.message;

                if (viewOnceMsg) {
                    const isImage = !!viewOnceMsg.imageMessage;
                    const isVideo = !!viewOnceMsg.videoMessage;

                    if (isImage || isVideo) {
                        try {
                            const buffer = await sock.downloadMediaMessage(msg);

                            if (ownerJid) {
                                if (isImage) {
                                    await sock.sendMessage(ownerJid, {
                                        image: buffer,
                                        caption: `👁️ Auto ViewOnce from ${sender.split('@')[0]}\n_${BOT_NAME}_`
                                    });
                                } else {
                                    await sock.sendMessage(ownerJid, {
                                        video: buffer,
                                        caption: `👁️ Auto ViewOnce from ${sender.split('@')[0]}\n_${BOT_NAME}_`
                                    });
                                }
                            }
                            console.log(`📥 Auto view-once from ${sender}`);
                        } catch (e) {
                            console.log('Auto viewOnce error:', e.message);
                        }
                    }
                }
            }

        } catch (error) {
            console.log('Handler error:', error.message);
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