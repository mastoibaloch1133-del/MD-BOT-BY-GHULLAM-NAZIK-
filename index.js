require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const express = require('express');
const cors = require('cors');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    makeInMemoryStore,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const BOT_NAME = 'NAZIK-MD';
const POWERED_BY = 'nazuXhacker';
const PREFIX = '.';
const PORT = process.env.PORT || 3000;

const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent' })
});

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

const pairCodes = {};
const activeSessions = {};

// ============================================
// API: Generate Pair Code
// ============================================
app.post('/api/pair', async (req, res) => {
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ error: 'Number required' });
        }
        
        const cleanNumber = number.replace(/[^0-9]/g, '');
        
        if (cleanNumber.length < 10) {
            return res.status(400).json({ error: 'Invalid number' });
        }
        
        console.log(`\n📱 Pair code request: ${cleanNumber}`);
        
        const sessionDir = `auth_info_${cleanNumber}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            browser: Browsers.macOS('Desktop'),
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            generateHighQualityLinkPreview: true
        });
        
        await new Promise(r => setTimeout(r, 3000));
        
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`✅ Pair code: ${code}`);
        
        activeSessions[cleanNumber] = sock;
        pairCodes[cleanNumber] = code;
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`✅ ${cleanNumber} CONNECTED!`);
                delete pairCodes[cleanNumber];
                setupMessageHandler(sock, cleanNumber + '@s.whatsapp.net');
            }
        });
        
        res.json({ 
            success: true, 
            code: code,
            message: 'Pair code generated!'
        });
        
    } catch (error) {
        console.log('Pair error:', error.message);
        res.status(500).json({ 
            error: error.message || 'Failed to generate pair code' 
        });
    }
});

// ============================================
// API: Check Status
// ============================================
app.get('/api/status/:number', (req, res) => {
    const number = req.params.number.replace(/[^0-9]/g, '');
    res.json({ 
        number, 
        connected: !!activeSessions[number],
        pairCode: pairCodes[number] || null
    });
});

// ============================================
// Homepage
// ============================================
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>${BOT_NAME}</title></head>
        <body style="font-family:sans-serif;background:#1a1a2e;color:#fff;padding:40px;text-align:center;">
            <h1>${BOT_NAME}</h1>
            <p>Powered by ${POWERED_BY}</p>
            <p>✅ API is running</p>
            <p>POST /api/pair with { "number": "923001234567" }</p>
        </body>
        </html>
    `);
});

// ============================================
// VCF + NUMBERS HELPERS
// ============================================
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

// ============================================
// MESSAGE HANDLER
// ============================================
function setupMessageHandler(sock, ownerJid) {
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
            console.log('Handler err:', error.message);
        }
    });
}

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔═══════════════════════════════════╗`);
    console.log(`║     ${BOT_NAME} - API SERVER       ║`);
    console.log(`║     POWERED BY: ${POWERED_BY}      ║`);
    console.log(`╚═══════════════════════════════════╝`);
    console.log(`\n🌐 Server running on port ${PORT}`);
    console.log(`📌 API: POST /api/pair`);
    console.log(`📌 Body: { "number": "923001234567" }\n`);
});
