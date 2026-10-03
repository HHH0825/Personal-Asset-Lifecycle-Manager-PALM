const AVATAR_KEYS = ['sprout', 'cat', 'book', 'sun', 'bike', 'star']
const AVATAR_LABELS = ['小芽', '猫咪', '书本', '太阳', '单车', '星星']
const AVATAR_SYMBOLS = ['芽', '猫', '书', '☀', '◎', '✦']

function avatarState(user) {
  const index = AVATAR_KEYS.indexOf(user && user.avatar_key)
  const avatarIndex = index < 0 ? 0 : index
  return { avatarIndex, avatarSymbol: AVATAR_SYMBOLS[avatarIndex],
    avatarPath: `/assets/paper/avatar-${AVATAR_KEYS[avatarIndex]}.png`, avatarFailed: false }
}

function avatarError(event) {
  // Ignore a delayed image error for the avatar selected before the current one.
  if (event.currentTarget.dataset.src === this.data.avatarPath) this.setData({ avatarFailed: true })
}

function isCurrent(page, sequence, token) {
  return page._visible && sequence === page._sequence && token === getApp().globalData.token
}

module.exports = { AVATAR_KEYS, AVATAR_LABELS, avatarState, avatarError, isCurrent }
