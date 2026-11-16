const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC_DATA = 'unnes/tandon/data';
const MQTT_TOPIC_CTRL = 'unnes/tandon/control';
const TANK_AREA_CM2 = 100; // estimasi luas penampang botol 100 cm²

// Meminta izin browser untuk Notification API
function requestNotificationPermission() {
    if (!("Notification" in window)) {
        alert("Browser ini tidak mendukung desktop notification.");
    } else {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                alert("Notifikasi browser berhasil diaktifkan!");
                document.getElementById('notifBtn').style.display = 'none';
            }
        });
    }
}

// Cek izin saat load halaman
if (Notification.permission === "granted") {
    document.getElementById('notifBtn').style.display = 'none';
}

function triggerBrowserNotification(title, bodyText) {
    if (Notification.permission === "granted") {
        new Notification(title, {
            body: bodyText,
            icon: "https://cdn-icons-png.flaticon.com/512/564/564619.png"
        });
    }
}

// Fungsi untuk mengirim perintah manual pompa ke ESP32 via MQTT
function sendPumpCommand(action) {
    const payload = JSON.stringify({ mode: action }); // action: "ON" atau "AUTO"
    
    if (client && client.connected) {
        client.publish(MQTT_TOPIC_CTRL, payload, (err) => {
            if (!err) {
                console.log("Perintah terkirim ke ESP32: " + action);
            } else {
                console.error("Gagal mengirim perintah kontrol pompa");
            }
        });
    } else {
        alert("Koneksi MQTT terputus, tidak dapat mengirim perintah!");
    }
}

// Connect to HiveMQ Public Broker via WebSocket
const client = mqtt.connect(MQTT_BROKER);

const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

client.on('connect', () => {
    console.log('Terhubung ke Broker MQTT HiveMQ');
    statusBadge.className = "status-badge connected";
    statusText.innerText = "Terhubung Real-Time";

    client.subscribe(MQTT_TOPIC_DATA, (err) => {
        if (!err) console.log(`Berhasil Subscribe ke topik: ${MQTT_TOPIC_DATA}`);
    });
});

client.on('offline', () => {
    statusBadge.className = "status-badge disconnected";
    statusText.innerText = "Terputus";
});

let previousLeakState = false;

// Tangkap Data Terkirim Dari ESP32
client.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        updateDashboard(data.persen, data.status, data.bocor);
    } catch (e) {
        console.error("Gagal parsing JSON dari ESP32:", e);
    }
});

/* ================= GRAFIK PER JAM ================= */
const hourLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const usageData = new Array(24).fill(0);

const ctx = document.getElementById('usageChart').getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 280);
gradient.addColorStop(0, 'rgba(34, 211, 238, 0.7)');
gradient.addColorStop(1, 'rgba(34, 211, 238, 0.02)');

const usageChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: hourLabels,
        datasets: [{
            label: 'Pemakaian Air (liter/jam)',
            data: usageData,
            backgroundColor: gradient,
            borderColor: 'rgba(34, 211, 238, 0.6)',
            borderWidth: 1,
            borderRadius: 5,
            maxBarThickness: 26
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(24, 24, 27, 0.95)',
                borderColor: 'rgba(34, 211, 238, 0.3)',
                borderWidth: 1,
                titleColor: '#a5f3fc',
                bodyColor: '#e4e4e7',
                callbacks: {
                    label: (ctx) => ctx.parsed.y.toFixed(1) + ' liter'
                }
            }
        },
        scales: {
            x: {
                ticks: { color: '#ffffff', font: { size: 10 }, maxRotation: 45 },
                grid: { display: false }
            },
            y: {
                beginAtZero: true,
                ticks: { color: '#ffffff', font: { size: 10 }, callback: v => v + ' L' },
                grid: { color: 'rgba(0, 44, 61, 0.99)' },
                title: { display: true, text: 'Liter', color: '#52525b', font: { size: 10 } }
            }
        }
    }
});

let lastPersen = null;
let lastHour = new Date().getHours();

function recordHourlyUsage(persen) {
    const now = new Date();
    const hour = now.getHours();

    if (hour !== lastHour && lastPersen !== null) {
        usageData[lastHour] = Math.max(0, usageData[lastHour]);
        lastHour = hour;
    }

    if (lastPersen !== null) {
        const dropPercent = Math.max(0, lastPersen - persen);
        const dropCm = (dropPercent / 100) * 15; // tinggi maksimal botol 15 cm
        const liters = (dropCm * TANK_AREA_CM2) / 1000;
        usageData[hour] += liters;
        usageChart.update('none');
    }
    lastPersen = persen;
}

// Mode Demo: simulasi data pemakaian untuk 24 jam
document.getElementById('demoBtn').addEventListener('click', () => {
    const pattern = [1, 0.5, 0.5, 0.5, 1, 2, 6, 10, 8, 4, 3, 4, 5, 3, 3, 2, 3, 6, 9, 11, 7, 4, 2, 1];
    for (let h = 0; h < 24; h++) usageData[h] = pattern[h] + Math.random() * 1;
    usageChart.update();
});
/* =============== AKHIR GRAFIK PER JAM =============== */

function updateDashboard(persen, statusPompa, isBocor) {
    persen = Math.max(0, Math.min(100, persen));

    // 1. Update Kotak 1: Persentase Ketinggian Air & Visual Tandon
    document.getElementById('textPercent').innerText = persen;
    document.getElementById('progressBar').style.width = persen + '%';

    const cmVal = ((persen / 100) * 15).toFixed(1);
    document.getElementById('textVolumeCm').innerText = cmVal;
    document.getElementById('waterFill').style.height = persen + '%';

    // 2. Update Kotak 2: Status Kebocoran (Rain Sensor) & Notifikasi Web
    const leakCard = document.getElementById('leakCard');
    const leakIcon = document.getElementById('leakIcon');
    const leakStatusText = document.getElementById('leakStatusText');
    const leakBadge = document.getElementById('leakBadge');

    if (isBocor) {
        leakCard.className = "leak-card danger";
        leakIcon.className = "fa-solid fa-triangle-exclamation";
        leakStatusText.innerText = "BAHAYA: KEBOCORAN TERDETEKSI!";
        leakBadge.className = "badge danger";
        leakBadge.innerText = "LEAK ALERT";

        if (!previousLeakState) {
            triggerBrowserNotification("🚨 WATERNEX ALERT!", "Bahaya! Terdeteksi kebocoran air pada tandon/pipa!");
        }
    } else {
        leakCard.className = "leak-card secure";
        leakIcon.className = "fa-solid fa-shield-halved";
        leakStatusText.innerText = "Aman (Tidak Bocor)";
        leakBadge.className = "badge secure";
        leakBadge.innerText = "SECURE";
    }
    previousLeakState = isBocor;

    // Logika Peringatan Tandon (Alert Box di Kotak 2)
    const alertBox = document.getElementById('alertBox');
    const alertIcon = document.getElementById('alertIcon');
    const alertStatus = document.getElementById('alertStatus');

    if (persen <= 34) {
        alertBox.className = "alert-box rose";
        alertIcon.className = "fa-solid fa-triangle-exclamation";
        alertStatus.innerText = "Status Kritis! Air Sangat Sedikit";
    } else if (persen >= 90) {
        alertBox.className = "alert-box emerald";
        alertIcon.className = "fa-solid fa-circle-check";
        alertStatus.innerText = "Tandon Penuh!";
    } else {
        alertBox.className = "alert-box info";
        alertIcon.className = "fa-solid fa-droplet";
        alertStatus.innerText = "Status Normal";
    }

    // 3. Update Kotak 3: Status Pompa Relay
    const pumpStatusText = document.getElementById('pumpStatusText');
    const pumpBadge = document.getElementById('pumpBadge');
    const pumpIconBg = document.getElementById('pumpIconBg');

    if (statusPompa === "ON") {
        pumpStatusText.innerText = "POMPA AKTIF";
        pumpStatusText.className = "pump-status active";
        pumpBadge.className = "badge pumping";
        pumpBadge.innerText = "PUMPING";
        pumpIconBg.className = "pump-icon-bg active";
    } else {
        pumpStatusText.innerText = "MATI (OFF)";
        pumpStatusText.className = "pump-status";
        pumpBadge.className = "badge standby";
        pumpBadge.innerText = "STANDBY";
        pumpIconBg.className = "pump-icon-bg";
    }

    // 4. Update Grafik Pemakaian Per Jam
    recordHourlyUsage(persen);

    // 5. Update Timestamp
    const now = new Date();
    document.getElementById('lastUpdate').innerText = now.toLocaleTimeString();
}