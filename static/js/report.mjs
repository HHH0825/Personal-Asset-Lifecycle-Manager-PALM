import { $, escapeHtml, yuan } from './common.mjs';

function renderReport(report) {
  const purchases = report.purchased_items.map((item) => `<li><button type="button" data-open-item="${item.id}">${escapeHtml(item.name)}</button><small>${item.purchase_date}</small></li>`).join('');
  const highlights = report.highlights.map((item) => `<li><button type="button" data-open-item="${item.item_id}">${escapeHtml(item.name)}</button> · ${escapeHtml(item.text)}<small>${item.date}</small></li>`).join('');
  const noData = !report.purchase_count && !report.usage_count && !Number(report.maintenance_total) && !Number(report.proceeds_total) && !report.highlights.length;
  $('#report-content').innerHTML = `<article class="report-sheet"><span class="eyebrow">PALM / MONTHLY NOTES</span><h3>${escapeHtml(report.month)} 的手账</h3><p>${report.is_current ? `截至 ${report.through}` : '按当月发生的记录整理'} · 根据当前资料生成</p>
    <div class="report-metrics"><div><span>新增物品</span><strong>${report.purchase_count} 件</strong></div><div><span>购置支出</span><strong>${yuan(report.purchase_total)}</strong></div><div><span>维修支出</span><strong>${yuan(report.maintenance_total)}</strong></div><div><span>处置回收</span><strong>${yuan(report.proceeds_total)}</strong></div><div><span>记录的使用</span><strong>${report.usage_count} 次</strong></div></div>
    ${noData ? '<p>这个月还没有可回顾的记录。从一件物品或一次使用开始吧。</p>' : ''}
    <div class="report-columns"><section><h4>本月入手</h4>${purchases ? `<ul class="report-list">${purchases}</ul>` : '<p>没有购入记录。</p>'}</section><section><h4>相伴时刻</h4>${highlights ? `<ul class="report-list">${highlights}</ul>` : '<p>本月暂无纪念日或目标达成。</p>'}</section></div></article>`;
}

function shortLine(ctx, text, width) {
  let result = '';
  for (const character of String(text)) {
    if (ctx.measureText(result + character).width > width) return result + '…';
    result += character;
  }
  return result;
}

async function saveReportImage(report, isCurrent = () => true) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成图片');
  ctx.fillStyle = '#f7f4ec'; ctx.fillRect(0, 0, 1200, 1000);
  ctx.fillStyle = '#fffdf7'; ctx.fillRect(55, 55, 1090, 890);
  ctx.strokeStyle = '#d8ddd1'; ctx.strokeRect(55, 55, 1090, 890);
  const logo = new Image();
  logo.src = '/static/images/palm-logo.svg';
  await logo.decode();
  if (!isCurrent()) return;
  ctx.drawImage(logo, 100, 98, 68, 68);
  ctx.fillStyle = '#254b3d'; ctx.font = 'bold 36px Georgia'; ctx.fillText('PALM', 188, 143);
  ctx.font = '48px "Microsoft YaHei", sans-serif'; ctx.fillText(`${report.month} · 月度回顾`, 100, 245);
  ctx.fillStyle = '#66776a'; ctx.font = '25px "Microsoft YaHei", sans-serif';
  ctx.fillText(report.is_current ? `截至 ${report.through} · 根据当前资料生成` : '根据当前资料生成', 100, 290);
  const metrics = [['新增物品', `${report.purchase_count} 件`], ['购置支出', yuan(report.purchase_total)],
    ['维修支出', yuan(report.maintenance_total)], ['处置回收', yuan(report.proceeds_total)],
    ['记录的使用', `${report.usage_count} 次`]];
  metrics.forEach(([label, value], index) => {
    const col = index % 3; const row = Math.floor(index / 3); const x = 100 + col * 345; const y = 358 + row * 110;
    ctx.fillStyle = '#66776a'; ctx.font = '22px "Microsoft YaHei", sans-serif'; ctx.fillText(label, x, y);
    ctx.fillStyle = '#254b3d'; ctx.font = '32px Georgia, "Microsoft YaHei", sans-serif'; ctx.fillText(shortLine(ctx, value, 300), x, y + 43);
  });
  ctx.strokeStyle = '#d8ddd1'; ctx.beginPath(); ctx.moveTo(100, 565); ctx.lineTo(1100, 565); ctx.stroke();
  ctx.fillStyle = '#254b3d'; ctx.font = '28px "Microsoft YaHei", sans-serif'; ctx.fillText('本月入手', 100, 625); ctx.fillText('相伴时刻', 625, 625);
  ctx.font = '23px "Microsoft YaHei", sans-serif';
  report.purchased_items.slice(0, 4).forEach((item, index) => ctx.fillText(shortLine(ctx, `${item.purchase_date}  ${item.name}`, 460), 100, 680 + index * 49));
  report.highlights.slice(0, 4).forEach((item, index) => ctx.fillText(shortLine(ctx, `${item.name} · ${item.text}`, 465), 625, 680 + index * 49));
  ctx.fillStyle = '#66776a'; ctx.font = '20px "Microsoft YaHei", sans-serif';
  if (report.purchased_items.length > 4) ctx.fillText(`另有 ${report.purchased_items.length - 4} 件物品`, 100, 880);
  if (report.highlights.length > 4) ctx.fillText(`另有 ${report.highlights.length - 4} 条相伴时刻`, 625, 880);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!isCurrent()) return;
  if (!blob) throw new Error('图片生成失败，请重试');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `PALM-${report.month}-月度回顾.png`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { renderReport, saveReportImage };
