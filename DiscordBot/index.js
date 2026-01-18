// ═══════════════════════════════════════════════════════════════════════════
// 🎙️ บอทระบบเสียงตามระยะ - Discord Voice Chat Bot (Version Fast-Nuke)
// ═══════════════════════════════════════════════════════════════════════════
// 
// สร้างโดย: ZirconX
// 
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const LOBBY_CHANNEL_ID = process.env.LOBBY_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

const ZONE_NAMES = Array.from({ length: 100 }, (_, i) => `ห้องที่ ${i + 1}`);

const activePairs = new Set(); // เก็บ "p1-p2" เพื่อดูว่าใครอยู่ใกล้ใคร
const playerToChannel = new Map(); // ใครอยู่ห้องไหน?
const speakingUsers = new Map();
let zoneCounter = 0;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ]
});

const app = express();
app.use(bodyParser.json());

// ─────────────────────────────────────────────────────────────────────
// ฟังก์ชันช่วย (Fast Utils)
// ─────────────────────────────────────────────────────────────────────
function findMemberByName(guild, name) {
    if (!guild) return null;
    const target = name.toLowerCase();
    // ค้นหาจาก Cache ก่อน (เร็วที่สุด)
    return guild.members.cache.find(m =>
        (m.nickname || "").toLowerCase() === target ||
        m.user.username.toLowerCase() === target ||
        (m.user.globalName || "").toLowerCase() === target
    );
}

function getRandomZoneName() {
    return ZONE_NAMES[zoneCounter++ % ZONE_NAMES.length];
}

async function cleanupStaleZones(guild, forceMove = false) {
    if (!guild) return;
    try {
        const gf = await guild.fetch();
        let lb = LOBBY_CHANNEL_ID ? (await gf.channels.fetch(LOBBY_CHANNEL_ID).catch(() => null)) : null;
        if (!lb) lb = gf.channels.cache.find(c => c.type === ChannelType.GuildVoice && !ZONE_NAMES.includes(c.name));

        const zones = gf.channels.cache.filter(c => c.type === ChannelType.GuildVoice && ZONE_NAMES.includes(c.name));
        for (const [id, channel] of zones) {
            const humanMembers = channel.members.filter(m => !m.user.bot);

            // เงื่อนไขการย้ายคนออก: สั่ง Force หรือ ทิ้งไว้คนเดียว (ไม่มีคนคุยด้วย)
            if (forceMove || humanMembers.size === 1) {
                if (humanMembers.size > 0) {
                    const reason = forceMove ? "[Startup]" : "[Alone]";
                    console.log(`🏠 ${reason} ย้ายคนออกจาก ${channel.name} กลับล็อบบี้`);
                    for (const [, mem] of humanMembers) {
                        const name = mem.nickname || mem.displayName || mem.user.username;
                        playerToChannel.delete(name); // ล้างข้อมูลห้องใน Map
                        if (lb && mem.voice.channelId !== lb.id) {
                            await mem.voice.setChannel(lb).catch(() => { });
                        }
                    }
                }
            }

            // ถ้าห้องว่างแล้ว (หรือเพิ่งย้ายออกจนว่าง) ให้ลบทิ้ง
            const currentMembers = channel.members.filter(m => !m.user.bot);
            if (currentMembers.size === 0) {
                console.log(`🧹 [Cleanup] กำลังลบห้อง Zone: ${channel.name}`);
                await channel.delete().catch(() => { });
            }
        }
    } catch (e) { }
}

// ─────────────────────────────────────────────────────────────────────
// 📡 API HTTP Server (Fast Response)
// ─────────────────────────────────────────────────────────────────────
app.post('/api/proximity', async (req, res) => {
    const { event, players, player } = req.body;
    console.log(`📩 [API Request] Event: ${event}, Player(s): ${players || player}`);
    const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
    if (!guild) {
        console.log(`❌ [Error] ไม่พบ Guild (ID: ${GUILD_ID})`);
        return res.status(500).json({ error: 'No Guild' });
    }
    if (guild.id !== GUILD_ID) {
        console.log(`⚠️  [Warning] ใช้ Guild อื่นแทน: ${guild.name} (ID: ${guild.id}) เพราะหา ID ${GUILD_ID} ไม่เจอ`);
    }

    try {
        if (event === 'force_lobby') {
            const targetName = player;
            if (!targetName) return res.status(400).send("No name");

            res.json({ status: "ok" }); // ตอบทันที

            // ย้ายล็อบบี้ในกราวด์
            const member = findMemberByName(guild, targetName);
            if (!member || !member.voice.channel) return;

            let lb = LOBBY_CHANNEL_ID ? (await guild.channels.fetch(LOBBY_CHANNEL_ID).catch(() => null)) : null;
            if (!lb) lb = guild.channels.cache.find(c => c.type === ChannelType.GuildVoice && !ZONE_NAMES.includes(c.name));

            if (lb && member.voice.channelId !== lb.id) {
                console.log(`🏠 [Force Lobby] กำลังย้าย ${targetName} กลับสู่ล็อบบี้...`);
                await member.voice.setChannel(lb).catch(() => { });
            }
            return;
        }

        if (event === 'check_user') {
            const targetName = player;
            if (!targetName) return res.status(400).send("No name");
            const member = findMemberByName(guild, targetName);
            if (!member) return res.json({ status: "not_found" });

            const info = {
                discordName: member.nickname || member.displayName || member.user.username,
                discordId: member.user.id
            };
            return res.json({
                status: member.voice.channel ? "connected" : "disconnected",
                channel: member.voice.channel?.name || null,
                ...info
            });
        }

        if (event === 'get_speaking') {
            const result = {};
            (players || []).forEach(n => {
                const member = findMemberByName(guild, n);

                // 1. ถ้าหาคนไม่เจอ หรือไม่ได้เข้าห้องเสียง ➜ disconnected (ขาว)
                if (!member || !member.voice.channelId) {
                    result[n] = "disconnected";
                    return;
                }

                // 2. เช็คว่าเป็นห้อง Zone หรือไม่
                // ถ้าชื่อห้องไม่อยู่ในรายชื่อ ZONE_NAMES แสดงว่าเป็น Lobby หรือห้องอื่น ➜ disconnected (ขาว)
                const channelName = member.voice.channel?.name;
                const isZone = channelName && ZONE_NAMES.includes(channelName);

                if (!isZone) {
                    result[n] = "disconnected"; // อยู่ Lobby
                    return;
                }

                // 3. ถ้าอยู่ใน Zone ค่อยเช็คสถานะ Mute ➜ speaking(เขียว) / muted(แดง)
                // ใช้ข้อมูลจาก Event (Cache) หรือเช็คสดจาก Member
                const user = speakingUsers.get(n);
                const isMuted = user ? !user.speaking : (member.voice.selfMute || member.voice.selfDeaf || member.voice.serverMute || member.voice.serverDeaf);

                result[n] = isMuted ? "muted" : "speaking";
            });
            return res.json({ speaking: result });
        }

        // จัดการเหตุการณ์ Connect/Disconnect (ตอบ Minecraft ทันที)
        if (!players || players.length < 2) return res.status(400).send('Bad data');
        const [p1, p2] = players;
        const pairKey = [p1, p2].sort().join('-');

        res.json({ status: "ok" });

        if (event === 'connect') {
            if (activePairs.has(pairKey)) {
                console.log(`🔗 [Connect] คู่ ${p1} <-> ${p2} มีอยู่แล้ว ไม่ต้องทำอะไร`);
                return;
            }
            activePairs.add(pairKey);
            console.log(`🔗 [Connect] คู่ใหม่: ${p1} <-> ${p2}`);
        } else if (event === 'disconnect') {
            if (!activePairs.has(pairKey)) {
                console.log(`🔌 [Disconnect] คู่ ${p1} <-> ${p2} ไม่มีอยู่แล้ว ไม่ต้องทำอะไร`);
                return;
            }
            activePairs.delete(pairKey);
            console.log(`🔌 [Disconnect] แยกคู่: ${p1} <-> ${p2}`);
        }

        // --- ระบบจัดกลุ่ม (Graph Clustering) ---
        const adj = new Map();
        activePairs.forEach(pair => {
            const [pa, pb] = pair.split('-');
            if (!adj.has(pa)) adj.set(pa, []);
            if (!adj.has(pb)) adj.set(pb, []);
            adj.get(pa).push(pb);
            adj.get(pb).push(pa);
        });

        const traverse = (p) => {
            const visited = new Set();
            if (!adj.has(p)) { visited.add(p); return visited; }
            const queue = [p];
            visited.add(p);
            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                (adj.get(curr) || []).forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }
            return visited;
        };

        const moveToZone = async (playerName, channelId) => {
            const mem = findMemberByName(guild, playerName);
            if (!mem || !mem.voice.channelId) return;
            if (mem.voice.channelId !== channelId) {
                await mem.voice.setChannel(channelId).catch(() => { });
                playerToChannel.set(playerName, channelId);
            }
        };

        const moveToLobby = async (playerName) => {
            playerToChannel.delete(playerName); // ล้าง Map ก่อนเสมอ

            const mem = findMemberByName(guild, playerName);
            if (!mem || !mem.voice.channelId) return;

            let lb = LOBBY_CHANNEL_ID ? (await guild.channels.fetch(LOBBY_CHANNEL_ID).catch(() => null)) : null;
            if (!lb) lb = guild.channels.cache.find(c => c.type === ChannelType.GuildVoice && !ZONE_NAMES.includes(c.name));

            if (lb && mem.voice.channelId !== lb.id && ZONE_NAMES.includes(mem.voice.channel.name)) {
                await mem.voice.setChannel(lb).catch(() => { });
            }
        };

        if (event === 'connect') {
            const group = traverse(p1);
            console.log(`👥 [Group] สมาชิกกลุ่ม: ${Array.from(group).join(', ')}`);

            if (group.size > 1) {
                let existingChannelId = null;
                for (const memberName of group) {
                    if (playerToChannel.has(memberName)) {
                        const chId = playerToChannel.get(memberName);
                        const ch = await guild.channels.fetch(chId).catch(() => null);
                        if (ch) {
                            existingChannelId = chId;
                            console.log(`📍 [Logic] พบห้องเดิม: ${ch.name} (จาก ${memberName})`);
                            break;
                        } else {
                            playerToChannel.delete(memberName);
                        }
                    }
                }

                if (!existingChannelId) {
                    const zoneName = getRandomZoneName();
                    const m1 = findMemberByName(guild, p1);
                    const m2 = findMemberByName(guild, p2);
                    const parentId = m1?.voice.channel?.parentId || m2?.voice.channel?.parentId;

                    console.log(`✨ [Logic] กำลังสร้างห้องใหม่: ${zoneName}`);
                    const newChannel = await guild.channels.create({
                        name: zoneName,
                        type: ChannelType.GuildVoice,
                        parent: parentId,
                        permissionOverwrites: [{ id: guild.id, deny: ['Connect'] }]
                    });
                    existingChannelId = newChannel.id;
                }

                for (const memberName of group) {
                    const mem = findMemberByName(guild, memberName);
                    if (mem && mem.id) {
                        const ch = await guild.channels.fetch(existingChannelId).catch(() => null);
                        if (ch) await ch.permissionOverwrites.edit(mem.id, { Connect: true, Speak: true, ViewChannel: true }).catch(() => { });
                    }
                    await moveToZone(memberName, existingChannelId);
                }
            }
        } else if (event === 'disconnect') {
            for (const p of [p1, p2]) {
                const group = traverse(p);
                if (group.size === 1) {
                    console.log(`🏠 [Logic] ${p} ไม่เหลือเพื่อนใกล้ๆ แล้ว ย้ายกลับล็อบบี้`);
                    await moveToLobby(p);
                }
            }
        }
    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในระบบ:", err.message);
    }
});

client.on('voiceStateUpdate', (oldS, newS) => {
    const mem = newS.member || oldS.member;
    if (!mem || mem.user.bot) return;

    // ดึงชื่อที่ตรงกับใน Minecraft
    const name = mem.nickname || mem.displayName || mem.user.username;

    // ถ้าออกจากห้องเสียง
    if (!newS.channelId) {
        speakingUsers.delete(name);
        playerToChannel.delete(name);

        // ลบคู่ทุกคนที่เกี่ยวข้องกับคนนี้
        for (const pair of activePairs) {
            if (pair.includes(name)) {
                activePairs.delete(pair);
                console.log(`🧹 [VoiceState] ลบข้อมูลตกค้างของ ${name} (ออกจากห้องเสียง)`);
            }
        }
        return;
    }

    // เช็คสถานะ Mute/Deaf
    const isMuted = newS.selfMute || newS.selfDeaf || newS.serverMute || newS.serverDeaf;

    speakingUsers.set(name, {
        speaking: !isMuted,
        lastUpdate: Date.now()
    });

    // ─────────────────────────────────────────────────────────────
    // ระบบ Auto Mute (ปิดไมค์อัตโนมัติเมื่ออยู่ Lobby เท่านั้น)
    // ─────────────────────────────────────────────────────────────
    if (newS.channel) {
        // เงื่อนไข: ต้องเป็นห้อง Lobby ตาม ID ที่ระบุเท่านั้น (1461714386304372879)
        const isLobbyChannel = newS.channelId === LOBBY_CHANNEL_ID;

        // ถ้าไม่อยู่ใน Lobby ละก็ เช็คว่าเป็น Zone หรือไม่ (เพื่อ Unmute)
        const channelName = newS.channel.name;
        const isZone = ZONE_NAMES.includes(channelName);

        // 1. ถ้าอยู่ Lobby (ตาม ID) และยังไม่ได้ Mute -> สั่ง Mute
        if (isLobbyChannel && !newS.serverMute) {
            newS.setMute(true, "Auto Mute: Lobby Only").catch(err => {
                console.log(`⚠️ ไม่สามารถปิดไมค์อัตโนมัติ ${name}: ${err.message}`);
            });
        }
        // 2. ถ้าอยู่ห้อง Zone (ไม่ใช่ Lobby, ไม่ใช่ห้องอื่น) และยังติด Mute -> สั่ง Unmute
        else if (isZone && newS.serverMute) {
            newS.setMute(false, "Auto Unmute: Zone").catch(err => {
                console.log(`⚠️ ไม่สามารถเปิดไมค์อัตโนมัติ ${name}: ${err.message}`);
            });
        }
    }
});

client.once('ready', async () => {
    console.log(`✅ บอทระบบเสียง (โหมดรวดเร็ว) พร้อมทำงานแล้ว! โดย ZirconX`);
    console.log(`🤖 บอกอยู่ในเซิร์ฟเวอร์:`);
    client.guilds.cache.forEach(g => console.log(`   - ${g.name} (ID: ${g.id})`));

    const targetGuild = client.guilds.cache.get(GUILD_ID);
    if (!targetGuild) {
        console.log(`❌ [ERROR] บอทไม่อยู่ในเซิร์ฟเวอร์เป้าหมาย ID: ${GUILD_ID}`);
    } else {
        console.log(`🎯 พบเซิร์ฟเวอร์เป้าหมาย: ${targetGuild.name}`);
    }

    await cleanupStaleZones(client.guilds.cache.get(GUILD_ID), true);

    // Auto Mute ทุกคนที่อยู่ใน Lobby ตอนเริ่มบอท
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        console.log(`🔄 กำลังตรวจสอบและปิดไมค์คนที่อยู่ในล็อบบี้...`);
        try {
            const members = await guild.members.fetch();
            let count = 0;
            for (const [id, member] of members) {
                if (!member.voice.channel) continue;

                // เงื่อนไข: ต้องเป็นห้อง Lobby ตาม ID ที่ระบุเท่านั้น (1461714386304372879)
                // ห้องอื่นๆ ที่ไม่ใช่ Lobby และไม่ใช่ Zone จะไม่ถูกยุ่ง
                const isLobbyChannel = member.voice.channelId === LOBBY_CHANNEL_ID;

                // 1. ถ้าอยู่ Lobby (ตาม ID) และยังไม่ได้ Server Mute -> สั่ง Mute
                if (isLobbyChannel && !member.voice.serverMute) {
                    await member.voice.setMute(true, "Auto Mute: Server Start (Lobby Only)").catch(() => { });
                    count++;
                }
            }
            if (count > 0) console.log(`🔇 ปิดไมค์ผู้เล่นในล็อบบี้แล้ว ${count} คน`);
        } catch (e) {
            console.error(`⚠️ ผิดพลาดในการปิดไมค์ล็อบบี้: ${e.message}`);
        }
    }

    // ระบบ Cleanup ห้องว่างทุกๆ 10 วินาที
    setInterval(() => cleanupStaleZones(client.guilds.cache.get(GUILD_ID)), 10000);

    // ระบบล้าง Log อัตโนมัติ (ตรวจสอบทุก 1 ชม. ถ้าเกิน 5MB ให้ล้าง)
    setInterval(() => {
        const logPath = path.join(__dirname, 'bot_log.txt');
        if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            if (stats.size > 5 * 1024 * 1024) { // 5MB
                fs.writeFileSync(logPath, `--- Log Cleared (Size exceeded 5MB) at ${new Date().toLocaleString()} ---\n`);
                console.log(`🧹 [System] ล้างไฟล์ Log เรียบร้อยแล้ว (ขนาดเกิน 5MB)`);
            }
        }
    }, 3600000); // 1 ชั่วโมง

    // แอบ Fetch สมาชิกใหม่ทุก 1 นาทีเพื่ออัปเดต Cache
    setInterval(() => client.guilds.cache.get(GUILD_ID)?.members.fetch().catch(() => { }), 60000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [Unhandled Rejection]:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ [Uncaught Exception]:', err);
});

client.login(TOKEN);
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API เริ่มระบบที่พอร์ต ${PORT}`));
