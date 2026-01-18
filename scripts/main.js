// ═══════════════════════════════════════════════════════════════════════════
// 🎙️ ระบบเสียงตามระยะ - Voice Chat System
// ═══════════════════════════════════════════════════════════════════════════
// 
// สร้างโดย: ZirconX
// 
// ═══════════════════════════════════════════════════════════════════════════

import { world, system } from "@minecraft/server";
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";
import { ModalFormData } from "@minecraft/server-ui";

// ─────────────────────────────────────────────────────────────
// การตั้งค่า
// ─────────────────────────────────────────────────────────────
const DEFAULT_RADIUS = 5;           // ระยะเริ่มต้นที่แนะนำ (5 - 10 บล็อก)
const CHECK_INTERVAL = 10;          // ความถี่ตรวจสอบ (ticks)
const BACKEND_URL = "http://127.0.0.1:3000/api/proximity";
const LOG_TO_CHAT = false;          // แสดง Debug ในแชท

// ─────────────────────────────────────────────────────────────
// ตัวแปรระบบ
// ─────────────────────────────────────────────────────────────
const activeConnections = new Set();

// ─────────────────────────────────────────────────────────────
// ฟังก์ชันแสดงวงกลมระยะเสียง (Particles)
// ─────────────────────────────────────────────────────────────
function drawRadiusCircle(player, radius) {
    const location = player.location;
    const dimension = player.dimension;
    const points = 16; // ลดจำนวนจุดลงเพื่อให้ดูสะอาดตาขึ้น

    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const x = location.x + Math.cos(angle) * radius;
        const z = location.z + Math.sin(angle) * radius;
        const y = location.y + 0.1;

        // เปลี่ยนเป็นสีฟ้าอมเขียว (Blue Flame) ให้ดูพรีเมียมขึ้น
        dimension.spawnParticle("minecraft:blue_flame_particle", { x: x, y: y, z: z });
    }
}

// ─────────────────────────────────────────────────────────────
// ฟังก์ชันคำนวณระยะห่าง
// ─────────────────────────────────────────────────────────────
function getDistance(loc1, loc2) {
    const dx = loc1.x - loc2.x;
    const dy = loc1.y - loc2.y;
    const dz = loc1.z - loc2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getPairKey(p1, p2) {
    const names = [p1.name, p2.name].sort();
    return `${names[0]}-${names[1]}`;
}

// ─────────────────────────────────────────────────────────────
// ฟังก์ชันส่งข้อมูลไปยัง Discord Bot
// ─────────────────────────────────────────────────────────────
async function sendToBackend(data) {
    try {
        const req = new HttpRequest(BACKEND_URL);
        req.method = HttpRequestMethod.Post;
        req.id = "voice_update";
        req.headers = [new HttpHeader("Content-Type", "application/json")];
        req.body = JSON.stringify(data);

        const response = await http.request(req);
        return response;
    } catch (e) {
        if (LOG_TO_CHAT) world.sendMessage(`§c[ผิดพลาด] ไม่สามารถติดต่อบอทได้`);
        console.warn(`[ผิดพลาด] ${e}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// ตรวจสอบสถานะ Discord เมื่อผู้เล่นเข้าเกม
// ─────────────────────────────────────────────────────────────
async function checkDiscordStatus(player) {
    player.sendMessage("§7────────────────");
    player.sendMessage("§e§l Voice Chat System");
    player.sendMessage("§7 by ZirconX");
    player.sendMessage("§7────────────────");
    player.sendMessage("");
    player.sendMessage("§7> ตรวจสอบการเชื่อมต่อ Discord...");

    const response = await sendToBackend({
        event: "check_user",
        player: player.name
    });

    if (response && response.body) {
        // ตรวจสอบว่าเป็น JSON
        const bodyText = response.body.trim();
        if (!bodyText.startsWith("{")) {
            player.sendMessage("§c[X] Bot ไม่ตอบสนอง");
            player.sendMessage("§7────────────────");
            return;
        }

        try {
            const data = JSON.parse(bodyText);
            if (data.status === "connected") {
                player.sendMessage("");
                player.sendMessage("§a§l[+] เชื่อมต่อแล้ว!");
                player.sendMessage(`§a  > ห้องเสียง: §f${data.channel}`);
                player.sendMessage("§a  > ระบบพร้อมใช้งาน");
                player.sendMessage("");
                player.sendMessage("§7[TIP] ถือ §bดิสคอร์ด §7แล้วคลิกขวา");
            } else if (data.status === "disconnected") {
                player.sendMessage("");
                player.sendMessage("§e§l[!] ไม่พบในห้องเสียง");
                player.sendMessage("§7  กรุณาเข้าห้องเสียง Discord");
            } else if (data.status === "not_found") {
                player.sendMessage("");
                player.sendMessage("§c§l[X] ไม่พบบัญชี Discord");
                player.sendMessage(`§7  ชื่อต้องตรงกับ: §f${player.name}`);
            } else if (data.status === "error" || data.status === "ok") {
                player.sendMessage("");
                player.sendMessage("§7> รอสักครู่...");
            }
        } catch (e) {
            console.warn("Parse error: " + e);
        }
    } else {
        player.sendMessage("");
        player.sendMessage("§c[X] เชื่อมต่อ Bot ไม่ได้");
        player.sendMessage("§7  ตรวจสอบว่า Bot ทำงาน");
    }
    player.sendMessage("§7────────────────");
}

// ─────────────────────────────────────────────────────────────
// เมื่อผู้เล่น Spawn
// ─────────────────────────────────────────────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    system.runTimeout(() => {
        checkDiscordStatus(player);
    }, 40);
});

// ─────────────────────────────────────────────────────────────
// หน้าต่างตั้งค่า (UI)
// ─────────────────────────────────────────────────────────────
function showSettingsUI(player) {
    let currentRadius = player.getDynamicProperty("voiceRadius") ?? DEFAULT_RADIUS;
    if (currentRadius < 5) currentRadius = 5;
    if (currentRadius > 10) currentRadius = 10;

    // ดึงสถานะปัจจุบัน (Default: true)
    let isVoiceEnabled = player.getDynamicProperty("isVoiceEnabled");
    if (isVoiceEnabled === undefined) isVoiceEnabled = true;

    const modal = new ModalFormData()
        .title("§l§8ตั้งค่าระบบเสียง")
        .toggle("§cปิด §8➜ §aเปิด §f(ระบบเสียง)", { defaultValue: isVoiceEnabled })
        .slider(`§eระยะการได้ยิน §7(5 - 10 บล็อก)`, 5, 10, { defaultValue: currentRadius })
        .toggle("§aตรวจสอบสถานะ Discord");

    modal.show(player).then(async response => {
        if (response.canceled) return;

        const voiceEnabled = response.formValues[0]; // Toggle อยู่ลำดับที่ 1
        const radius = response.formValues[1];       // Slider อยู่ลำดับที่ 2
        const showStatus = response.formValues[2];   // Toggle ตรวจสอบสถานะ อยู่ลำดับที่ 3

        player.setDynamicProperty("voiceRadius", radius);
        player.setDynamicProperty("isVoiceEnabled", voiceEnabled);

        // ถ้าปิดเสียง ให้ตัดการเชื่อมต่อและย้ายกลับล็อบบี้ทันที
        if (!voiceEnabled) {
            // 1. ส่งสัญญาณให้บอทเตะกลับล็อบบี้ทันที
            sendToBackend({
                event: "force_lobby",
                player: player.name
            });

            // 2. ล้างการเชื่อมต่อกับคนอื่น (ถ้ามี)
            activeConnections.forEach((value, key) => {
                if (key.includes(player.name)) {
                    sendToBackend({ event: "disconnect", players: key.split("-") });
                    activeConnections.delete(key);
                }
            });
        }

        // บันทึกการตั้งค่า
        player.sendMessage("§7────────────────");
        player.sendMessage("§a§l[+] บันทึกแล้ว!");
        player.sendMessage(`§a  > ระยะการได้ยิน: §f${radius} §aบล็อก`);
        player.sendMessage(`§a  > ระบบเสียง: ${voiceEnabled ? "§bเปิดใช้งาน" : "§cปิดใช้งาน"}`);
        player.sendMessage("§7────────────────");

        if (showStatus) {
            // ... ตรวจสอบสถานะ Discord ต่อ ...
            player.sendMessage("");
            player.sendMessage("§e> กำลังตรวจสอบสถานะ Discord...");

            const statusResponse = await sendToBackend({
                event: "check_user",
                player: player.name
            });

            player.sendMessage("");
            player.sendMessage("§6§l[Discord Status]");
            player.sendMessage("§7────────────────");

            if (statusResponse && statusResponse.body) {
                // ตรวจสอบว่าเป็น JSON หรือไม่
                const bodyText = statusResponse.body.trim();
                if (!bodyText.startsWith("{")) {
                    player.sendMessage("§c[X] Bot ไม่ตอบสนอง");
                    player.sendMessage("§7────────────────");
                    return;
                }

                try {
                    const data = JSON.parse(bodyText);

                    if (data.status === "connected") {
                        player.sendMessage("§a[+] เชื่อมต่อแล้ว!");
                        if (data.discordName) {
                            player.sendMessage(`§f   > ชื่อ: §b${data.discordName}`);
                        }
                        if (data.channel) {
                            player.sendMessage(`§f   > ห้อง: §d${data.channel}`);
                        }
                        if (data.guildName) {
                            player.sendMessage(`§7   > เซิร์ฟเวอร์: §f${data.guildName}`);
                        }
                    } else if (data.status === "disconnected") {
                        player.sendMessage("§e[!] ไม่ได้อยู่ในห้องเสียง");
                        if (data.discordName) {
                            player.sendMessage(`§f   > ชื่อ: §b${data.discordName}`);
                        }
                        player.sendMessage("§7   กรุณาเข้าห้องเสียง Discord");
                    } else if (data.status === "not_found") {
                        player.sendMessage("§c[X] ไม่พบบัญชี Discord");
                        player.sendMessage(`§7   ชื่อต้องตรงกับ: §f${player.name}`);
                    } else if (data.status === "error") {
                        player.sendMessage("§c[X] เกิดข้อผิดพลาด");
                        player.sendMessage("§7   กรุณาลองใหม่อีกครั้ง");
                    } else if (data.status === "ok") {
                        player.sendMessage("§a[+] Bot พร้อมทำงาน");
                    } else {
                        player.sendMessage("§7รอสักครู่...");
                    }
                } catch (e) {
                    player.sendMessage("§c[X] อ่านข้อมูลไม่ได้");
                    console.warn("Parse error: " + e);
                }
            } else {
                player.sendMessage("§c[X] เชื่อมต่อ Bot ไม่ได้");
                player.sendMessage("§7   ตรวจสอบว่า Bot ทำงาน");
            }
            player.sendMessage("§7────────────────");
        }
    }).catch(e => {
        console.warn(`[ผิดพลาด] ${e}`);
        player.sendMessage("§c[ผิดพลาด] ไม่สามารถเปิดเมนูได้");
    });
}

// ─────────────────────────────────────────────────────────────
// เปิดเมนูด้วยไอเทมดิสคอร์ด
// ─────────────────────────────────────────────────────────────
try {
    world.afterEvents.itemUse.subscribe((event) => {
        const player = event.source;
        const item = event.itemStack;

        // รองรับทั้งไอเทมใหม่และเข็มทิศ
        if (item && (item.typeId === "voicechat:discord" || item.typeId === "proximity:discord_remote" || item.typeId === "minecraft:compass")) {
            console.warn(`[ระบบ] ${player.name} ใช้ไอเทมดิสคอร์ด`);
            showSettingsUI(player);
        }
    });
    console.warn("[ระบบ] ลงทะเบียนไอเทมดิสคอร์ดสำเร็จ");
} catch (e) {
    console.warn("[ผิดพลาด] " + e);
}

// รองรับ Script Event
if (system.afterEvents && system.afterEvents.scriptEventReceive) {
    system.afterEvents.scriptEventReceive.subscribe((event) => {
        if (event.id === "voice:ui") {
            const player = event.sourceEntity;
            if (player) {
                showSettingsUI(player);
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────
// ตรวจสอบระยะห่างแบบ Real-time
// ─────────────────────────────────────────────────────────────
system.runInterval(() => {
    const players = world.getPlayers();

    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const p1 = players[i];
            const p2 = players[j];

            if (p1.dimension.id !== p2.dimension.id) continue;

            const dist = getDistance(p1.location, p2.location);
            const key = getPairKey(p1, p2);

            const v1 = p1.getDynamicProperty("isVoiceEnabled") ?? true;
            const v2 = p2.getDynamicProperty("isVoiceEnabled") ?? true;

            // ถ้ามีใครสักคนปิดระบบเสียง ให้ตัดการเชื่อมต่อ (ถ้ามี)
            if (!v1 || !v2) {
                if (activeConnections.has(key)) {
                    sendToBackend({ event: "disconnect", players: [p1.name, p2.name] });
                    activeConnections.delete(key);
                }
                continue;
            }

            let r1 = p1.getDynamicProperty("voiceRadius") ?? DEFAULT_RADIUS;
            let r2 = p2.getDynamicProperty("voiceRadius") ?? DEFAULT_RADIUS;
            const threshold = Math.max(r1, r2);

            if (dist <= threshold) {
                if (!activeConnections.has(key)) {
                    activeConnections.add(key);

                    p1.onScreenDisplay.setActionBar("§a§l[+] เชื่อมต่อเสียงแล้ว");
                    p2.onScreenDisplay.setActionBar("§a§l[+] เชื่อมต่อเสียงแล้ว");

                    sendToBackend({ event: "connect", players: [p1.name, p2.name], distance: dist });
                }
            } else {
                if (activeConnections.has(key)) {
                    activeConnections.delete(key);

                    p1.onScreenDisplay.setActionBar("§c§l[-] ตัดการเชื่อมต่อเสียง");
                    p2.onScreenDisplay.setActionBar("§c§l[-] ตัดการเชื่อมต่อเสียง");

                    sendToBackend({ event: "disconnect", players: [p1.name, p2.name] });
                }
            }
        }
    }

    // ─── ระบบ Particle ระยะเสียง & Nametag ───
    for (const player of players) {
        // 1. วาดวงกลมระยะเสียงถ้าถือไอเทม "ดิสคอร์ด"
        const inventory = player.getComponent("inventory");
        const selectedItem = player.getComponent("inventory").container.getItem(player.selectedSlotIndex);

        if (selectedItem && selectedItem.typeId === "voicechat:discord") {
            const radius = player.getDynamicProperty("voiceRadius") ?? DEFAULT_RADIUS;
            drawRadiusCircle(player, radius);
        }
    }



    // ─── อัปเดตสีชื่อ (Name Tag Color) ───
    if (players.length > 0) {
        const playerNames = players.map(p => p.name);

        sendToBackend({ event: "get_speaking", players: playerNames })
            .then(response => {
                if (response && response.body) {
                    try {
                        const bodyText = response.body.trim();
                        if (bodyText.startsWith("{")) {
                            const data = JSON.parse(bodyText);
                            if (data.speaking) {
                                for (const player of players) {
                                    // 1. เช็ค Toggle ระบบเสียงก่อน (Priority สูงสุด)
                                    const isVoiceEnabled = player.getDynamicProperty("isVoiceEnabled") ?? true;

                                    if (!isVoiceEnabled) {
                                        // ถ้าปิดระบบเสียง -> สีแดง ทันที
                                        player.nameTag = `§c${player.name}`;
                                        continue;
                                    }

                                    // 2. เช็คสถานะจาก Discord
                                    const status = data.speaking[player.name];

                                    // สีเขียว = พูด (Speaking)
                                    // สีแดง = ปิดไมค์ (Muted)
                                    // สีขาว = ปกติ / อยู่ Lobby / ไม่ได้เชื่อมต่อ

                                    if (status === "speaking") {
                                        player.nameTag = `§a${player.name}`;
                                    } else if (status === "muted") {
                                        player.nameTag = `§c${player.name}`;
                                    } else {
                                        // "disconnected" หรือ Lobby
                                        player.nameTag = `§f${player.name}`;
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                }
            });
    }

}, CHECK_INTERVAL);

// ─────────────────────────────────────────────────────────────
// รีเซ็ต Nametag เมื่อผู้เล่นออก
// ─────────────────────────────────────────────────────────────
world.afterEvents.playerLeave.subscribe((event) => {
    const playerName = event.playerName;
    activeConnections.forEach((value, key) => {
        if (key.includes(playerName)) {
            const playersInSession = key.split("-");
            // ส่งสัญญาณตัดการเชื่อมต่อให้บอททันที
            sendToBackend({ event: "disconnect", players: playersInSession });
            activeConnections.delete(key);
        }
    });
});

// ─────────────────────────────────────────────────────────────
// ข้อความเริ่มต้น
// ─────────────────────────────────────────────────────────────
console.warn("──────────────────────────────────────");
console.warn("  Voice Chat System");
console.warn("  by ZirconX");
console.warn("──────────────────────────────────────");

console.warn("  [TIP] /give @s voicechat:discord");
console.warn("──────────────────────────────────────");
