import { $, methodNames, iconTypes, iconMarkup, todayLocal, escapeHtml } from './common.mjs';
import { resetToast } from './feedback.mjs';
let formState = null;
let photoPreviewObjectUrl = null;
const field = (name, label, type = 'text', opts = {}) => `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.required ? ' *' : ''}</span>${type === 'textarea' ? `<textarea name="${name}" maxlength="${opts.max || 1000}" ${opts.required ? 'required' : ''}></textarea>` : type === 'select' ? `<select name="${name}">${opts.options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>` : `<input name="${name}" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${type === 'date' && !opts.future ? `max="${todayLocal()}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} ${opts.required ? 'required' : ''}>`}</label>`;
function iconChoices() {
  return `<fieldset class="icon-choice-field"><legend>物品类型</legend><div class="icon-choice-grid">${Object.entries(iconTypes).map(([key, label]) => `<label class="icon-option"><input type="radio" name="icon_type" value="${key}" required><span class="icon-option-face">${iconMarkup(key)}<span>${label}</span></span></label>`).join('')}</div></fieldset>`;
}
function photoField(editing) {
  return `<div class="photo-upload-field"><label class="field wide"><span>物品照片（可选）</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><small>JPEG、PNG 或 WebP，最多 5 MB；保存时自动调整大小。</small></label><div class="photo-preview-wrap"><img id="item-photo-preview" class="item-photo-preview ${editing?.photo_url ? '' : 'hidden'}" src="${escapeHtml(editing?.photo_url || '')}" alt="照片预览">${editing?.photo_url ? '<label class="photo-remove"><input type="checkbox" name="remove_photo"> 删除现有照片</label>' : ''}</div></div>`;
}
function formMarkup(kind, editing) {
  if (kind === 'item') return field('name', '物品名称', 'text', { required: true, wide: true, max: 120 }) + iconChoices() + photoField(editing) + field('category', '分类', 'text', { required: true, max: 60 }) + field('purchase_date', '购买日期', 'date', { required: true }) + field('warranty_expires_on', '保修到期日（可选）', 'date', { future: true }) + field('purchase_price', '购买价格（元）', 'number', { required: true }) + field('status', '当前状态', 'select', { options: editing?.status === 'disposed' ? [['disposed', '已处置']] : [['active', '使用中'], ['idle', '闲置']] }) + field('notes', '备注', 'textarea', { wide: true });
  if (kind === 'usage') return field('used_on', '使用日期', 'date', { required: true }) + field('notes', '使用备注', 'textarea', { wide: true });
  if (kind === 'maintenance') return field('maintained_on', '维修日期', 'date', { required: true }) + field('cost', '维修费用（元）', 'number', { required: true }) + field('description', '维修说明', 'textarea', { required: true, wide: true, max: 500 });
  return field('disposed_on', '处置日期', 'date', { required: true }) + field('method', '处置方式', 'select', { options: Object.entries(methodNames) }) + field('proceeds', '回收金额（元）', 'number', { required: true }) + field('notes', '备注', 'textarea', { wide: true });
}
function openForm(kind, record = null) {
  if (photoPreviewObjectUrl) { URL.revokeObjectURL(photoPreviewObjectUrl); photoPreviewObjectUrl = null; }
  formState = { kind, record };
  resetToast();
  const titles = { item: '物品', usage: '使用记录', maintenance: '维修记录', disposal: '处置记录' };
  $('#dialog-title').textContent = `${record ? '编辑' : '添加'}${titles[kind]}`;
  $('#form-fields').innerHTML = formMarkup(kind, record);
  $('#form-error').classList.add('hidden');
  const form = $('#entity-form');
  const defaults = record || (kind === 'item' ? { status: 'active', icon_type: 'other' } : kind === 'disposal' ? { method: 'sold' } : {});
  for (const input of form.querySelectorAll('[name]')) {
    if (input.type === 'radio') input.checked = input.value === defaults[input.name];
    else if (input.type === 'file' || input.type === 'checkbox') continue;
    else if (defaults[input.name] != null) input.value = defaults[input.name];
    else if (input.type === 'date' && input.name !== 'warranty_expires_on') input.value = todayLocal();
  }
  $('#form-dialog').showModal();
}

function getFormState() { return formState; }
function releasePhotoPreview() {
  if (photoPreviewObjectUrl) { URL.revokeObjectURL(photoPreviewObjectUrl); photoPreviewObjectUrl = null; }
}
function resetFormState() { releasePhotoPreview(); formState = null; }
function handlePhotoInput(event) {
  if (event.target.name !== 'photo') return;
  releasePhotoPreview();
  const preview = $('#item-photo-preview');
  const file = event.target.files[0];
  photoPreviewObjectUrl = file ? URL.createObjectURL(file) : null;
  const previewSource = photoPreviewObjectUrl || formState?.record?.photo_url;
  if (previewSource) preview.src = previewSource;
  else preview.removeAttribute('src');
  preview.classList.toggle('hidden', !previewSource);
  if (file && $('#entity-form [name="remove_photo"]')) $('#entity-form [name="remove_photo"]').checked = false;
}

async function submitEntityForm(event, { api, itemId, isCurrent }) {
  event.preventDefault();
  const { kind, record } = getFormState();
  const data = Object.fromEntries(new FormData($('#entity-form')).entries());
  const photoFile = kind === 'item' ? $('#entity-form [name="photo"]').files[0] : null;
  const removePhoto = kind === 'item' && $('#entity-form [name="remove_photo"]')?.checked;
  delete data.photo;
  delete data.remove_photo;
  if (photoFile && (photoFile.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type))) {
    $('#form-error').textContent = '照片只支持 JPEG、PNG 或 WebP，且不能超过 5 MB';
    $('#form-error').classList.remove('hidden');
    return null;
  }
  let path, method;
  if (kind === 'item') { path = record ? `/api/items/${record.id}` : '/api/items'; method = record ? 'PUT' : 'POST'; }
  else if (kind === 'disposal') { path = record ? `/api/disposal/${record.id}` : `/api/items/${itemId}/disposal`; method = record ? 'PUT' : 'POST'; }
  else { path = record ? `/api/${kind}/${record.id}` : `/api/items/${itemId}/${kind}`; method = record ? 'PUT' : 'POST'; }
  const submit = $('#entity-form [type="submit"]');
  submit.disabled = true;
  let saved;
  try {
    saved = await api(path, { method, body: JSON.stringify(data) });
  } catch (error) {
    if (isCurrent()) {
      $('#form-error').textContent = error.message;
      $('#form-error').classList.remove('hidden');
    }
    submit.disabled = false;
    return null;
  }
  if (!isCurrent()) return null;
  let photoError = null;
  if (kind === 'item' && (photoFile || removePhoto)) {
    try {
      if (photoFile) {
        const upload = new FormData();
        upload.append('photo', photoFile);
        saved = await api(`/api/items/${saved.id}/photo`, { method: 'POST', body: upload });
      } else {
        await api(`/api/items/${saved.id}/photo`, { method: 'DELETE' });
        saved = await api(`/api/items/${saved.id}`);
      }
    } catch (error) { photoError = error.message; }
  }
  submit.disabled = false;
  if (!isCurrent()) return null;
  $('#form-dialog').close();
  return { kind, record, saved, photoError, relatedItemId: kind === 'item' ? saved.id : itemId };
}

export { openForm, resetFormState, releasePhotoPreview, handlePhotoInput, submitEntityForm };
