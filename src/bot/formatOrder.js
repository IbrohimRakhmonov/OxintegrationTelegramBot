const TG_LIMIT = 4096;
const PAYMENT_METHODS = { 1: 'Наличные', 2: "UzCard", 3: 'Humo' };

const money = (value = 0) => `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

const formatDate = (str) => {
    if (!str) return '-';
    const [date, time = ''] = str.split(' ');
    const [y, m, d] = date.split('-');
    return `${d}.${m}.${y} ${time.slice(0, 5)}`;
}

const escapeHtml = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const uzs = (obj) => obj?.UZS ?? 0;

function normalizeOrders(responce) {
    const items = responce?.items ?? [];

    const refundedIds = new Set(
        items.flatMap((o) => o.refundRecords ?? []).map(r => r.sellRecord)
    );

    return items
        .map(o => {
            const products = (o.sellRecords ?? [])
                .filter((r) => !r.deleted ) // удалённые из чека позиции не показываем
                .map((r) => ({
                    name: r.variationName,
                    barcode: r.variationBarcode,
                    count: r.count,
                    price: uzs(r.price),
                    discount: uzs(r.discount),
                    total: uzs(r.total),
                    cashback: uzs(r.cashback?.bonus),
                    refunded: refundedIds.has(r.id),
                }));

            const refunds = (o.refundRecords ?? []).map((r) => ({
                name: r.variationName,
                count: r.count,
                total: uzs(r.total),
                fromOrder: r.sellRecordSell
            }));

            return {
                id: o.id,
                check: o.printKey,
                date: o.finishedTime || o.time,
                type: products.length ? 'sell' : 'refund',
                products,
                refunds,
                subtotal: uzs(o.sellSubtotal),
                discount: uzs(o.discount),
                total: products.length ? uzs(o.sellTotal) : uzs(o.refundTotal),
                payment: [...new Set((o.payments ?? []).map((p) => PAYMENT_METHODS[p.paymentMethod] ?? 'Другое'))].join(', '),
            };
        })
        .filter((o) => o.products.length || o.refunds.length)
        .sort((a, b) => b.date.localeCompare(a.date))
}

function buildSummary(orders) {
    const sells = orders.filter((o) => o.type === 'sell');
    const refunds = orders.filter((o) => o.type === 'refund');

    const spent = sells.reduce((s, o) => s + o.total, 0);
    const returned = refunds.reduce((s, o) => s + o.total, 0);
    const cashback = sells.flatMap(o => o.products).reduce((s, o) => s + (o.cashback ?? 0), 0);
    const itemCount = sells.flatMap((o) => o.products).reduce((s, p) => s + p.count, 0);

    const top = Object.entries(
        sells.flatMap((o) => o.products).reduce((acc, p) => {
            acc[p.name] = (acc[p.name] ?? 0) + p.count;
            return acc;
        }, {})
    )
        .sort((a, b) => b[1] - a[1])
        .slice(0, itemCount);

    return { sellCount: sells.length, refundCount: refunds.length, itemCount, spent, returned, net: spent - returned, cashback, top }
}

function formatOrder(order) {
    if (order.type === 'refund') {
        const lines = order.refunds.map(
            (r) => `    ↩️ ${escapeHtml(r.name)} × ${r.count} — <b>${money(r.total)}</b>`
        );
        return [
            `🔄 <b>Возврат</b> · ${order.check}`,
            `📅 ${formatDate(order.date)}`,
            ...lines,
            `💸 Возвращено: <b>${money(order.total)}</b>`,
        ].join('\n');
    }

    const lines = order.products.map((p, i) => {
        let line = `   ${i + 1}. ${p.refunded ? '<s>' : ''}${escapeHtml(p.name)}${p.refunded ? '</s>' : ''}`;
        line += `\n      ${p.count} × ${money(p.price)}`;
        if (p.discount) line += ` (скидка −${money(p.discount)})`;
        line += ` = <b>${money(p.total)}</b>`;
        if (p.cashback) line += `\n      🎁 кешбэк +${money(p.cashback)}`;
        if (p.refunded) line += `\n      ↩️ <i>возвращён</i>`;
        return line;
    })

    const result = [
        `🧾 <b>Заказ ${order.check}</b>`,
        `📅 ${formatDate(order.date)}`,
        `🛍 Товары:`,
        ...lines,
    ];
    if (order.discount) result.push(`🏷 Скидка: −${money(order.discount)}`);
    result.push(`💰 Итого: <b>${money(order.total)}</b> · ${order.payment}`);
    return result.join('\n');
}

function formatSummary(s) {
    const lines = [
        `📊 <b>История покупок</b>`,
        ``,
        `🧾 Покупок: <b>${s.sellCount}</b> (товаров: ${s.itemsCount})`,
        `🔄 Возвратов: <b>${s.refundCount}</b>`,
        `💰 Потрачено: <b>${money(s.spent)}</b>`,
    ];
    if (s.returned) {
        lines.push(`💸 Возвращено: <b>${money(s.returned)}</b>`);
        lines.push(`✅ Итого: <b>${money(s.net)}</b>`);
    }
    if (s.cashback) lines.push(`🎁 Кешбэк: <b>${money(s.cashback)}</b>`);
    if (s.top.length) {
        lines.push(``, `⭐️ Чаще всего:`);
        s.top.forEach(([name, cnt]) => lines.push(`   • ${escapeHtml(name)} — ${cnt} шт.`));
    }
    return lines.join('\n');
}

function chunkBlocks(blocks, separator = '\n\n━━━━━━━━━━━━\n\n') {
    const messages = [];
    let current = '';
    for (const block of blocks) {
        const next = current ? current + separator + block : block;
        if (next.length > TG_LIMIT && current) {
            messages.push(current);
            current = block;
        } else {
            current = next;
        }
    }
    if (current) messages.push(current);
    return messages;
}

/**
 * Главная функция: ответ сервера -> массив готовых текстов для sendMessage.
 */
function buildOrderMessages(response, { limit } = {}) {
    let orders = normalizeOrders(response);
    if (!orders.length) return ['У вас пока нет покупок 🛒'];

    const summary = formatSummary(buildSummary(orders));
    if (limit) orders = orders.slice(0, limit);

    return [summary, ...chunkBlocks(orders.map(formatOrder))];
}

module.exports = {buildOrderMessages, normalizeOrders, buildSummary, formatOrder};