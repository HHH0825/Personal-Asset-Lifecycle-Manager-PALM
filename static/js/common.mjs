const $ = (selector) => document.querySelector(selector);
const statusNames = { active: '使用中', idle: '闲置', disposed: '已处置' };
const methodNames = { sold: '出售', gifted: '赠送', discarded: '丢弃', other: '其他' };
const iconTypes = { digital: '数码', home: '家居', daily: '日常用品', clothing: '衣物', books: '书籍文具', mobility: '出行', sports: '运动', tools: '工具', other: '其他' };
const avatarNames = { sprout: '新芽', cat: '猫', book: '书', sun: '太阳', bike: '单车', star: '星星' };
function avatarMarkup(key, className = 'avatar') {
  const avatar = Object.prototype.hasOwnProperty.call(avatarNames, key) ? key : 'sprout';
  return `<span class="${className}" data-avatar="${avatar}" aria-hidden="true"><svg><use href="/static/images/avatars.svg#${avatar}"></use></svg></span>`;
}
function iconMarkup(type) {
  const key = Object.prototype.hasOwnProperty.call(iconTypes, type) ? type : 'other';
  return `<svg class="type-icon" aria-hidden="true" focusable="false"><use href="/static/images/icons.svg#${key}"></use></svg>`;
}
function iconTile(type, className = 'item-icon') {
  const key = Object.prototype.hasOwnProperty.call(iconTypes, type) ? type : 'other';
  return `<span class="${className}" data-type="${key}">${iconMarkup(key)}</span>`;
}
function itemVisual(item, className = 'item-icon') {
  return item.photo_url
    ? `<img class="${className} item-photo" src="${escapeHtml(item.photo_url)}" alt="" loading="lazy">`
    : iconTile(item.icon_type, className);
}
function decorativeIcon(name) {
  return `<svg class="type-icon" aria-hidden="true"><use href="/static/images/icons.svg#${name}"></use></svg>`;
}
const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function yuan(value) {
  const amount = Number(value);
  return `${amount < 0 ? '-' : ''}¥${Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function badge(status) { return `<span class="badge ${escapeHtml(status)}">${statusNames[status]}</span>`; }
function empty(title, subtitle = '') { return `<div class="empty"><strong>${title}</strong>${subtitle}</div>`; }

export { $, statusNames, methodNames, iconTypes, avatarNames, avatarMarkup, iconMarkup, iconTile, itemVisual, decorativeIcon, todayLocal, escapeHtml, yuan, badge, empty };
