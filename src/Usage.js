const usage = new Map(); // key: `${userId}:${YYYY-MM-DD}` o `${userId}:${YYYY-MM}`

function keyDay(userId, day) { return `${userId}:day:${day}`; }
function keyMonth(userId, month) { return `${userId}:month:${month}`; }

export function getCounts(userId) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);   // YYYY-MM-DD
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    return {
        day,
        month,
        daily: usage.get(keyDay(userId, day)) || 0,
        monthly: usage.get(keyMonth(userId, month)) || 0,
    };
}

export function incCounts(userId) {
    const { day, month } = getCounts(userId);
    usage.set(keyDay(userId, day), (usage.get(keyDay(userId, day)) || 0) + 1);
    usage.set(keyMonth(userId, month), (usage.get(keyMonth(userId, month)) || 0) + 1);
}
