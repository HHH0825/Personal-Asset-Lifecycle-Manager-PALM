Component({
  properties: { theme: { type: String, value: 'small' } },
  data: { art: 'small' },
  observers: {
    theme(value) { this.setData({ art: ['sage', 'rose', 'small'].includes(value) ? value : 'small' }) }
  }
})
